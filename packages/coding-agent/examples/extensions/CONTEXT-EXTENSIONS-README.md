# 实时上下文修改扩展示例

这个目录包含两个展示如何实时/定期修改 pi 上下文的扩展示例。

## 扩展示例

### 1. dynamic-context.ts

**功能：**
- 每 30 秒自动更新 Git 分支信息
- 在每次 LLM 调用前注入动态上下文
- 支持通过命令添加自定义笔记
- 状态栏显示最后更新时间

**命令：**
```bash
/dynamic-context show     # 显示当前上下文
/dynamic-context add xxx  # 添加笔记
/dynamic-context clear    # 清空笔记
/dynamic-context start    # 启动自动更新
/dynamic-context stop     # 停止自动更新
```

**注入的上下文格式：**
```
[DYNAMIC CONTEXT]
- Git Branch: main
- Last Update: 14:30:25
- Custom Notes: 需要重构用户模块; 记得更新测试

This context is updated every 30 seconds and injected before each LLM call.
```

### 2. file-watcher-context.ts

**功能：**
- 监控指定文件/目录的变化
- 文件变化时自动更新上下文
- 支持配置文件定义监控列表
- 可控制是否注入文件内容

**配置文件 `.pi/watcher-config.json`：**
```json
{
  "watch": ["./src/config.ts", "./TODO.md", "./logs/error.log"],
  "injectContent": true,
  "maxContentLength": 2000
}
```

**命令：**
```bash
/watcher status           # 查看状态
/watcher add <path>       # 添加监控文件
/watcher remove <path>    # 移除监控文件
/watcher reload           # 重载配置
/watcher enable           # 启用
/watcher disable          # 禁用
```

**注入的上下文格式：**
```
[FILE WATCHER CONTEXT]
Monitoring 2 file(s), updates auto-injected

--- File: ./TODO.md (updated 5s ago) ---
# TODO
- [ ] 修复登录 bug
- [ ] 添加单元测试

--- File: ./src/config.ts (updated 120s ago) ---
export const config = { ... };
```

## 核心 API 使用模式

### 模式 1：定期更新 + context 事件注入

```typescript
let data: string = "";

// 定期更新
setInterval(async () => {
  data = await fetchExternalData();
}, 60000);

// 每次 LLM 调用前注入
pi.on("context", async (event, ctx) => {
  return {
    messages: [
      ...event.messages,
      { role: "system", content: `外部数据：${data}` }
    ]
  };
});
```

### 模式 2：before_agent_start 添加消息

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    message: {
      customType: "my-context",
      content: "动态上下文",
      display: false  // 不显示给用户
    }
  };
});
```

### 模式 3：文件监控

```typescript
import { watch } from "node:fs";

const watcher = watch(filePath, (eventType) => {
  if (eventType === "change") {
    // 文件变化，更新内部状态
    // 下次 context 事件会自动注入新内容
  }
});
```

### 模式 4：turn_end 跟踪进度

```typescript
pi.on("turn_end", async (event, ctx) => {
  // 分析本轮对话结果
  // 更新内部状态，影响下一轮的 context
});
```

## 安装使用

1. 复制到扩展目录：
```bash
cp dynamic-context.ts ~/.pi/agent/extensions/
cp file-watcher-context.ts ~/.pi/agent/extensions/
```

2. 重启 pi 或运行 `/reload`

3. 使用对应命令管理上下文

## 注意事项

1. **性能考虑**：避免在 context 事件中执行耗时操作，这会阻塞 LLM 调用
2. **内容长度**：注入的上下文会占用 token，注意控制长度
3. **错误处理**：后台更新应该静默处理错误，避免干扰用户
4. **资源清理**：在 session_shutdown 事件中清理定时器/文件监视器

## 扩展场景

- **API 状态监控**：定期检查服务健康状态
- **错误日志注入**：监控 error.log 并注入最新错误
- **待办事项同步**：读取 TODO.md 并注入当前任务
- **环境变量注入**：动态加载 .env 配置
- **团队协作**：监控共享状态文件实现多 pi 实例同步
