# File Time Guard

防止 AI 在文件被外部修改后覆盖用户更改的安全扩展。

## 功能

- ✅ 记录文件读取时的元数据（mtime、ctime、size）
- ✅ 写入前检查文件是否被外部修改
- ✅ 三种检查模式：block（阻止）、warn（警告）、ignore（忽略）
- ✅ 支持忽略特定路径（如 `node_modules/`、`.git/`）
- ✅ 会话隔离，不同会话独立追踪
- ✅ 提供 `/file-time-status` 命令查看追踪状态

## 使用场景

### 场景 1：阻止覆盖外部修改

```bash
# AI 读取文件
pi

# 在另一个终端打开编辑器修改文件
vim src/index.ts

# AI 尝试写入，被拦截并提示
ERROR: 文件已被外部修改: src/index.ts
请重新读取文件
```

### 场景 2：仅警告不阻止

```bash
pi --file-time-check-mode warn

# AI 写入文件时显示警告，但允许操作
警告: 文件已被外部修改: src/index.ts
```

### 场景 3：完全禁用

```bash
pi --disable-file-time-check
# 或
export OPENCODE_DISABLE_FILETIME_CHECK=true
```

## 配置选项

### 命令行 Flag

| Flag | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `--file-time-check-mode` | string | `block` | 检查模式：`block`/`warn`/`ignore` |
| `--disable-file-time-check` | boolean | `false` | 禁用文件时间戳检查 |

### 环境变量

```bash
export OPENCODE_DISABLE_FILETIME_CHECK=true
```

### 检查模式说明

- **block**: 阻止写入，显示错误提示
- **warn**: 允许写入，显示警告信息
- **ignore**: 不检查，直接写入

## 默认忽略路径

以下路径默认被忽略，不会被检查：

- `node_modules/**`
- `.git/**`
- `dist/**`
- `build/**`

## 命令

### `/file-time-status`

查看当前会话的文件追踪状态：

```
文件时间戳检查: 启用
检查模式: block
已追踪文件: 5

已追踪文件:
  /path/to/file1.ts
  /path/to/file2.ts
```

## 工作原理

1. **读取文件**：记录文件元数据（mtime、ctime、size）和读取时间
2. **写入文件**：对比当前文件元数据与记录的值
3. **检测修改**：如果任意一项不匹配，认为文件被外部修改
4. **执行操作**：根据检查模式决定是阻止、警告还是忽略

### 检查规则

文件被认为"被修改"当且仅当满足以下任意一个条件：

- `mtime`（修改时间）改变
- `ctime`（元数据改变时间）改变
- `size`（文件大小）改变

## 技术实现

- 使用 `tool_call` 事件拦截 `read`/`write`/`edit` 工具
- 基于 `sessionID` 实现会话隔离
- 使用 `Map<SessionID, Map<FilePath, FileStamp>>` 存储追踪数据
- 依赖 `minimatch` 实现路径忽略模式匹配
- 利用现有的 `withFileMutationQueue()` 实现并发保护

## 兼容性

- ✅ 与其他扩展兼容（如 `file-lock-guard`、`protected-paths`）
- ✅ 不修改核心工具代码
- ✅ 可通过 flag 环境变量动态配置

## 注意事项

1. 仅追踪通过 `read` 工具读取的文件
2. 必须先读取文件才能写入（block 模式下）
3. 会话结束时自动清理追踪记录
4. 忽略路径不会被追踪或检查

## 相关扩展

- **file-lock-guard**: 文件并发写入保护
- **protected-paths**: 阻止写入敏感路径
- **file-snapshot**: 文件快照和恢复功能
