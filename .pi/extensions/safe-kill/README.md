# Safe Kill Extension

阻止使用进程名称杀死进程的危险命令，要求先查找 PID 再杀死指定进程。

## 功能

### 1. 阻止危险命令

拦截以下命令模式：
- `pkill -f <pattern>` - 通过进程名称匹配杀死进程
- `killall <name>` - 通过进程名杀死所有匹配进程

### 2. 提供安全替代工具 `safe_kill`

使用方式：
```typescript
// LLM 会调用这个工具
safe_kill(pattern="vite", signal="TERM", byPort=false)
```

参数：
- `pattern`: 进程名称、关键词或端口号
- `signal`: kill 信号（TERM, INT, KILL, HUP, QUIT），默认 TERM
- `byPort`: 如果为 true，将 pattern 视为端口号

## 安装

### 项目本地安装（推荐）

扩展已在 `.pi/extensions/safe-kill/` 目录，pi 会自动加载。

### 全局安装

```bash
cp -r .pi/extensions/safe-kill ~/.pi/agent/extensions/
```

## 使用示例

### 被阻止的命令

```bash
# ❌ 这些命令会被阻止
pkill -f "vite"
pkill -f vite
killall vite
pkill -f "npm run.*dev"
```

### 正确的做法

```bash
# ✅ 先查找进程 ID
ps aux | grep vite
lsof -i :5173
pgrep -f vite

# ✅ 然后杀死特定进程
kill 12345
kill -9 12345
```

### 使用 safe_kill 工具

让 LLM 使用 `safe_kill` 工具：

```
请帮我杀死 vite 进程
```

LLM 会调用 `safe_kill(pattern="vite")`，然后显示所有匹配的进程列表，让你选择要杀死的 PID。

## 测试

```bash
# 1. 启动 pi 并加载扩展
cd /Users/xuyingzhou/Project/temporary/pi-mono
pi -e .pi/extensions/safe-kill

# 2. 尝试危险命令（会被阻止）
请用 bash 杀死 vite 进程：pkill -f "vite"

# 3. 使用安全工具
请用 safe_kill 工具查找并杀死 vite 进程
```

## 技术实现

- 使用 `pi.on("tool_call")` 拦截 bash 工具调用
- 使用 `isToolCallEventType("bash", event)` 获取类型安全的输入
- 正则表达式匹配危险命令模式
- 返回 `block: true` 阻止执行并提供详细说明

## 配置

暂无配置选项。

## 许可证

MIT
