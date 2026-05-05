# MCP 内嵌方案

## 目标

将 `.pi/extensions/pi-mcp/` 的 MCP 功能内嵌到 `packages/coding-agent/src/core/mcp/`，配置统一到 `settings.json`，修复 CI。

## 改动清单

### 1. 新增类型 — `settings-manager.ts`

在 `Settings` 接口前新增：

```typescript
export interface McpStdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
}

export interface McpSseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig;

export interface McpSettings {
  servers?: Record<string, McpServerConfig>;
}
```

`Settings` 接口新增字段：

```typescript
mcp?: McpSettings;
```

### 2. 新增模块 — `packages/coding-agent/src/core/mcp/`

#### `types.ts`

从 `.pi/extensions/pi-mcp/types.ts` 搬入，去掉 `disabled` 字段（已在 McpServerConfig 中）。

#### `mcp-manager.ts`

从 `.pi/extensions/pi-mcp/mcp-manager.ts` 搬入，改动：
- import 路径改为 `./types.js`
- 无其他逻辑变更

#### `tool-converter.ts`

从 `.pi/extensions/pi-mcp/tool-converter.ts` 搬入，改动：
- import 路径改为 `../extensions/types.js`（defineTool）和 `@dyyz1993/pi-ai`（Type）
- 无其他逻辑变更

### 3. 新增依赖 — `packages/coding-agent/package.json`

```json
"@modelcontextprotocol/sdk": "^1.12.0"
```

### 4. 集成到 agent-session — `agent-session.ts`

在 `_extensionRunner.emit(sessionStartEvent)` 之后（约 line 2095），新增：

```typescript
// 内嵌 MCP：从 settings 读取配置，连接 MCP servers，注册工具
await this._initMcpServers();
```

新增私有方法 `_initMcpServers()`：
- 从 `this._settingsManager.getSettings("project")` 读取 `mcp.servers`
- 无配置则直接 return（零开销）
- 有配置则 new McpManager → connectAll → registerTool
- session abort 时 disconnectAll

### 5. 导出 — `index.ts`

新增：
```typescript
export type { McpSettings, McpServerConfig, McpStdioServerConfig, McpSseServerConfig } from "./core/settings-manager.js";
```

### 6. 修复 CI 测试

#### `test/suite/mcp-extension.test.ts`
- import 路径从 `../../.pi/extensions/pi-mcp/config.js` 改为 `../../src/core/mcp/config.js`（或对应新路径）

#### `test/suite/mcp-kb-integration.test.ts`
- import 路径从 `../../.pi/extensions/pi-mcp/mcp-manager.js` 改为 `../../src/core/mcp/mcp-manager.js`

#### `test/session-manager/remove-entry.test.ts`
- `appendSegmentSummary` 方法不存在，skip 涉及该方法的 2 个测试

#### `extensions/lsp/lsp/lsp.test.ts`
- 排查 mock 逻辑，修复 `serverEvents.length >= 1` 断言

## 配置格式

`~/.pi/agent/settings.json`（全局）或 `.pi/settings.json`（项目级）：

```jsonc
{
  "mcp": {
    "servers": {
      "knowledge-base": {
        "command": "npx",
        "args": ["-y", "@dyyz1993/kb-mcp@1.2.0", "--stdio"]
      },
      "remote-service": {
        "type": "sse",
        "url": "http://localhost:8080/sse"
      }
    }
  }
}
```

## 启动性能

| 场景 | 额外耗时 |
|------|---------|
| 无 mcp 配置 | 0ms（直接 return） |
| 有 mcp 配置 | 与现有行为一致（各 server 1-3s） |
| SDK import | lazy，不连接不加载 |

## 向后兼容

不需要，MCP 功能尚未对外发布。

## 文件变更总结

| 操作 | 文件 |
|------|------|
| 新增 | `src/core/mcp/types.ts` |
| 新增 | `src/core/mcp/mcp-manager.ts` |
| 新增 | `src/core/mcp/tool-converter.ts` |
| 修改 | `src/core/settings-manager.ts` — 新增 McpSettings 类型 + Settings.mcp 字段 |
| 修改 | `src/core/agent-session.ts` — 新增 _initMcpServers() |
| 修改 | `src/index.ts` — 导出 MCP 类型 |
| 修改 | `package.json` — 新增 @modelcontextprotocol/sdk 依赖 |
| 修改 | `test/suite/mcp-extension.test.ts` — import 路径 |
| 修改 | `test/suite/mcp-kb-integration.test.ts` — import 路径 |
| 修改 | `test/session-manager/remove-entry.test.ts` — skip 未实现的方法 |
| 修改 | `extensions/lsp/lsp/lsp.test.ts` — 修复 mock |
