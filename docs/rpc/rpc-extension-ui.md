---

# Extension UI 交互协议

> 本文档详细描述 RPC 协议中的 Extension UI 交互机制。
> 主文档：[rpc-protocol-reference.md](../rpc-protocol-reference.md)

---

扩展可能需要与用户交互。RPC 模式通过 `extension_ui_request` / `extension_ui_response` 实现。

## Extension UI 请求（agent → stdout）

### `select` - 选择列表

```json
{"type": "extension_ui_request", "id": "uuid-1", "method": "select", "title": "选择文件", "options": ["file1.ts", "file2.ts"], "timeout": 30000}
```

### `confirm` - 确认对话框

```json
{"type": "extension_ui_request", "id": "uuid-2", "method": "confirm", "title": "确认删除", "message": "确定要删除这个文件吗？", "timeout": 30000}
```

### `input` - 文本输入

```json
{"type": "extension_ui_request", "id": "uuid-3", "method": "input", "title": "输入文件名", "placeholder": "example.ts", "timeout": 30000}
```

### `editor` - 多行编辑器

```json
{"type": "extension_ui_request", "id": "uuid-4", "method": "editor", "title": "编辑代码", "prefill": "// 在此编辑..."}
```

### `notify` - 通知（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-5", "method": "notify", "message": "操作完成", "notifyType": "info"}
```

`notifyType`: `"info"` | `"warning"` | `"error"`

### `setStatus` - 设置状态栏（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-6", "method": "setStatus", "statusKey": "build", "statusText": "Building..."}
```

清除状态：`"statusText": undefined`

### `setWidget` - 设置小部件（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-7", "method": "setWidget", "widgetKey": "progress", "widgetLines": ["Step 1: Done", "Step 2: In Progress"], "widgetPlacement": "aboveEditor"}
```

清除 widget：`"widgetLines": undefined`

### `setTitle` - 设置标题（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-8", "method": "setTitle", "title": "Pi - My Project"}
```

### `set_editor_text` - 设置编辑器文本（无需响应）

```json
{"type": "extension_ui_request", "id": "uuid-9", "method": "set_editor_text", "text": "预填文本"}
```

---

## Extension UI 响应（stdin → agent）

需要对带 `id` 的请求进行响应。

### 选择响应

```json
{"type": "extension_ui_response", "id": "uuid-1", "value": "file1.ts"}
```

### 确认响应

```json
{"type": "extension_ui_response", "id": "uuid-2", "confirmed": true}
```

### 取消响应

```json
{"type": "extension_ui_response", "id": "uuid-1", "cancelled": true}
```

### 输入响应

```json
{"type": "extension_ui_response", "id": "uuid-3", "value": "my-file.ts"}
```

---

## Channel 数据协议

扩展之间可通过命名 channel 双向通信：

**Client → Agent:**
```json
{"type": "channel_data", "name": "my-channel", "data": {"action": "refresh"}}
```

**Agent → Client:**
```json
{"type": "channel_data", "name": "my-channel", "data": {"status": "done"}}
```

---
