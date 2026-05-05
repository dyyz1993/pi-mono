# Coordinator Extension - pi-agent-chat Integration Guide

## Overview

The coordinator extension enables cross-session communication and task delegation. It runs inside each pi agent process as an extension, communicating with pi-agent-chat's `AgentProcessManager` via the `"coordinator"` channel.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  pi-agent-chat (AgentProcessManager)             │
│                                                  │
│  client.channel("coordinator")                   │
│    .onReceive(data => {                          │
│      // Handle incoming __call from extension    │
│      // Return result to respond                 │
│    })                                            │
│                                                  │
│  client.channel("coordinator")                   │
│    .send({ type: "message_received", ... })      │
│    // Emit events to extension                   │
└───────────────────┬──────────────────────────────┘
                    │ stdin/stdout JSONL
└───────────────────┴──────────────────────────────┘
┌──────────────────────────────────────────────────┐
│  pi Agent Process (extension)                    │
│                                                  │
│  ServerChannel: handles __call from pi-agent-chat│
│  ClientChannel: sends __call to pi-agent-chat    │
│                                                  │
│  Tools: session_delegate, session_delegate_send, │
│         session_delegate_status, session_delegate_│
│         stop, session_delegate_fork              │
└──────────────────────────────────────────────────┘
```

## Key Communication Pattern

The extension uses `ClientChannel.call()` to send `__call` requests OUTBOUND to pi-agent-chat. pi-agent-chat must respond by returning a value from its `onReceive` handler.

**Critical**: The `RpcClient.handleLine()` does NOT await handler results. It calls handlers synchronously:

```typescript
for (const handler of handlers) {
    const result = handler(data.data);
    if (invokeId && result !== undefined) {
        this.writeLine({ type: "channel_data", name, data: { ...result, invokeId } });
    }
}
```

This means async handlers that return Promises will NOT work correctly with the auto-response mechanism. You **must** use the manual response pattern for any handler that performs async operations.

## Step-by-Step Integration

### Step 1: Register coordinator channel in `start()`

In `AgentProcessManager.start()`, add `"coordinator"` to the channel registration loop:

```typescript
for (const name of ["bash", "todo", "subagent", "lsp", "rules-engine", "memory", "coordinator"] as const) {
    client.channel(name).onReceive((data: unknown) => {
        this.handleCoordinatorCall(sessionId, data);
    });
}
```

### Step 2: Implement `handleCoordinatorCall()` with manual response

> **Warning**: You MUST use the manual response pattern below. The `RpcClient.handleLine()` does NOT await handlers, so returning a Promise from `onReceive` will send the unresolved Promise object as the response, causing the extension's `ClientChannel.call()` to receive garbage data.

```typescript
private async handleCoordinatorCall(sessionId: string, data: unknown): Promise<void> {
    const msg = data as Record<string, unknown>;
    const method = msg.__call as string;
    const invokeId = msg.invokeId as string | undefined;

    let result: unknown;
    try {
        switch (method) {
            case "session_delegate":
                result = await this.handleDelegate(sessionId, msg);
                break;
            case "session_delegate_send":
                result = await this.handleDelegateSend(sessionId, msg);
                break;
            case "session_delegate_status":
                result = await this.handleDelegateStatus(sessionId, msg);
                break;
            case "session_delegate_list":
                result = this.handleDelegateList();
                break;
            case "session_delegate_stop":
                result = await this.handleDelegateStop(sessionId, msg);
                break;
            case "session_delegate_fork":
                result = await this.handleDelegateFork(sessionId, msg);
                break;
            default:
                return;
        }
    } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
    }

    if (invokeId) {
        const managed = this.clients.get(sessionId);
        if (managed) {
            managed.client.channel("coordinator").send({ ...(result as object), invokeId });
        }
    }
}
```

### Step 3: Implement each handler

#### `handleDelegate()` — Create new session and send task

```typescript
private async handleDelegate(
    parentSessionId: string,
    msg: Record<string, unknown>,
): Promise<{ sessionId: string; status: "started" | "already_running" }> {
    const task = msg.task as string;
    const parent = this.clients.get(parentSessionId);
    if (!parent) throw new Error("Parent session not found");

    const projectPath = parent.info.projectPath;

    const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionDir = path.dirname(parent.info.sessionPath);
    const sessionPath = path.join(sessionDir, `${newSessionId}.jsonl`);

    const result = await this.start(newSessionId, projectPath, sessionPath);

    this.send(newSessionId, task);

    return { sessionId: newSessionId, status: result.status === "started" ? "started" : "already_running" };
}
```

#### `handleDelegateSend()` — Send message to target session

```typescript
private async handleDelegateSend(
    fromSessionId: string,
    msg: Record<string, unknown>,
): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }> {
    const targetSessionId = msg.targetSessionId as string;
    const message = msg.message as string;

    const target = this.clients.get(targetSessionId);
    if (!target) {
        return { delivered: false, targetStatus: "not_found" };
    }

    if (target.info.status === "idle") {
        this.followUp(targetSessionId, message);
        return { delivered: true, targetStatus: "active" };
    }

    this.followUp(targetSessionId, message);
    return { delivered: true, targetStatus: "active" };
}
```

#### `handleDelegateStatus()` — Get session status with compact info

```typescript
private async handleDelegateStatus(
    _sessionId: string,
    msg: Record<string, unknown>,
): Promise<{ status: string; isCompacting: boolean; contextUsage: unknown }> {
    const targetSessionId = msg.sessionId as string;

    const status = this.getStatus(targetSessionId);
    if (status.status === "stopped") {
        return { status: "stopped", isCompacting: false, contextUsage: { tokens: null, contextWindow: 0, percent: null } };
    }

    const state = await this.getState(targetSessionId);
    const contextUsage = await this.getContextUsage(targetSessionId);

    return {
        status: state?.isStreaming ? "streaming" : "idle",
        isCompacting: state?.isCompacting ?? false,
        contextUsage,
    };
}
```

#### `handleDelegateList()` — List all managed sessions

```typescript
private handleDelegateList(): { sessions: Array<{ sessionId: string; status: string; projectPath: string }> } {
    const sessions: Array<{ sessionId: string; status: string; projectPath: string }> = [];
    for (const [sessionId, managed] of this.clients) {
        sessions.push({
            sessionId,
            status: managed.info.status,
            projectPath: managed.info.projectPath,
        });
    }
    return { sessions };
}
```

#### `handleDelegateStop()` — Stop a session

```typescript
private async handleDelegateStop(
    _sessionId: string,
    msg: Record<string, unknown>,
): Promise<{ ok: boolean }> {
    const targetSessionId = msg.sessionId as string;
    const ok = this.stop(targetSessionId);
    return { ok };
}
```

#### `handleDelegateFork()` — Fork session without stopping original

```typescript
private async handleDelegateFork(
    parentSessionId: string,
    msg: Record<string, unknown>,
): Promise<{ sessionId: string; status: "started" | "already_running" }> {
    const task = msg.task as string;
    const base = this.clients.get(parentSessionId);
    if (!base) throw new Error("Base session not found");

    const sessionPath = base.info.sessionPath;
    const projectPath = base.info.projectPath;
    const sessionDir = path.dirname(sessionPath);

    // Primary approach: use SessionManager.createBranchedSession() for correct JSONL extraction
    // This handles tree-structured sessions and avoids half-write corruption
    import { SessionManager } from "@dyyz1993/pi-coding-agent";

    const sourceManager = SessionManager.open(sessionPath, sessionDir);
    const leafId = sourceManager.getLeafId();
    const forkedPath = sourceManager.createBranchedSession(leafId);

    // Fallback: if createBranchedSession is unavailable, use direct file copy
    // const forkedSessionId = `sess_fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // const forkedPath = path.join(sessionDir, `${forkedSessionId}.jsonl`);
    // fs.copyFileSync(sessionPath, forkedPath);

    const forkedSessionId = path.basename(forkedPath, ".jsonl");
    const result = await this.start(forkedSessionId, projectPath, forkedPath);

    this.send(forkedSessionId, task);

    return { sessionId: forkedSessionId, status: result.status === "started" ? "started" : "already_running" };
}
```

**Why `SessionManager.createBranchedSession()` is preferred over file copy**:

1. Extracts a single linear path from tree-structured sessions (after navigateTree/branch operations)
2. Filters and recreates label entries correctly
3. Generates a new session ID and header
4. Rebuilds internal index
5. Avoids reading a partially-written JSONL file (the source session may be actively writing)

File copy (`fs.copyFileSync`) is only safe as a fallback when you can guarantee the source session is idle and the JSONL is not being written to.

### Step 4: Emit events from pi-agent-chat to extension

To send events to the extension (e.g., message_received, task_completed), use:

```typescript
if (delegatedSessionId) {
    const managed = this.clients.get(parentSessionId);
    if (managed) {
        managed.client.channel("coordinator").send({
            type: "message_received",
            fromSessionId: delegatedSessionId,
            message: "Task completed successfully",
        });
    }
}
```

Or use `sendChannelData()`:

```typescript
this.sendChannelData(parentSessionId, "coordinator", {
    type: "task_completed",
    sessionId: delegatedSessionId,
    result: "Done",
});
```

### Step 5: Add coordinator extension path to config

In `server-config.ts`, add:

```typescript
coordinator: process.env.PI_EXT_COORDINATOR,
```

In `.env`:
```
PI_EXT_COORDINATOR=/path/to/pi-momo-fork/packages/coding-agent/extensions/coordinator
```

And add to the `EXTENSION_ARGS` array in `process-manager.ts`:

```typescript
const { coordinator, /* ...others */ } = config.piExtensionPaths;
const EXTENSION_ARGS = [
    "--no-extensions",
    ...[subagent, todo, bash, lsp, preview, autoMemory, autoSessionTitle, rules, fileSnapshot, askTools, messageBridge, coordinator]
        .filter((p): p is string => !!p)
        .flatMap((p) => ["--extension", p]),
];
```

## Channel Contract Reference

### Methods (pi-agent-chat handles these)

| Method | Params | Return |
|--------|--------|--------|
| `session_delegate` | `{ task: string, title?: string }` | `{ sessionId: string, status: "started" \| "already_running" }` |
| `session_delegate_send` | `{ targetSessionId: string, message: string }` | `{ delivered: boolean, targetStatus: "active" \| "started" \| "not_found" }` |
| `session_delegate_status` | `{ sessionId: string }` | `{ task?: DelegatedTask, isCompacting?: boolean, contextUsage?: ContextUsage }` |
| `session_delegate_list` | `{}` | `{ tasks: DelegatedTask[] }` |
| `session_delegate_stop` | `{ sessionId: string }` | `{ ok: boolean }` |
| `session_delegate_fork` | `{ sessionId: string, task: string, title?: string }` | `{ sessionId: string, status: "started" \| "already_running" }` |

### Events (pi-agent-chat sends these)

| Event | Data | When |
|-------|------|------|
| `message_received` | `{ fromSessionId: string, message: string }` | Worker session sends a message |
| `task_started` | `{ sessionId: string, title: string, task: string }` | Worker starts processing |
| `task_stopped` | `{ sessionId: string }` | Worker stopped |
| `task_completed` | `{ sessionId: string, result?: string }` | Worker finished |
| `task_error` | `{ sessionId: string, error: string }` | Worker errored |

### Types

```typescript
interface DelegatedTask {
    sessionId: string;
    title: string;
    task: string;
    projectPath: string;
    dispatchedAt: number;
    status: "idle" | "streaming" | "stopped" | "completed";
    completedAt?: number;
    result?: string;
}

interface ContextUsage {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
}
```

## Testing Checklist

- [ ] Register coordinator channel in `start()`
- [ ] `session_delegate` creates new session and sends task
- [ ] `session_delegate_send` delivers message via `followUp()`
- [ ] `session_delegate_status` returns status + isCompacting + contextUsage
- [ ] `session_delegate_list` lists all managed sessions
- [ ] `session_delegate_stop` stops target session
- [ ] `session_delegate_fork` copies session file and starts new process
- [ ] Events are emitted back to extension on state changes
- [ ] Async responses are sent manually via `channel.send()` with invokeId
- [ ] Coordinator extension path is configured in `.env`
- [ ] `handleEvent()` routes coordinator channel data correctly
