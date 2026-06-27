import {
  createTypedChannel,
  type ExtensionAPI,
} from "@dyyz1993/pi-coding-agent";
import { Type } from "typebox";
import { COORDINATOR_CHANNEL_NAME, type CoordinatorChannelContract, type SessionStatus } from "./types.ts";
import { createCoordinatorHandler, TaskStore, type ProcessManagerApi } from "./handler.ts";
import { createServerProxy } from "./server-proxy.ts";

/**
 * Parse a structured completion signal from a delegated session message.
 *
 * Structured format: a line starting with `__COMPLETION_SIGNAL__` followed by
 * a JSON payload: `__COMPLETION_SIGNAL__{"result":"..."}`
 *
 * Falls back to legacy text markers: `[completed]`, `[done]`, `task completed`.
 * Returns `{ result }` on match, or `null` if no completion signal detected.
 */
function parseCompletionSignal(message: string): { result?: string } | null {
  // Structured signal: __COMPLETION_SIGNAL__{"result":"..."}
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("__COMPLETION_SIGNAL__")) {
      try {
        const payload = JSON.parse(trimmed.slice("__COMPLETION_SIGNAL__".length));
        return { result: typeof payload.result === "string" ? payload.result : undefined };
      } catch {
        // Malformed JSON — treat as completion with no result
        return { result: undefined };
      }
    }
  }

  // Legacy text markers (backward compat)
  const lower = message.toLowerCase();
  if (lower.includes("[completed]") || lower.includes("[done]") || lower.includes("task completed")) {
    return { result: message };
  }

  return null;
}

const DelegateParams = Type.Object({
  task: Type.String({ description: "Task description to delegate to the background session" }),
  title: Type.Optional(Type.String({ description: "Short title for this delegated task" })),
  projectPath: Type.Optional(Type.String({ description: "Project directory to run the delegated session in. Defaults to the current working directory." })),
  replyMode: Type.Optional(Type.Union([
    Type.Literal("interrupt"),
    Type.Literal("followUp"),
    Type.Literal("auto"),
  ], { description: "How delegate replies should be delivered to the parent session. interrupt = insert/steer into the parent immediately (default); followUp = queue until the parent finishes; auto = immediate when idle, follow-up when busy." })),
});

const DelegateSendParams = Type.Object({
  targetSessionId: Type.String({ description: "Session ID to send the message to" }),
  message: Type.String({ description: "Message content to send" }),
  mode: Type.Optional(Type.Union([
    Type.Literal("steer"),
    Type.Literal("followUp"),
  ], { description: "Override delivery for this message. Omit to use the replyMode chosen when the delegate was created." })),
});

const DelegateStatusParams = Type.Object({
  sessionId: Type.String({ description: "Session ID to check status for" }),
});

const DelegateStopParams = Type.Object({
  sessionId: Type.String({ description: "Session ID to stop" }),
});

const DelegateForkParams = Type.Object({
  sessionId: Type.String({ description: "Source session ID to fork from" }),
  task: Type.String({ description: "Task description for the forked session" }),
  title: Type.Optional(Type.String({ description: "Short title for the forked task" })),
  projectPath: Type.Optional(Type.String({ description: "Project directory to run the forked session in. Defaults to the current working directory." })),
});

export { createServerProxy } from "./server-proxy.ts";

