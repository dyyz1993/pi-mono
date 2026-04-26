---

# SessionManager 静态 API 与会话文件格式

> 本文档描述 SessionManager 静态 API（非 RPC，Server 层直接调用）和会话文件格式。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

## SessionManager 静态 API（非 RPC，Server 层直接调用）

这些 API 不通过 RPC 协议，而是 Server 层直接 import `SessionManager` 使用。

### 扫描所有项目

```typescript
import { SessionManager } from "../core/session-manager.js";

// 列出所有项目所有会话
const allSessions: SessionInfo[] = await SessionManager.listAll();

// 提取去重的项目列表
const projects = [...new Set(allSessions.map(s => s.cwd))];
```

### 获取指定项目的会话列表

```typescript
const sessions = await SessionManager.list("/path/to/project");

// 带进度回调
const sessions = await SessionManager.list(cwd, undefined, (loaded, total) => {
  console.log(`Loaded ${loaded}/${total}`);
});
```

### 打开会话并读取状态

```typescript
const sm = SessionManager.open("/path/to/session.jsonl");

// 获取 header
const header = sm.getHeader();
// { type: "session", version: 3, id: "uuid", timestamp: "...", cwd: "/path/to/project" }

// 获取上下文（消息 + 模型 + 思考级别）
const ctx = sm.buildSessionContext();
// { messages: AgentMessage[], thinkingLevel: "off", model: { provider: "anthropic", modelId: "..." } | null }

// 获取所有 entries
const entries = sm.getEntries();

// 获取树结构（用于分支浏览）
const tree = sm.getTree();

// 获取会话名称
const name = sm.getSessionName();
```

### 创建新会话

```typescript
const sm = SessionManager.create("/path/to/project");
// 自动在 ~/.pi/agent/sessions/--encoded-path--/ 下创建 .jsonl 文件
```

### 删除会话

```typescript
// 目前没有内置 delete API，直接删文件
import { unlinkSync } from "fs";
unlinkSync(sm.getSessionFile()!);
```

### 重命名会话

```typescript
const sm = SessionManager.open("/path/to/session.jsonl");
sm.appendSessionInfo("新的会话名称");
```

### 继续最近会话

```typescript
const sm = SessionManager.continueRecent("/path/to/project");
// 如果有最近会话则打开，否则新建
```

### SessionInfo 完整结构

```typescript
interface SessionInfo {
  path: string;              // .jsonl 文件完整路径
  id: string;                // session UUID (v7)
  cwd: string;               // 工作目录
  name?: string;             // 用户自定义名称（session_info entry）
  parentSessionPath?: string;// 父会话路径（fork 来源）
  created: Date;             // 创建时间
  modified: Date;            // 最后修改时间
  messageCount: number;      // 消息总数
  firstMessage: string;      // 第一条用户消息文本
  allMessagesText: string;   // 所有消息文本拼接（用于搜索）
}
```

---

## 会话文件格式 (.jsonl)

每个会话文件是 append-only 的 JSONL 文件，每行一个 JSON 对象。

### 文件命名

```
<ISO-timestamp-with-dashes>_<uuid-v7>.jsonl
```

示例：`2025-01-20T10-30-00-000_0194abc2-def0-7xyz-b123-456789abcdef.jsonl`

### 文件内容结构

```jsonl
{"type":"session","version":3,"id":"0194abc2-def0-7xyz-b123-456789abcdef","timestamp":"2025-01-20T10:30:00.000Z","cwd":"/path/to/project"}
{"type":"message","id":"abc12345","parentId":null,"timestamp":"2025-01-20T10:30:01.000Z","message":{"role":"user","content":[{"type":"text","text":"hello"}],"timestamp":1706000001000}}
{"type":"message","id":"def67890","parentId":"abc12345","timestamp":"2025-01-20T10:30:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}],"provider":"anthropic","model":"claude-sonnet-4-5-20250929","stopReason":"stop","usage":{...},"timestamp":1706000002000}}
{"type":"model_change","id":"ghi11111","parentId":"def67890","timestamp":"2025-01-20T10:35:00.000Z","provider":"openai","modelId":"gpt-4o"}
{"type":"thinking_level_change","id":"jkl22222","parentId":"ghi11111","timestamp":"2025-01-20T10:35:01.000Z","thinkingLevel":"high"}
{"type":"session_info","id":"mno33333","parentId":"jkl22222","timestamp":"2025-01-20T10:40:00.000Z","name":"My Session"}
```

### Entry 类型一览

| type | 说明 |
|------|------|
| `session` | 文件头（version, id, cwd） |
| `message` | LLM 消息（user/assistant/toolResult） |
| `model_change` | 模型切换记录 |
| `thinking_level_change` | 思考级别变更记录 |
| `compaction` | 上下文压缩摘要 |
| `branch_summary` | 分支切换时被放弃路径的摘要 |
| `custom` | 扩展自定义数据（不进入 LLM 上下文） |
| `custom_message` | 扩展自定义消息（进入 LLM 上下文） |
| `label` | 用户书签/标记 |
| `session_info` | 会话元数据（如显示名称） |
| `deletion` | 消息删除记录 |
| `segment_summary` | 消息段摘要 |

---
