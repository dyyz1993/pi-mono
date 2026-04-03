# Extension System Architecture

## Overview

The extension system allows users to extend and customize the coding agent through a plugin architecture. Extensions can register tools, commands, event handlers, shortcuts, flags, message renderers, and providers.

## Core Concepts

### Extension Factory

Every extension is a TypeScript/JavaScript module that exports a default factory function:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI) {
  // Registration code here
}
```

### ExtensionAPI Interface

The `ExtensionAPI` (commonly named `pi`) provides all registration and action methods:

**Registration Methods:**
- `pi.on(event, handler)` - Register event handlers
- `pi.registerTool(tool)` - Register a tool for the LLM
- `pi.registerCommand(name, options)` - Register a slash command
- `pi.registerShortcut(shortcut, options)` - Register a keyboard shortcut
- `pi.registerFlag(name, options)` - Register a configuration flag
- `pi.registerMessageRenderer(customType, renderer)` - Register a custom message renderer
- `pi.registerProvider(name, config)` - Register an LLM provider
- `pi.unregisterProvider(name)` - Unregister a provider

**Action Methods:**
- `pi.sendMessage(message, options)` - Send a custom message
- `pi.sendUserMessage(content, options)` - Send a user message
- `pi.appendEntry(customType, data)` - Append a session entry
- `pi.setSessionName(name)` - Set session name
- `pi.getSessionName()` - Get session name
- `pi.setLabel(entryId, label)` - Set entry label
- `pi.exec(command, args, options)` - Execute a shell command
- `pi.getActiveTools()` - Get active tool names
- `pi.getAllTools()` - Get all tool info
- `pi.setActiveTools(toolNames)` - Set active tools
- `pi.getCommands()` - Get available commands
- `pi.setModel(model)` - Set the model
- `pi.getThinkingLevel()` / `pi.setThinkingLevel(level)` - Manage thinking level

**Properties:**
- `pi.events` - Shared event bus for extension communication
- `pi.cwd` - Current working directory

## Extension Loading Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Extension Discovery                          │
├─────────────────────────────────────────────────────────────────┤
│  1. Project-local: cwd/.pi/extensions/                           │
│  2. Global: agentDir/extensions/                                 │
│  3. Configured paths (from CLI/config)                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Extension Loading                            │
├─────────────────────────────────────────────────────────────────┤
│  1. Create ExtensionRuntime (with throwing stubs for actions)   │
│  2. For each extension:                                          │
│     - Create Extension object (empty collections)               │
│     - Create ExtensionAPI (bound to extension + runtime)        │
│     - Call factory function with API                            │
│     - Factory registers items via API                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Runner Binding                               │
├─────────────────────────────────────────────────────────────────┤
│  1. bindCore() replaces stub implementations with real ones     │
│  2. Process pending provider registrations                       │
│  3. Extensions can now use action methods                        │
└─────────────────────────────────────────────────────────────────┘
```

## Extension Object Structure

```typescript
interface Extension {
  path: string;                           // Original path
  resolvedPath: string;                   // Resolved absolute path
  sourceInfo: SourceInfo;                 // Source metadata
  handlers: Map<string, HandlerFn[]>;     // Event handlers
  tools: Map<string, RegisteredTool>;     // Registered tools
  messageRenderers: Map<string, MessageRenderer>; // Custom renderers
  commands: Map<string, RegisteredCommand>; // Slash commands
  flags: Map<string, ExtensionFlag>;      // Configuration flags
  shortcuts: Map<KeyId, ExtensionShortcut>; // Keyboard shortcuts
}
```

## ExtensionRuntime

Shared state created by the loader, used during both registration and runtime:

```typescript
interface ExtensionRuntime {
  // Flag values (defaults from registration, CLI overrides after)
  flagValues: Map<string, boolean | string>;
  
  // Queued provider registrations (processed during bindCore)
  pendingProviderRegistrations: Array<{
    name: string;
    config: ProviderConfig;
    extensionPath: string;
  }>;
  
  // Provider registration methods
  registerProvider: (name, config, extensionPath) => void;
  unregisterProvider: (name, extensionPath) => void;
  
  // Action methods (stubs during load, real after bindCore)
  sendMessage: SendMessageHandler;
  sendUserMessage: SendUserMessageHandler;
  // ... other action methods
}
```

## Two-Phase Initialization

### Phase 1: Loading (Factory Execution)

During this phase, action methods throw errors. Only registration is allowed:

```typescript
export default function myExtension(pi: ExtensionAPI) {
  // ✓ OK - Registration
  pi.registerTool({ name: "myTool", ... });
  pi.registerCommand("myCommand", { ... });
  pi.on("session_start", handler);
  
  // ✗ ERROR - Actions not available yet
  // pi.sendMessage({ ... });  // Throws!
  // pi.setSessionName("test"); // Throws!
}
```

### Phase 2: Runtime (After bindCore)

After `runner.bindCore()` is called, action methods work:

```typescript
// In event handlers (executed at runtime)
pi.on("session_start", async (event, ctx) => {
  // ✓ OK - Actions work in handlers
  pi.sendMessage({ customType: "greeting", content: "Hello!" });
});
```

