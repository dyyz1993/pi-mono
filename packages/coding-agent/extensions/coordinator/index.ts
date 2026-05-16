import {
  createTypedChannel,
  type ExtensionAPI,
} from "@dyyz1993/pi-coding-agent";
import { Type } from "typebox";
import { COORDINATOR_CHANNEL_NAME, type CoordinatorChannelContract, type SessionStatus } from "./types.js";
import { createCoordinatorHandler, TaskStore, type ProcessManagerApi } from "./handler.js";

const DelegateParams = Type.Object({
  task: Type.String({ description: "Task description to delegate to the background session" }),
  title: Type.Optional(Type.String({ description: "Short title for this delegated task" })),
  projectPath: Type.Optional(Type.String({ description: "Project directory to run the delegated session in. Defaults to the current working directory." })),
});

const DelegateSendParams = Type.Object({
  targetSessionId: Type.String({ description: "Session ID to send the message to" }),
  message: Type.String({ description: "Message content to send" }),
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

export default function coordinatorExtension(pi: ExtensionAPI) {
  const rawChannel = pi.registerChannel(COORDINATOR_CHANNEL_NAME);

  const { server: serverChannel, client } = createTypedChannel<CoordinatorChannelContract>(rawChannel);

  let currentSessionId = "";
  let store: TaskStore | null = null;

  pi.on("session_start", (_event, ctx) => {
    currentSessionId = ctx.sessionManager.getSessionId();
    store = new TaskStore(ctx.sessionManager.getSessionDir());
  });

  const serverProxy: ProcessManagerApi = {
    async delegate(task, projectPath) {
      return client.call("session_delegate", { task, projectPath }) as Promise<{ sessionId: string; status: "started" | "already_running" }>;
    },

    async delegate_send(fromSessionId, toSessionId, message) {
      return client.call("session_delegate_send", {
        targetSessionId: toSessionId,
        message,
      }) as Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }>;
    },

    async delegate_status(sessionId) {
      try {
        const result = await client.call("session_delegate_status", { sessionId }) as { task: { status: string } | null };
        return result.task ? { status: result.task.status as SessionStatus } : { status: "stopped" as const };
      } catch (err) {
        console.debug("[coordinator] delegate_status failed:", err instanceof Error ? err.message : err);
        return { status: "stopped" as const };
      }
    },

    async delegate_list() {
      try {
        const result = await client.call("session_delegate_list", {}) as { tasks: Array<{ sessionId: string; status: SessionStatus; projectPath: string }> };
        return result.tasks;
      } catch (err) {
        console.debug("[coordinator] delegate_list failed:", err instanceof Error ? err.message : err);
        return [];
      }
    },

    async delegate_stop(sessionId) {
      try {
        const result = await client.call("session_delegate_stop", { sessionId }) as { ok: boolean };
        return result.ok;
      } catch (err) {
        console.debug("[coordinator] delegate_stop failed:", err instanceof Error ? err.message : err);
        return false;
      }
    },

    async delegate_fork(sessionId, task, title, projectPath) {
      return client.call("session_delegate_fork", { sessionId, task, title, projectPath }) as Promise<{ sessionId: string; status: "started" | "already_running" }>;
    },

    async delegate_compact_status(sessionId: string) {
      try {
        const result = await client.call("session_delegate_status", { sessionId }) as { isCompacting?: boolean; contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } };
        return {
          isCompacting: result.isCompacting ?? false,
          contextUsage: result.contextUsage ?? { tokens: null as number | null, contextWindow: 0, percent: null as number | null },
        };
      } catch (err) {
        console.debug("[coordinator] delegate_compact_status failed:", err instanceof Error ? err.message : err);
        return { isCompacting: false, contextUsage: { tokens: null as number | null, contextWindow: 0, percent: null as number | null } };
      }
    },

    async delegate_remove(sessionId: string) {
      try {
        const result = await client.call("session_delegate_remove", { sessionId }) as { ok: boolean };
        return result.ok;
      } catch (err) {
        console.debug("[coordinator] delegate_remove failed:", err instanceof Error ? err.message : err);
        return false;
      }
    },

    async delegate_clear_stopped() {
      try {
        const result = await client.call("session_delegate_clear_stopped", {}) as { removed: number };
        return result.removed;
      } catch (err) {
        console.debug("[coordinator] delegate_clear_stopped failed:", err instanceof Error ? err.message : err);
        return 0;
      }
    },
  };

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
      "Delegate a task to a background pi session.",
      "Optionally specify a projectPath to run the session in a specific project directory.",
      "Returns a sessionId for communication via session_delegate_send.",
      "The delegated session can message back using its own coordinator channel.",
      "The delegate session is automatically restarted if inactive when receiving messages.",
    ].join(" "),
    parameters: DelegateParams,
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const sid = currentSessionId || ctx.sessionManager.getSessionId();
      const projectPath = params.projectPath || ctx.cwd;
      const result = await serverProxy.delegate(params.task, projectPath);

      if (!result.sessionId) {
        return {
          content: [{ type: "text" as const, text: `Failed to delegate task: no sessionId returned.` }],
          details: { error: "no sessionId" },
        };
      }

      return {
        content: [{ type: "text" as const, text: `Delegated task to session ${result.sessionId} (status: ${result.status}, cwd: ${projectPath}). Use session_delegate_send to communicate.` }],
        details: { ...result, dispatchedBy: sid, projectPath },
      };
    },
  });

  pi.registerTool({
    name: "session_delegate_send",
    label: "Session Delegate Send",
    description: [
      "Send a message to a delegated session by sessionId.",
      "If the target session is not active, the server will automatically restart it",
      "(same as clicking on the session in the UI) and deliver the message.",
      "The message is injected as a followUp into the target session.",
      "This tool only fails if the session file has been physically deleted from disk.",
    ].join(" "),
    parameters: DelegateSendParams,
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const sid = currentSessionId || ctx.sessionManager.getSessionId();
      const result = await serverProxy.delegate_send(sid, params.targetSessionId, params.message);

      if (!result.delivered) {
        return {
          content: [{ type: "text" as const, text: `Could not deliver message to ${params.targetSessionId}: session not found (the session file may have been deleted from disk)` }],
          details: { delivered: false, targetSessionId: params.targetSessionId },
        };
      }

      return {
        content: [{ type: "text" as const, text: `Message delivered to ${params.targetSessionId} (status: ${result.targetStatus})` }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "session_delegate_status",
    label: "Session Delegate Status",
    description: "Check the status of a delegated task session.",
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
    name: "session_delegate_stop",
    label: "Session Delegate Stop",
    description: "Stop a delegated task session.",
    parameters: DelegateStopParams,
    async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
      const ok = await serverProxy.delegate_stop(params.sessionId);
      return {
        content: [{ type: "text" as const, text: ok ? `Session ${params.sessionId} stopped.` : `Session ${params.sessionId} not found or already stopped.` }],
        details: { ok },
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
      const sid = currentSessionId || ctx.sessionManager.getSessionId();
      const projectPath = params.projectPath || ctx.cwd;
      const result = await serverProxy.delegate_fork(params.sessionId, params.task, params.title, projectPath);
      return {
        content: [{ type: "text" as const, text: `Forked session ${params.sessionId} → ${result.sessionId} (status: ${result.status}, cwd: ${projectPath}). Task: ${params.task}` }],
        details: { ...result, forkedFrom: params.sessionId, dispatchedBy: sid, projectPath },
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
      return {
        content: [{ type: "text" as const, text: `Cleared ${removed} stopped/completed task(s).` }],
        details: { removed },
      };
    },
  });

  client.on("message_received", (data: unknown) => {
    const d = data as { fromSessionId: string; message: string };
    // Skip messages from sessions that have been stopped
    const task = store?.get(d.fromSessionId);
    if (task?.status === "stopped") return;

    // Detect completion signals from delegated sessions
    if (store && task) {
      const lowerMsg = d.message.toLowerCase();
      const isCompletion = lowerMsg.includes("[completed]") || lowerMsg.includes("[done]") || lowerMsg.includes("task completed");
      if (isCompletion) {
        store.update(d.fromSessionId, { status: "completed", completedAt: Date.now(), result: d.message });
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
