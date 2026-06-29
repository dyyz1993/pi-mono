import type { DelegateReplyMode, SessionStatus } from "./types.ts";
import type { ProcessManagerApi } from "./handler.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServerProxy(client: { call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<any> }): ProcessManagerApi {
  return {
    async delegate(task, projectPath, replyMode?: DelegateReplyMode, agent?: string, model?: string) {
      return client.call("session_delegate", { task, projectPath, replyMode, agent, model });
    },

    async delegate_send(fromSessionId, toSessionId, message, mode?: "followUp" | "steer") {
      return client.call("session_delegate_send", {
        targetSessionId: toSessionId,
        message,
        mode,
      });
    },

    async delegate_status(sessionId) {
      try {
        const result = await client.call("session_delegate_status", { sessionId }) as { task: { status: SessionStatus } | null; status?: string };
        if (result.task) {
          return { status: result.task.status as SessionStatus };
        }
        // Handler may return status: "not_found" | "stopped" when task is null
        const rawStatus = (result as Record<string, unknown>).status as string | undefined;
        return { status: (rawStatus ?? "stopped") as SessionStatus };
      } catch (err) {
        console.debug("[coordinator] delegate_status failed:", err instanceof Error ? err.message : err);
        return { status: "stopped" as const };
      }
    },

    async delegate_list() {
      try {
        const result = await client.call("session_delegate_list", {}) as { tasks: unknown };
        return result.tasks as Array<{ sessionId: string; status: SessionStatus; projectPath: string }>;
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

    async delegate_fork(sessionId, task, title, projectPath, agent, model) {
      const result = await client.call("session_delegate_fork", { sessionId, task, title, projectPath, agent, model }) as Record<string, unknown>;
      const errMsg = result.error as string | undefined;
      if (errMsg) {
        throw new Error(errMsg);
      }
      return result as unknown as { sessionId: string; status: "started" | "already_running" };
    },

    async delegate_compact_status(sessionId: string) {
      try {
        const result = await client.call("session_delegate_status", { sessionId }) as { task: { isCompacting?: boolean; contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } } | null };
        return {
          isCompacting: result.task?.isCompacting ?? false,
          contextUsage: result.task?.contextUsage ?? { tokens: null as number | null, contextWindow: 0, percent: null as number | null },
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

    async delegate_sync(task, agent, timeoutMs, projectPath, model, depth, variables) {
      try {
        const result = await client.call(
          "session_delegate_sync",
          { task, title: agent ? `${agent}: ${task.slice(0, 40)}` : undefined, agent, model, timeoutMs, projectPath, depth, variables },
          timeoutMs + 30_000,
        );
        return result as { sessionId: string; status: "completed" | "timeout" | "error" | "aborted"; exitCode: number; finalText: string; error?: string };
      } catch (err) {
        return {
          sessionId: "",
          status: "error" as const,
          exitCode: 1,
          finalText: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
