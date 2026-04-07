# 模型刷新机制改进建议

## 当前实现分析

### 已有功能 ✅

1. **`ModelRegistry.refresh()` 方法**
   - 清空配置缓存
   - 重置 API/OAuth providers
   - 重新加载 models.json
   - 重新应用动态注册的 providers

2. **API Provider 注册机制**
   - `registerApiProvider(provider, sourceId)` - 支持来源标识
   - `unregisterApiProviders(sourceId)` - 按来源注销
   - `clearApiProviders()` - 全部清空

3. **动态 Provider 管理**
   - `registerProvider()` / `unregisterProvider()`
   - 保存在 `registeredProviders` Map 中
   - 刷新时重新应用

### 问题点 ⚠️

1. **没有自动刷新触发器**
   - models.json 修改后需要手动调用 `refresh()`
   - 没有文件监听机制
   - 没有定时刷新

2. **刷新期间的并发安全问题**
   - `clearApiProviders()` 后立即请求会失败
   - 没有读写锁保护
   - 没有原子性保证

3. **内置 providers 的重复注册**
   - `resetApiProviders()` 先清空再注册
   - 可能导致短暂不可用

## 改进方案

### 方案 1：文件监听自动刷新（推荐）

```typescript
import { watch } from 'fs';

class ModelRegistry {
    private watcher?: FSWatcher;
    
    startWatching(): void {
        if (this.modelsJsonPath) {
            this.watcher = watch(this.modelsJsonPath, (eventType) => {
                if (eventType === 'change') {
                    console.log('models.json changed, refreshing...');
                    this.refresh();
                }
            });
        }
    }
    
    stopWatching(): void {
        this.watcher?.close();
    }
}
```

### 方案 2：原子性刷新

```typescript
class ModelRegistry {
    private refreshLock = new AsyncLock();
    
    async refreshAtomic(): Promise<void> {
        await this.refreshLock.acquire('refresh', async () => {
            // 1. 准备新数据
            const newModels = await this.loadModelsFromDisk();
            const newProviders = await this.loadProvidersFromDisk();
            
            // 2. 原子性替换
            this.models = newModels;
            this.providers = newProviders;
            
            // 3. 更新全局 registry
            resetApiProviders();
            registerBuiltInApiProviders();
            for (const [name, config] of this.registeredProviders) {
                this.applyProviderConfig(name, config);
            }
        });
    }
}
```

### 方案 3：增量更新

```typescript
class ModelRegistry {
    updateModel(provider: string, modelId: string, updates: Partial<Model>): void {
        const index = this.models.findIndex(
            m => m.provider === provider && m.id === modelId
        );
        
        if (index >= 0) {
            this.models[index] = { ...this.models[index], ...updates };
        }
    }
    
    addProvider(providerName: string, config: ProviderConfigInput): void {
        this.registerProvider(providerName, config);
    }
    
    removeProvider(providerName: string): void {
        this.unregisterProvider(providerName);
    }
}
```

### 方案 4：版本化注册表

```typescript
class ModelRegistry {
    private version = 0;
    private registries = new Map<number, Map<string, ApiProvider>>();
    
    registerApiProvider(provider: ApiProvider, sourceId?: string): number {
        const newVersion = ++this.version;
        const newRegistry = new Map(this.getCurrentRegistry());
        
        newRegistry.set(provider.api, { provider, sourceId });
        this.registries.set(newVersion, newRegistry);
        
        // 清理旧版本
        setTimeout(() => {
            this.registries.delete(newVersion - 1);
        }, 5000);
        
        return newVersion;
    }
    
    getCurrentRegistry(): Map<string, ApiProvider> {
        return this.registries.get(this.version) ?? new Map();
    }
}
```

## 推荐组合方案

### Phase 1：立即改进（低风险）

1. **添加手动刷新 API**
   ```typescript
   // 在 CodingAgent 或 MCP server 中暴露
   app.post('/api/models/refresh', async (req, res) => {
       modelRegistry.refresh();
       res.json({ success: true, models: modelRegistry.getAll() });
   });
   ```

2. **添加文件监听（可选）**
   ```typescript
   if (process.env.WATCH_MODELS === 'true') {
       modelRegistry.startWatching();
   }
   ```

### Phase 2：增强健壮性（中风险）

1. **原子性刷新**
   - 使用读写锁保护关键路径
   - 准备新数据后再替换

2. **优雅降级**
   - 刷新失败时保留旧配置
   - 记录错误日志

### Phase 3：高级功能（未来）

1. **热重载支持**
   - WebSocket 推送模型变更
   - 前端实时更新模型列表

2. **配置验证**
   - 启动时验证 models.json
   - 提供 schema 检查工具

## 测试建议

```typescript
describe('ModelRegistry refresh', () => {
    it('should clear and reload models', () => {
        const registry = ModelRegistry.inMemory(authStorage);
        registry.registerProvider('custom', customConfig);
        
        registry.refresh();
        
        expect(registry.getAll()).toBeDefined();
        expect(registry.find('custom', 'model1')).toBeDefined();
    });
    
    it('should handle concurrent requests during refresh', async () => {
        const registry = ModelRegistry.inMemory(authStorage);
        
        const [result1, result2] = await Promise.all([
            registry.getApiKeyAndHeaders(model),
            registry.refresh().then(() => registry.getAll())
        ]);
        
        expect(result1.ok).toBe(true);
        expect(result2.length).toBeGreaterThan(0);
    });
    
    it('should preserve registered providers after refresh', () => {
        const registry = ModelRegistry.inMemory(authStorage);
        registry.registerProvider('custom', customConfig);
        
        registry.refresh();
        
        expect(registry.find('custom', 'model1')).toBeDefined();
    });
});
```

## 总结

当前实现已经提供了基础的刷新机制，主要问题是：
1. **没有自动触发器** - 需要手动调用
2. **并发安全** - 刷新期间可能有短暂不可用

建议优先实现：
- 手动刷新 API（暴露给用户）
- 可选的文件监听
- 优雅的错误处理

长期改进：
- 原子性刷新
- 版本化注册表
- 热重载支持
