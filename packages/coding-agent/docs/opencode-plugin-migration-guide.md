# Migration Guide: OpenCode Plugin to pi-mono Extension

This guide covers migrating plugins written for [`@opencode-ai/plugin`](https://github.com/anomalyco/opencode) to extensions for `@mariozechner/pi-coding-agent` (pi-mono).

## Table of Contents

1. [Entry Point](#1-entry-point)
2. [Tool Definition](#2-tool-definition)
3. [Event System](#3-event-system)
4. [Context Objects](#4-context-objects)
5. [Session ID Resolution](#5-session-id-resolution)
6. [Message Capture Pattern](#6-message-capture-pattern)
7. [Configuration](#7-configuration)
8. [Shutdown / Cleanup](#8-shutdown--cleanup)
9. [Installation Location](#9-installation-location)
10. [Tool Return Value Format](#10-tool-return-value-format)

---

## 1. Entry Point

### OpenCode

```typescript
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const MyPlugin = async (input: PluginInput): Promise<Hooks> => {
  return {
    event: async ({ event }) => {
      // handle all events here
    },
    tool: {
      myTool: tool({ ... }),
    },
    stop: async () => {
      // cleanup
    },
  }
}
```

### pi-mono

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (event, ctx) => {
    // handle session start
  })

  pi.registerTool({ name: "my_tool", ... })
}
```

**Key differences:**

| Aspect | OpenCode | pi-mono |
|--------|----------|---------|
| Export | Named export (`MyPlugin`) | Default export function |
| Signature | `(input: PluginInput) => Promise<Hooks>` | `(pi: ExtensionAPI) => void` |
| Registration | Returns a `Hooks` object | Imperative calls on `pi` API |
| Async | Required (async factory) | Optional (sync or async) |

---

## 2. Tool Definition

### OpenCode (Zod schemas)

```typescript
const z = tool.schema

tool({
  description: "Search the web for information",
  args: {
    query: z.string().describe("Search query"),
    limit: z.number().optional(),
  },
  async execute(args, context) {
    return "search results as string"
  }
})
```

### pi-mono (TypeBox schemas)

```typescript
import { Type } from "@sinclair/typebox"
import { defineTool } from "@mariozechner/pi-coding-agent"

defineTool({
  name: "my_tool",
  label: "My Tool",
  description: "Search the web for information",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    limit: Type.Optional(Type.Number({ default: 10 })),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return {
      content: [{ type: "text", text: "search results" }],
      details: {},
    }
  }
})
```

### Schema mapping

| Zod (OpenCode) | TypeBox (pi-mono) |
|----------------|-------------------|
| `z.string()` | `Type.String()` |
| `z.string().describe("...")` | `Type.String({ description: "..." })` |
| `z.number()` | `Type.Number()` |
| `z.boolean()` | `Type.Boolean()` |
| `z.enum(["a", "b"])` | `Type.Union([Type.Literal("a"), Type.Literal("b")])` |
| `z.object({ ... })` | `Type.Object({ ... })` |
| `z.array(z.string())` | `Type.Array(Type.String())` |
| `z.optional(z.string())` | `Type.Optional(Type.String())` |
| `z.string().default("x")` | `Type.String({ default: "x" })` |

### Execute signature differences

| Parameter | OpenCode | pi-mono |
|-----------|----------|---------|
| Arguments | `args` (parsed schema object) | `params` (parsed schema object) |
| Call ID | Not available | `toolCallId: string` |
| Cancellation | `context.abort: AbortSignal` | `signal: AbortSignal` |
| Streaming updates | Not available | `onUpdate: (update: ToolUpdate) => void` |
| Context | `context: ToolContext` | `ctx: ExtensionContext` |
| Return value | `string` | `AgentToolResult<TDetails>` |

### Additional tool fields in pi-mono

```typescript
defineTool({
  // ... required fields ...

  renderCall?: (call: ToolCall<any>) => ComponentChild   // Custom TUI rendering for active call
  renderResult?: (result: AgentToolResult<any>) => ComponentChild  // Custom TUI rendering for result
  promptSnippet?: string                                   // Shown in auto-complete suggestions
  promptGuidelines?: string                                // Guidelines injected into system prompt
})
```

---

## 3. Event System

### OpenCode: Single event handler with switch

```typescript
event: async ({ event }) => {
  if (event.type === "session.created") {
    console.log("Session started:", event.properties.info.id)
  } else if (event.type === "message.updated") {
    console.log("Message updated")
  }
}
```

### pi-mono: Individual handlers per event type

```typescript
pi.on("session_start", (event, ctx) => {
  console.log("Session started, reason:", event.reason)
})

pi.on("message_update", (event, ctx) => {
  console.log("Message streaming update")
})
```

### Event mapping table

| OpenCode Event | pi-mono Event | Notes |
|----------------|---------------|-------|
| `session.created` | `session_start` | `event.reason`: `"startup"` \| `"reload"` \| `"new"` \| `"resume"` \| `"fork"` |
| `session.deleted` | `session_shutdown` | No session ID in event payload |
| `session.error` | *(no direct equivalent)* | Use `agent_end` + error handling in handler |
| `message.updated` | `message_update` | Has `message` (`AgentMessage`) + `assistantMessageEvent` |
| `message.part.updated` | *(no direct equivalent)* | Use `message_update` and check `assistantMessageEvent.type` |
| `session.diff` | *(not applicable)* | pi-mono does not emit diff events |

### Additional pi-mono events (not in OpenCode)

| Event | Description | Capabilities |
|-------|-------------|--------------|
| `turn_start` | Fires at the beginning of each turn | Read-only |
| `turn_end` | Fires after each turn completes | Access to full message + tool results |
| `agent_start` | Fires when agent loop begins | Read-only |
| `agent_end` | Fires when agent loop ends | Access to all messages |
| `context` | Before LLM call | **Can modify messages** (return `{ messages? }`) |
| `before_agent_start` | Before agent starts | Can modify `prompt` / `systemPrompt` |
| `tool_call` | Before tool executes | **Can block tools** (return `{ blocked?, reason? }`) |
| `tool_result` | After tool executes | **Can modify results** (return `{ result? }`) |
| `input` | On user input | Can transform/handle input |
| `session_before_compact` | Before session compaction | Can customize or cancel compaction |
| `user_bash` | On bash command execution | Intercept bash commands |
| `message_start` | When any message begins | user / assistant / toolResult |
| `message_end` | When message completes | Final state of message |

---

## 4. Context Objects

### OpenCode ToolContext

```typescript
{
  sessionID: string,
  messageID: string,
  agent: string,
  directory: string,
  worktree: string,
  abort: AbortSignal,
  metadata(input): void,
  ask(input): Promise<void>,
}
```

### pi-mono ExtensionContext

```typescript
{
  ui: ExtensionUIContext,
  hasUI: boolean,
  cwd: string,
  sessionManager: ReadonlySessionManager,
  modelRegistry: ModelRegistry,
  model: Model<any> | undefined,
  isIdle(): boolean,
  signal: AbortSignal | undefined,
  abort(): void,
  hasPendingMessages(): boolean,
  shutdown(): void,
  getContextUsage(): ContextUsage | undefined,
  compact(options?): void,
  getSystemPrompt(): string,
}
```

### Context field mapping

| OpenCode | pi-mono | Notes |
|----------|---------|-------|
| `context.sessionID` | `ctx.sessionManager.getSessionFile()` | Returns path; parse for ID if needed |
| `context.abort` | `ctx.signal` | `undefined` when idle (no active turn) |
| `context.directory` | `ctx.cwd` | Current working directory |
| `context.worktree` | `ctx.cwd` | Same concept |
| `context.agent` | *(from event or ctx.model)* | Agent/model info |
| `context.metadata()` | *(not needed)* | pi-mono handles metadata internally |
| `context.ask(input)` | `ctx.ui.select(...)` / `ctx.ui.confirm(...)` | Rich UI primitives available |

### UI API (`ctx.ui`)

```typescript
// Selection from options
const choice = await ctx.ui.select({
  title: "Pick an option",
  options: [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
  ],
})

// Confirmation
const confirmed = await ctx.ui.confirm({
  title: "Proceed?",
  message: "This action cannot be undone.",
})

// Text input
const text = await ctx.ui.input({
  title: "Enter value",
  placeholder: "Type here...",
})

// Notifications and status
ctx.ui.notify({ type: "info", title: "Info", message: "Done" })
ctx.ui.setStatus("Working...")
```

---

## 5. Session ID Resolution

### OpenCode

Session ID is directly available:

```typescript
// In tool execute:
const sid = context.sessionID

// In event handler:
const sid = event.properties.info.id
```

### pi-mono

No direct session ID property. Resolve via the session manager:

```typescript
// From context (events or tools):
const sessionFile = ctx.sessionManager.getSessionFile()
// e.g., "/home/user/.pi/sessions/abc123.json"
// Extract ID from filename or use the path as identifier
```

**Pattern:** If you need a stable session identifier, derive it from `getSessionFile()`:

```typescript
function getSessionId(ctx: ExtensionContext): string {
  const file = ctx.sessionManager.getSessionFile()
  return path.basename(file, ".json")
}
```

---

## 6. Message Capture Pattern

### OpenCode: Incremental via `message.updated` / `message.part.updated`

```typescript
event: async ({ event }) => {
  if (event.type === "message.updated") {
    const { role, finish } = event.properties.message
    // role: "user" | "assistant" | "tool"
    // finish: "stop" | "length" | "tool_calls" | null
  }

  if (event.type === "message.part.updated") {
    const { content } = event.properties.part
    // Text content fragments during streaming
  }
}
```

### pi-mono: Lifecycle-based events

```typescript
// Message lifecycle
pi.on("message_start", (event, ctx) => {
  // Fires when any message starts (user / assistant / toolResult)
  const { role } = event.message
})

pi.on("message_update", (event, ctx) => {
  // Fires during streaming with token-by-token updates
  const { assistantMessageEvent } = event
  // Check assistantMessageEvent.type for specific update kind
})

pi.on("message_end", (event, ctx) => {
  // Fires when message completes - final state
})
```

### Capturing conversation content

For capturing complete conversation turns, use turn/agent lifecycle events instead of per-message events:

```typescript
// Per-turn capture (recommended for most use cases)
pi.on("turn_end", (event, ctx) => {
  // event.messages: complete list of messages after this turn
  // event.toolResults: tool results produced this turn
})

// End-of-agent capture (all messages)
pi.on("agent_end", (event, ctx) => {
  // event.messages: ALL messages in the agent loop
})
```

---

## 7. Configuration

### OpenCode

```typescript
export const MyPlugin = async (input: PluginInput): Promise<Hooks> => {
  return {
    config: async (config) => {
      const apiKey = config.get<string>("api_key") ?? ""
      // use apiKey...
    },
    // ...
  }
}
```

### pi-mono

No built-in config hook. Choose the approach that fits your needs:

#### Option A: JSON config file

```typescript
import { readFileSync } from "fs"
import { join } from "path"

const configPath = join(process.env.HOME ?? "", ".pi", "my-plugin-config.json")
let pluginConfig: Record<string, unknown> = {}

try {
  pluginConfig = JSON.parse(readFileSync(configPath, "utf-8"))
} catch {
  // Config file doesn't exist yet, use defaults
}

export default function (pi: ExtensionAPI) {
  const apiKey = (pluginConfig.api_key as string) ?? ""
}
```

#### Option B: Environment variables

```typescript
export default function (pi: ExtensionAPI) {
  const apiKey = process.env.MY_PLUGIN_API_KEY ?? ""
}
```

#### Option C: CLI flags

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerFlag("my-plugin-key", {
    type: "string",
    description: "API key for my plugin",
  })

  // Later, in tool execute or event handler:
  const apiKey = pi.getFlag("my-plugin-key") as string | undefined
}
```

---

## 8. Shutdown / Cleanup

### OpenCode

```typescript
export const MyPlugin = async (): Promise<Hooks> => {
  return {
    stop: async () => {
      // Cleanup resources, close connections, etc.
      cleanup()
    },
  }
}
```

### pi-mono

Listen for the `session_shutdown` event:

```typescript
export default function (pi: ExtensionAPI) {
  let connection: SomeConnection | undefined

  pi.on("session_start", () => {
    connection = createConnection()
  })

  pi.on("session_shutdown", async (_event, ctx) => {
    connection?.close()
    connection = undefined
  })
}
```

---

## 9. Installation Location

### OpenCode

Installed via npm package or config, loaded by the opencode runtime automatically.

### pi-mono

| Method | Location | Example |
|--------|----------|---------|
| Global extension | `~/.pi/agent/extensions/*.ts` | `~/.pi/agent/extensions/my-ext.ts` |
| Project extension | `.pi/extensions/*.ts` | `.pi/extensions/my-ext.ts` |
| CLI flag | Any path | `pi -e ./my-extension.ts` |
| Multi-file (package) | Directory with `package.json` | See below |

#### Multi-file extension (package.json)

Create a directory with a `package.json`:

```json
{
  "name": "my-multi-file-extension",
  "private": true,
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Then install by placing the directory under `~/.pi/agent/extensions/` or `.pi/extensions/`.

---

## 10. Tool Return Value Format

### OpenCode

Returns a raw string:

```typescript
async execute(args, context) {
  return "Here are your search results..."
}
```

### pi-mono

Returns a structured `AgentToolResult<TDetails>`:

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  return {
    content: [{ type: "text", text: "Here are your search results..." }],
    details: {},          // Optional structured data for custom TUI rendering
    isError: false,       // Optional error flag
  }
}
```

### Content types

```typescript
type TextContent = { type: "text"; text: string }

type ImageContent =
  | { source: { type: "base64"; media_type: string; data: string } }
  | { source: { type: "url"; url: string } }

type ContentBlock = TextContent | { type: "image"; image: ImageContent }

interface AgentToolResult<TDetails = unknown> {
  content: ContentBlock[]
  details?: TDetails        // For custom TUI rendering via renderResult
  isError?: boolean         // Mark result as error
}
```

### Migration example: Simple string return

**Before (OpenCode):**
```typescript
return "Operation completed successfully"
```

**After (pi-mono):**
```typescript
return {
  content: [{ type: "text", text: "Operation completed successfully" }],
}
```

### Migration example: Error case

**Before (OpenCode):**
```typescript
throw new Error("API key missing")
// or return "Error: API key missing"
```

**After (pi-mono):**
```typescript
return {
  content: [{ type: "text", text: "Error: API key missing" }],
  isError: true,
}
```

### Migration example: With rich TUI rendering

```typescript
interface SearchResultDetails {
  count: number
  query: string
  results: Array<{ title: string; url: string }>
}

defineTool<{ details: SearchResultDetails }>({
  name: "web_search",
  // ...
  renderResult: (result) =>
    h("div", {},
      h("p", {}, `Found ${result.details?.count} results for "${result.details?.query}"`),
      ...(result.details?.results.map(r =>
        h("div", {}, h("a", { href: r.url }, r.title))
      ) ?? []),
    ),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const results = await doSearch(params.query)
    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
      details: {
        count: results.length,
        query: params.query,
        results,
      },
    }
  },
})
```

---

## Quick Reference Card

| Concept | OpenCode | pi-mono |
|---------|----------|---------|
| Package | `@opencode-ai/plugin` | `@mariozechner/pi-coding-agent` |
| Schema library | Zod | TypeBox (`@sinclair/typebox`) |
| Tool return | `string` | `AgentToolResult` |
| Events | Single handler + switch | Individual `pi.on(...)` handlers |
| Session ID | `context.sessionID` | `ctx.sessionManager.getSessionFile()` |
| Config | `Hooks.config()` | File / env vars / flags |
| Cleanup | `Hooks.stop()` | `session_shutdown` event |
| UI interaction | `context.ask()` | `ctx.ui.select()`, `ctx.ui.confirm()`, etc. |
| Cancel signal | `context.abort` | `signal` param + `ctx.signal` |
