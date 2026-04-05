# LSP 环境变量注入扩展

这是一个遵循 [PI 扩展开发规范](../PI_EXTENSION_DEVELOPMENT_GUIDE.md) 的完整示例扩展。

## 功能特性

这个扩展演示了 PI 扩展系统的核心能力：

### 1. 事件订阅
- ✅ `session_start` - 会话启动时恢复环境变量状态
- ✅ `tool_call` - 拦截工具调用并注入环境变量
- ✅ `session_shutdown` - 会话结束时保存状态

### 2. 工具注册
- ✅ `lsp_set_env` - 设置单个环境变量
- ✅ `lsp_load_env` - 从 .env 文件加载
- ✅ `lsp_list_env` - 列出所有环境变量
- ✅ `lsp_clear_env` - 清除环境变量

### 3. 命令注册
- ✅ `/lsp-env` - 命令行管理环境变量

### 4. 状态持久化
- ✅ 使用 `pi.appendEntry()` 保存状态
- ✅ 会话重启后自动恢复

### 5. UI 交互
- ✅ 状态栏显示（`ctx.ui.setStatus`）
- ✅ 通知提示（`ctx.ui.notify`）
- ✅ 自定义渲染器（`renderCall`, `renderResult`）

## 安装使用

### 方式 1: 本地加载（开发）

```bash
# 编译 TypeScript
cd example-plugin
npm install
npm run build

# 使用 PI 加载
pi -e ./dist/index.js
```

### 方式 2: 复制到扩展目录

```bash
# 编译
npm run build

# 复制到 PI 扩展目录
mkdir -p ~/.pi/agent/extensions/lsp-env
cp dist/index.js ~/.pi/agent/extensions/lsp-env/

# 启动 PI（自动加载）
pi
```

### 方式 3: 作为 Pi Package 安装

```bash
# 打包
npm pack

# 安装到 PI
pi install ./pi-lsp-env-extension-1.0.0.tgz
```

## 使用方法

### 通过 LLM 调用工具

```
你: 帮我设置 ANTHROPIC_API_KEY 为 sk-ant-xxx
PI: [调用 lsp_set_env 工具]
✓ 已设置环境变量: ANTHROPIC_API_KEY

你: 运行 npx @anthropic-ai/mcp-server-anthropic
PI: [自动注入环境变量]
ANTHROPIC_API_KEY=sk-ant-xxx npx @anthropic-ai/mcp-server-anthropic
```

### 通过命令行

```bash
# 在 PI 对话中直接输入命令

/lsp-env set ANTHROPIC_API_KEY sk-ant-xxx
/lsp-env set GITHUB_TOKEN ghp_xxx

/lsp-env list
# 输出: 环境变量 (2): ANTHROPIC_API_KEY, GITHUB_TOKEN

/lsp-env get ANTHROPIC_API_KEY
# 输出: ANTHROPIC_API_KEY=sk-ant-xxx

/lsp-env clear ANTHROPIC_API_KEY
# 清除单个环境变量

/lsp-env clear
# 清除所有环境变量
```

### 从 .env 文件加载

```
你: 从项目根目录加载 .env 文件
PI: [调用 lsp_load_env 工具]
✓ 已从 /path/to/.env 加载 5 个环境变量
当前共 7 个环境变量
```

## 扩展架构

### 核心流程

```
1. PI 启动
   └─> 加载扩展 (index.ts)
       └─> 注册工具、命令、事件监听器

2. 会话开始 (session_start)
   └─> 从会话历史恢复环境变量状态
   └─> 更新状态栏显示

3. 工具调用 (tool_call)
   ├─> 检查是否是 LSP 相关命令
   ├─> 拦截并注入环境变量
   └─> 返回修改后的输入

4. 会话结束 (session_shutdown)
   └─> 保存当前状态到会话历史
```

### 状态管理

```typescript
// 内存存储
const envStore = new Map<string, string>();

// 持久化到会话
pi.on("session_shutdown", async () => {
  if (envStore.size > 0) {
    pi.appendEntry("lsp-env-state", Object.fromEntries(envStore));
  }
});

// 从会话恢复
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "lsp-env-state") {
      const state = entry.data as Record<string, string>;
      Object.entries(state).forEach(([key, value]) => {
        envStore.set(key, value);
      });
      break;
    }
  }
});
```

### 工具调用拦截

```typescript
pi.on("tool_call", async (event, ctx) => {
  // 1. 检查是否需要处理
  if (!["bash", "mcp_call", "spawn"].includes(event.toolName)) {
    return { action: "continue" };
  }
  
  // 2. 判断是否是 LSP 命令
  const needsEnv = event.input.command?.includes("npx") ||
                   event.input.command?.includes("node");
  
  // 3. 注入环境变量
  if (needsEnv) {
    const envPrefix = Array.from(envStore.entries())
      .map(([key, value]) => `${key}=${shellEscape(value)}`)
      .join(" ");
    
    return {
      action: "modify",
      input: {
        ...event.input,
        command: `${envPrefix} ${event.input.command}`,
      },
    };
  }
});
```

## 最佳实践

### 1. 敏感信息处理

```typescript
// 脱敏显示
const display = key.includes("KEY") || key.includes("SECRET")
  ? `${value.slice(0, 8)}...${value.slice(-4)}`
  : value;
```

### 2. 错误处理

```typescript
try {
  const content = await fs.readFile(envPath, "utf-8");
  // 处理逻辑
} catch (error) {
  return {
    content: [{ type: "text", text: `✗ 加载失败: ${error.message}` }],
    isError: true,
  };
}
```

### 3. Shell 转义

```typescript
function shellEscape(str: string): string {
  if (/^[a-zA-Z0-9_\-./]+$/.test(str)) {
    return str; // 不需要转义
  }
  return `"${str.replace(/"/g, '\\"')}"`; // 引号包裹
}
```

### 4. 状态栏更新

```typescript
// 设置状态
ctx.ui.setStatus("lsp-env", `${envStore.size} 个环境变量`);

// 清除状态
ctx.ui.setStatus("lsp-env", undefined);
```

## 调试技巧

### 查看扩展加载

```bash
pi --verbose
# 输出: Loading extension: /path/to/lsp-env/index.js
```

### 热重载

```bash
# 在 PI 对话中
/reload
# 重新加载所有扩展
```

### 查看工具列表

```bash
# LLM 可以使用的工具
你: 你有哪些工具？
PI: 我可以使用以下工具: lsp_set_env, lsp_load_env, lsp_list_env, lsp_clear_env, ...
```

## 扩展示例对照

这个示例实现了 PI 扩展开发指南中的主要能力：

| 能力 | 文档章节 | 本示例实现 |
|-----|---------|----------|
| 事件订阅 | 3.1.2 - 3.1.5 | `session_start`, `tool_call`, `session_shutdown` |
| 工具注册 | 3.1.6 | 4 个自定义工具 |
| 命令注册 | 3.1.7 | `/lsp-env` 命令 |
| 状态持久 | 5.1 | 使用 `pi.appendEntry()` |
| 错误处理 | 5.2 | try-catch + `isError: true` |
| UI 交互 | 3.1.6 | `setStatus`, `notify`, 自定义渲染 |

## 参考文档

- [PI 扩展开发指南](../PI_EXTENSION_DEVELOPMENT_GUIDE.md)
- [LSP 环境变量指南](../LSP_ENV_VARIABLES_GUIDE.md)
- [LSP 架构设计](../LSP_ENV_ARCHITECTURE.md)