export default function coordinatorExtension(pi: ExtensionAPI) {
  const rawChannel = pi.registerChannel(COORDINATOR_CHANNEL_NAME);

  const { server: serverChannel, client } = createTypedChannel<CoordinatorChannelContract>(rawChannel);

  let currentSessionId = "";
  let store: TaskStore | null = null;

  pi.on("session_start", (_event, ctx) => {
    currentSessionId = ctx.sessionManager.getSessionId();
    store = new TaskStore(ctx.sessionManager.getSessionDir());
  });

  const serverProxy = createServerProxy(client as never);

  createCoordinatorHandler(
    serverChannel,
    serverProxy,
    () => currentSessionId,
    () => store ?? new TaskStore("/tmp/coordinator-fallback"),
  );

  pi.on("context", (event, _ctx) => {
    if (!store) return;
    const prompt = store.buildPrompt();
    if (prompt) {
      event.messages.push({
        role: "user",
        content: [{ type: "text", text: prompt }],
        timestamp: Date.now(),
      });
    }
  });

  pi.registerTool({
    name: "session_delegate",
    label: "Session Delegate",
    description: [
      "Delegate a task to a background pi session asynchronously.",
      "Optionally specify a projectPath to run the session in a specific project directory.",
      "Choose replyMode at creation time: interrupt (default, delegate replies are inserted into this parent immediately), followUp (queue replies until this parent finishes), or auto (idle sends immediately, busy queues).",
      "Returns immediately with a sessionId; do not poll session_delegate_status just to wait for completion.",
      "After delegating, stop and wait for the delegated session to report back by calling session_delegate_send to this parent session.",
      "Use session_delegate_status only for explicit user-requested diagnostics, recovery, or troubleshooting.",
      "The delegate session is automatically restarted if inactive when receiving messages.",
    ].join(" "),
    parameters: DelegateParams,
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const sid = currentSessionId || ctx.sessionManager.getSessionId();
        const projectPath = params.projectPath || ctx.cwd;
        const result = await serverProxy.delegate(params.task, projectPath, params.replyMode);

        if (!result.sessionId) {
          console.debug("[coordinator] delegate failed: no sessionId returned");
          pi.appendEntry("coordinator_delegate_failed", { task: params.task, projectPath });
          return {
            content: [{ type: "text" as const, text: `Failed to delegate task: no sessionId returned.` }],
            details: { error: "no sessionId" },
          };
        }

        pi.appendEntry("coordinator_delegate", {
          sessionId: result.sessionId,
          status: result.status,
          task: params.task,
          title: params.title,
          projectPath,
          replyMode: params.replyMode ?? "interrupt",
          dispatchedBy: sid,
        });
        return {
          content: [{ type: "text" as const, text: `Delegated task to session ${result.sessionId} (status: ${result.status}, cwd: ${projectPath}, replyMode: ${params.replyMode ?? "interrupt"}). This is asynchronous: do not poll for completion; the delegated session is instructed to call session_delegate_send back to this parent when it has progress or a final result.` }],
          details: { ...result, dispatchedBy: sid, projectPath, replyMode: params.replyMode ?? "interrupt" },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${errorMsg}` }], details: { error: errorMsg }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "session_delegate_send",
    label: "Session Delegate Send",
    description: [
      "Send a message to a delegated session by sessionId.",
      "If the target session is not active, the server will automatically restart it",
      "(same as clicking on the session in the UI) and deliver the message.",
      "Omit mode to use the replyMode chosen when the delegate was created; pass mode=steer to interrupt/insert immediately, or mode=followUp to queue.",
      "This tool only fails if the session file has been physically deleted from disk.",
    ].join(" "),
    parameters: DelegateSendParams,
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const sid = currentSessionId || ctx.sessionManager.getSessionId();
        const result = await serverProxy.delegate_send(sid, params.targetSessionId, params.message, params.mode);

        if (!result.delivered) {
          pi.appendEntry("coordinator_send_failed", { fromSessionId: sid, toSessionId: params.targetSessionId });
          return {
            content: [{ type: "text" as const, text: `Could not deliver message to ${params.targetSessionId}: session not found (the session file may have been deleted from disk)` }],
            details: { delivered: false, targetSessionId: params.targetSessionId },
          };
        }

        pi.appendEntry("coordinator_send", { fromSessionId: sid, toSessionId: params.targetSessionId, status: result.targetStatus });
        return {
          content: [{ type: "text" as const, text: `Message delivered to ${params.targetSessionId} (status: ${result.targetStatus})` }],
          details: result,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${errorMsg}` }], details: { error: errorMsg }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "session_delegate_status",
    label: "Session Delegate Status",
    description: "Diagnostic-only status check for a delegated task session. Do not use this in a polling loop after session_delegate; asynchronous delegates are expected to call session_delegate_send back when they have progress or final results.",
    parameters: DelegateStatusParams,
    async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
      const task = store?.get(params.sessionId);
      if (task) {
        const status = task.status === "completed" ? "DONE" : task.status.toUpperCase();
        return {
          content: [{ type: "text" as const, text: `Task "${task.title}" (${params.sessionId}): ${status}` }],
          details: { task },
        };
      }
      const remote = await serverProxy.delegate_status(params.sessionId);
      return {
        content: [{ type: "text" as const, text: `Session ${params.sessionId} status: ${remote.status}` }],
        details: { task: null },
      };
    },
  });

  pi.registerTool({
    name: "session_delegate_fork",
    label: "Session Delegate Fork",
    description: [
      "Fork an existing session and delegate a new task to the forked session.",
      "The forked session starts with a copy of the source session's conversation history.",
      "Optionally specify a projectPath to run the forked session in a specific project directory.",
      "The original session continues running unchanged.",
    ].join(" "),
    parameters: DelegateForkParams,
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const sid = currentSessionId || ctx.sessionManager.getSessionId();
        const projectPath = params.projectPath || ctx.cwd;
        const result = await serverProxy.delegate_fork(params.sessionId, params.task, params.title, projectPath);
        pi.appendEntry("coordinator_fork", {
          sessionId: result.sessionId,
          forkedFrom: params.sessionId,
          status: result.status,
          task: params.task,
          title: params.title,
          projectPath,
          dispatchedBy: sid,
        });
        return {
          content: [{ type: "text" as const, text: `Forked session ${params.sessionId} → ${result.sessionId} (status: ${result.status}, cwd: ${projectPath}). Task: ${params.task}` }],
          details: { ...result, forkedFrom: params.sessionId, dispatchedBy: sid, projectPath },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${errorMsg}` }], details: { error: errorMsg }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "session_delegate_stop",
    label: "Session Delegate Stop",
    description: "Stop a delegated task session.",
    parameters: DelegateStopParams,
    async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
      const ok = await serverProxy.delegate_stop(params.sessionId);
      pi.appendEntry("coordinator_stop", { sessionId: params.sessionId, ok });
      return {
        content: [{ type: "text" as const, text: ok ? `Session ${params.sessionId} stopped.` : `Session ${params.sessionId} not found or already stopped.` }],
        details: { ok },
      };
    },
  });

  pi.registerTool({
    name: "session_delegate_remove",
    label: "Session Delegate Remove",
    description: [
      "Remove a delegated task from the task list.",
      "Stops the session if still running, then removes the task entry.",
      "Use this to clean up completed, stopped, or zombie tasks.",
    ].join(" "),
    parameters: DelegateStatusParams,
    async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
      const ok = await serverProxy.delegate_remove(params.sessionId);
      pi.appendEntry("coordinator_remove", { sessionId: params.sessionId, ok });
      return {
        content: [{ type: "text" as const, text: ok ? `Task ${params.sessionId} removed.` : `Task ${params.sessionId} not found.` }],
        details: { ok },
      };
    },
  });

  pi.registerTool({
    name: "session_delegate_clear_stopped",
    label: "Session Delegate Clear Stopped",
    description: [
      "Remove all stopped and completed tasks from the task list.",
      "Use this to clean up accumulated zombie tasks.",
    ].join(" "),
    parameters: Type.Object({}),
    async execute(toolCallId, _params, _signal, _onUpdate, _ctx) {
      const removed = await serverProxy.delegate_clear_stopped();
      pi.appendEntry("coordinator_clear_stopped", { removed });
      return {
        content: [{ type: "text" as const, text: `Cleared ${removed} stopped/completed task(s).` }],
        details: { removed },
      };
    },
  });

  client.on("message_received", (d) => {
    // Skip messages from sessions that have been stopped
    const task = store?.get(d.fromSessionId);
    if (task?.status === "stopped") return;

    // Detect completion signals from delegated sessions
    if (store && task) {
      const completion = parseCompletionSignal(d.message);
      if (completion) {
        store.update(d.fromSessionId, { status: "completed", completedAt: Date.now(), result: completion.result ?? d.message });
        pi.appendEntry("coordinator_task_completed", { sessionId: d.fromSessionId, task: task.title, result: (completion.result ?? d.message).slice(0, 200) });
      } else if (task.status !== "completed") {
        store.update(d.fromSessionId, { status: "streaming" });
      }
    }

    try {
      pi.sendUserMessage(
        `[Coordinator] Message from session ${d.fromSessionId}:\n${d.message}`,
        { deliverAs: "followUp" },
      );
    } catch (err) {
      // Silently ignore stale-ctx errors: the extension runtime may have been
      // invalidated by a concurrent session replacement or reload. The new
      // runtime's handler will take over.
      if (err instanceof Error && err.message.includes("stale")) {
        return;
      }
      throw err;
    }
  });
}