## Event System

Extensions can subscribe to various events:

```typescript
// Common events
pi.on("session_start", async (event, ctx) => { ... });
pi.on("session_tree", async (event, ctx) => { ... });
pi.on("tool_start", async (event, ctx) => { ... });
pi.on("tool_end", async (event, ctx) => { ... });
pi.on("message", async (event, ctx) => { ... });

// Extension communication via shared event bus
pi.events.on("custom-event", (data) => { ... });
pi.events.emit("custom-event", payload);
```

## Tool Registration

Tools are functions the LLM can call:

```typescript
pi.registerTool({
  name: "myTool",
  label: "My Tool",
  description: "Does something useful",
  parameters: Type.Object({
    arg1: Type.String(),
    arg2: Type.Optional(Type.Number()),
  }),
  
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Implement tool logic
    return {
      content: [{ type: "text", text: "Result" }],
      details: { /* optional metadata */ }
    };
  },
  
  // Optional: Custom rendering
  renderCall(args, theme, context) { ... },
  renderResult(result, state, theme, context) { ... },
});
```

## Command Registration

Slash commands for user interaction:

```typescript
pi.registerCommand("myCommand", {
  description: "Do something",
  
  // Optional: Argument completion
  getArgumentCompletions: (prefix) => {
    return ["option1", "option2"]
      .filter(s => s.startsWith(prefix))
      .map(s => ({ value: s, label: s }));
  },
  
  async handler(args, ctx) {
    // ctx.hasUI - Check if in interactive mode
    // ctx.ui.notify(message, type) - Show notification
    // ctx.ui.select(title, items) - Show selection
    // ctx.ui.confirm(title, message) - Show confirmation
    // ctx.sessionManager - Access session state
  },
});
```

## State Management

Extensions can persist state via session entries:

```typescript
interface TodoDetails {
  action: "list" | "add" | "toggle";
  todos: Todo[];
  nextId: number;
}

// In tool execute:
return {
  content: [{ type: "text", text: "Added todo" }],
  details: { action: "add", todos, nextId } as TodoDetails,
};

// Reconstruct on session events:
pi.on("session_start", async (event, ctx) => {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && 
        entry.message.role === "toolResult" &&
        entry.message.toolName === "todo") {
      const details = entry.message.details as TodoDetails;
      // Restore state from details
    }
  }
});
```

## Provider Registration

Register custom LLM providers:

```typescript
pi.registerProvider("my-provider", {
  baseUrl: "https://api.example.com",
  api: "openai-responses", // or custom streamSimple handler
  apiKey: "MY_API_KEY", // or env var name
  models: [
    {
      id: "model-1",
      name: "Model 1",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    },
  ],
  // Optional: OAuth support
  oauth: {
    name: "My Provider",
    async login(callbacks) { ... },
    async refreshToken(credentials) { ... },
    getApiKey(credentials) { return credentials.access; },
  },
});
```

## Discovery Rules

Extensions are discovered in standard locations:

1. **Direct files**: `extensions/*.ts` or `*.js`
2. **Subdirectory with index**: `extensions/*/index.ts` or `index.js`
3. **Subdirectory with manifest**: `extensions/*/package.json` with `"pi"` field

```json
// package.json
{
  "pi": {
    "extensions": ["src/extension1.ts", "src/extension2.ts"]
  }
}
```

Priority: local (`.pi/extensions/`) → global (`~/.pi/agent/extensions/`) → configured paths

## Jiti Module Loading

Extensions are loaded using `jiti` for TypeScript support:

- **Development/Node.js**: Uses aliases to resolve `@mariozechner/*` packages
- **Bun Binary**: Uses virtual modules (bundled packages)

This allows extensions to import from:
- `@mariozechner/pi-coding-agent` - Main agent types and utilities
- `@mariozechner/pi-ai` - AI utilities and types
- `@mariozechner/pi-tui` - Terminal UI components
- `@mariozechner/pi-agent-core` - Core agent types
- `@sinclair/typebox` - Schema validation

## Example: Minimal Extension

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function minimalExtension(pi: ExtensionAPI) {
  // Register a simple command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello, ${args || "world"}!`, "info");
    },
  });
  
  // Register a tool
  pi.registerTool({
    name: "echo",
    label: "Echo",
    description: "Echo back a message",
    parameters: Type.Object({
      message: Type.String(),
    }),
    async execute(_id, params) {
      return {
        content: [{ type: "text", text: params.message }],
      };
    },
  });
}
```

## Best Practices

1. **Use TypeScript** - Get full type safety and IDE support
2. **Store state in session entries** - Enables proper branching
3. **Handle missing UI** - Check `ctx.hasUI` before UI interactions
4. **Use theme helpers** - `theme.fg()`, `theme.bg()` for consistent styling
5. **Clean up resources** - Use event handlers for initialization and cleanup
6. **Document commands** - Provide clear descriptions for user discovery
7. **Validate inputs** - Use TypeBox schemas for tool parameters
8. **Handle errors gracefully** - Return error messages in tool results
