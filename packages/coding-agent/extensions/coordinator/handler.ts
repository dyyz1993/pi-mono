import * as fs from "node:fs";
import * as path from "node:path";
import type { ServerChannel } from "@dyyz1993/pi-coding-agent";
import type {
  CoordinatorChannelContract,
  DelegatedTask,
  DelegateCreateResult,
  DelegateReplyMode,
  DelegateStatusDetail,
  SessionStatus,
} from "./types.ts";

export const DEFAULT_ASYNC_DELEGATE_TIMEOUT_MS = 10 * 60 * 1000;

export interface ProcessManagerApi {
  delegate(
    task: string,
    projectPath: string,
    replyMode?: DelegateReplyMode,
    agent?: string,
    model?: string,
    timeoutMs?: number
  ): Promise<{ sessionId: string; status: "started" | "already_running" }>;
  delegate_send(
    fromSessionId: string,
    toSessionId: string,
    message: string,
    mode?: "followUp" | "steer"
  ): Promise<{
    delivered: boolean;
    targetStatus: "active" | "started" | "not_found";
  }>;
  delegate_status(
    sessionId: string
  ): Promise<{
    status: SessionStatus | "not_found";
    detail?: DelegateStatusDetail;
  }>;
  delegate_list(): Promise<
    Array<{ sessionId: string; status: SessionStatus; projectPath: string }>
  >;
  delegate_stop(sessionId: string): Promise<boolean>;
  delegate_fork(
    sessionId: string,
    task: string,
    title?: string,
    projectPath?: string,
    agent?: string,
    model?: string
  ): Promise<{ sessionId: string; status: "started" | "already_running" }>;
  delegate_compact_status(
    sessionId: string
  ): Promise<{
    isCompacting: boolean;
    contextUsage: {
      tokens: number | null;
      contextWindow: number;
      percent: number | null;
    };
  }>;
  delegate_remove(sessionId: string): Promise<boolean>;
  delegate_clear_stopped(): Promise<number>;
  delegate_sync(
    task: string,
    agent: string | undefined,
    timeoutMs: number,
    projectPath: string,
    model?: string,
    depth?: number,
    variables?: Record<string, string>
  ): Promise<{
    sessionId: string;
    status: "completed" | "timeout" | "error" | "aborted";
    exitCode: number;
    finalText: string;
    error?: string;
  }>;
}

export class TaskStore {
  private filePath: string;
  private tasks = new Map<string, DelegatedTask>();

  constructor(sessionDir: string) {
    this.filePath = path.join(sessionDir, "coordinator-tasks.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const arr = JSON.parse(raw) as DelegatedTask[];
        for (const task of arr) {
          this.tasks.set(task.sessionId, task);
        }
      }
    } catch (err) {
      console.debug(
        "[coordinator] task file load failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  private save(): void {
    const arr = Array.from(this.tasks.values());
    fs.writeFileSync(this.filePath, JSON.stringify(arr, null, 2), "utf-8");
  }

  add(task: DelegatedTask): void {
    if (!task.sessionId) {
      throw new Error("[coordinator] cannot add task with empty sessionId");
    }
    this.tasks.set(task.sessionId, task);
    this.save();
  }

  get(sessionId: string): DelegatedTask | undefined {
    return this.tasks.get(sessionId);
  }

  update(sessionId: string, patch: Partial<DelegatedTask>): void {
    const existing = this.tasks.get(sessionId);
    if (!existing) return;
    Object.assign(existing, patch);
    this.save();
  }

  remove(sessionId: string): void {
    this.tasks.delete(sessionId);
    this.save();
  }

  list(): DelegatedTask[] {
    return Array.from(this.tasks.values());
  }

  clearStopped(): number {
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (task.status === "stopped" || task.status === "completed") {
        this.tasks.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.save();
    return removed;
  }

  markStopped(sessionId: string, now: number = Date.now()): void {
    const existing = this.tasks.get(sessionId);
    if (!existing) return;
    this.update(sessionId, {
      status: "stopped",
      completedAt: existing.completedAt ?? now,
    });
  }

  buildPrompt(): string {
    const tasks = this.list();
    if (tasks.length === 0) return "";

    const lines = [
      "## Delegated Tasks",
      "",
      "Async delegate contract: after starting a delegated task, do not poll `session_delegate_status` just to wait for completion. The child session must call `session_delegate_send` back to this parent when it has progress or a final result. You can start other work while waiting; delegate replies will be delivered according to the task replyMode. Use status checks only for explicit diagnostics, recovery, or user-requested troubleshooting.",
      "",
    ];
    for (const t of tasks) {
      const status =
        t.status === "completed"
          ? "DONE"
          : t.status === "stopped"
          ? "STOPPED"
          : t.status.toUpperCase();
      const compactTag = t.isCompacting ? " COMPACTING" : "";
      const ctxUsage = t.contextUsage;
      const ctxTag =
        ctxUsage?.percent != null
          ? ` ctx:${Math.round(ctxUsage.percent)}%`
          : "";
      const replyMode = t.replyMode ?? "interrupt";
      const elapsed = t.completedAt
        ? `${((t.completedAt - t.dispatchedAt) / 1000).toFixed(1)}s`
        : `${((Date.now() - t.dispatchedAt) / 1000).toFixed(0)}s elapsed`;
      lines.push(
        `- **${t.title}** (id: \`${t.sessionId}\`) — ${status}${compactTag}${ctxTag} — replyMode:${replyMode} — ${elapsed}`
      );
      if (t.result) {
        const preview =
          t.result.length > 200 ? `${t.result.slice(0, 200)}...` : t.result;
        lines.push(`  > ${preview}`);
      }
    }
    return lines.join("\n");
  }
}

function normalizeDelegateTimeoutMs(timeoutMs: unknown): number {
  if (typeof timeoutMs !== "number") return DEFAULT_ASYNC_DELEGATE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_ASYNC_DELEGATE_TIMEOUT_MS;
  }
  return timeoutMs;
}

function formatTimeoutResult(timeoutMs: number): string {
  return `Timed out after ${timeoutMs}ms`;
}

function resolveTaskStatus(
  current: DelegatedTask,
  remoteStatus: SessionStatus
): Pick<DelegatedTask, "status" | "completedAt"> {
  if (remoteStatus === "stopped" || remoteStatus === "completed") {
    return {
      status: remoteStatus,
      completedAt: current.completedAt ?? Date.now(),
    };
  }

  if (remoteStatus === "streaming") {
    return { status: "streaming", completedAt: undefined };
  }

  if (current.status === "streaming") {
    return {
      status: "completed",
      completedAt: current.completedAt ?? Date.now(),
    };
  }

  if (current.status === "completed" || current.status === "stopped") {
    return {
      status: current.status,
      completedAt: current.completedAt,
    };
  }

  return { status: "idle", completedAt: undefined };
}

export function createCoordinatorHandler(
  channel: ServerChannel<CoordinatorChannelContract>,
  pm: ProcessManagerApi,
  getSessionId: () => string,
  getStore: () => TaskStore
): void {
  const timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelDelegateTimeout = (sessionId: string): void => {
    const handle = timeoutHandles.get(sessionId);
    if (handle) clearTimeout(handle);
    timeoutHandles.delete(sessionId);
  };

  const markTaskStopped = (
    sessionId: string,
    options: { error?: string; result?: string } = {}
  ): boolean => {
    const store = getStore();
    const task = store.get(sessionId);
    if (!task) return false;
    const wasTerminal = task.status === "stopped" || task.status === "completed";
    store.update(sessionId, {
      status: "stopped",
      completedAt: task.completedAt ?? Date.now(),
      result: options.result ?? task.result,
    });
    cancelDelegateTimeout(sessionId);
    if (!wasTerminal) {
      channel.emit("task_stopped", { sessionId });
      if (options.error) {
        channel.emit("task_error", {
          sessionId,
          error: options.error,
        });
      }
    }
    return !wasTerminal;
  };

  const stopTaskForTimeout = async (sessionId: string): Promise<boolean> => {
    const store = getStore();
    const task = store.get(sessionId);
    if (!task || task.status === "stopped" || task.status === "completed") {
      cancelDelegateTimeout(sessionId);
      return false;
    }

    let remoteStatus: SessionStatus | "not_found" = task.status;
    try {
      remoteStatus = (await pm.delegate_status(sessionId)).status;
    } catch {
      remoteStatus = "not_found";
    }
    if (remoteStatus === "not_found") {
      markTaskStopped(sessionId, { error: "Delegate session not found" });
      return false;
    }
    if (remoteStatus !== "streaming") {
      cancelDelegateTimeout(sessionId);
      store.update(sessionId, resolveTaskStatus(task, remoteStatus));
      return false;
    }

    cancelDelegateTimeout(sessionId);
    try {
      await pm.delegate_stop(sessionId);
    } catch {
      // The task may already be gone. Preserve the timeout in the coordinator
      // store so the parent can observe a terminal state instead of streaming.
    }

    const timeoutMs = task.timeoutMs ?? DEFAULT_ASYNC_DELEGATE_TIMEOUT_MS;
    markTaskStopped(sessionId, {
      result: formatTimeoutResult(timeoutMs),
      error: formatTimeoutResult(timeoutMs),
    });
    return true;
  };

  const stopOverdueTask = async (task: DelegatedTask): Promise<boolean> => {
    if (!task.timeoutAt) return false;
    if (task.status === "stopped" || task.status === "completed") {
      cancelDelegateTimeout(task.sessionId);
      return false;
    }
    if (Date.now() < task.timeoutAt) return false;
    return stopTaskForTimeout(task.sessionId);
  };

  const scheduleDelegateTimeout = (task: DelegatedTask): void => {
    if (!task.timeoutAt) return;
    cancelDelegateTimeout(task.sessionId);
    const delay = Math.max(0, task.timeoutAt - Date.now());
    const handle = setTimeout(() => {
      void stopTaskForTimeout(task.sessionId);
    }, delay);
    timeoutHandles.set(task.sessionId, handle);
  };

  channel.handle("session_delegate", async (params) => {
    const {
      task,
      title,
      agent,
      model,
      projectPath: rawProjectPath,
      replyMode,
      timeoutMs: rawTimeoutMs,
    } = params;
    const projectPath = rawProjectPath || process.cwd();
    const timeoutMs = normalizeDelegateTimeoutMs(rawTimeoutMs);
    const dispatchedAt = Date.now();
    const timeoutAt = dispatchedAt + timeoutMs;

    let result: DelegateCreateResult;
    try {
      result = await pm.delegate(
        task,
        projectPath,
        replyMode,
        agent,
        model,
        timeoutMs
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        sessionId: `error-${Date.now()}`,
        status: "already_running" as const,
        error: msg,
      };
    }

    if (!result.sessionId) {
      return {
        sessionId: `error-${Date.now()}`,
        status: "already_running" as const,
        error: "[coordinator] delegate failed: no sessionId returned",
      };
    }

    getStore().add({
      sessionId: result.sessionId,
      title: title || task.slice(0, 60),
      task,
      projectPath,
      dispatchedAt,
      status: "idle",
      replyMode: replyMode ?? "interrupt",
      timeoutMs,
      timeoutAt,
    });
    const storedTask = getStore().get(result.sessionId);
    if (storedTask) scheduleDelegateTimeout(storedTask);

    channel.emit("task_started", {
      sessionId: result.sessionId,
      title: title || task.slice(0, 60),
      task,
    });

    return result;
  });

  channel.handle("session_delegate_send", async (params) => {
    const { targetSessionId, message, mode } = params;
    const result = await pm.delegate_send(
      getSessionId(),
      targetSessionId,
      message,
      mode
    );

    if (result.targetStatus === "not_found") {
      // Ghost session — remove from store
      getStore().remove(targetSessionId);
    } else if (result.delivered) {
      const store = getStore();
      const task = store.get(targetSessionId);
      if (task && task.status === "stopped") {
        store.update(targetSessionId, {
          status: "idle",
          completedAt: undefined,
        });
      }
    }

    return result;
  });

  channel.handle("session_delegate_status", async (params) => {
    const { sessionId } = params;
    const store = getStore();
    const task = store.get(sessionId);
    if (!task) {
      try {
        const remote = await pm.delegate_status(sessionId);
        return { task: null, status: remote.status, detail: remote.detail };
      } catch {
        return { task: null };
      }
    }
    if (await stopOverdueTask(task)) {
      return { task: store.get(sessionId) ?? null, status: "stopped" };
    }
    try {
      const remote = await pm.delegate_status(sessionId);
      const taskStatus =
        remote.status === "not_found" ? "stopped" : remote.status;
      if (remote.status === "not_found") {
        markTaskStopped(sessionId, { error: "Delegate session not found" });
      } else if (taskStatus === "stopped") {
        markTaskStopped(sessionId);
      } else {
        store.update(sessionId, resolveTaskStatus(task, taskStatus));
        if (taskStatus === "completed") {
          cancelDelegateTimeout(sessionId);
        }
      }
      const compactInfo = await pm.delegate_compact_status(sessionId);
      return {
        task: store.get(sessionId) ?? null,
        status: remote.status,
        detail: remote.detail,
        isCompacting: compactInfo.isCompacting,
        contextUsage: compactInfo.contextUsage,
      };
    } catch (err) {
      // Ghost session — keep a stopped record so the parent can still see that
      // the delegated task disappeared and remove it manually if needed.
      const msg = err instanceof Error ? err.message : String(err);
      markTaskStopped(sessionId, { error: msg });
      return { task: store.get(sessionId) ?? null };
    }
  });

  channel.handle("session_delegate_list", async () => {
    const store = getStore();
    const tasks = store.list();
    for (const t of tasks) {
      if (await stopOverdueTask(t)) continue;
      try {
        const remote = await pm.delegate_status(t.sessionId);
        const taskStatus =
          remote.status === "not_found" ? "stopped" : remote.status;
        if (remote.status === "not_found") {
          markTaskStopped(t.sessionId, { error: "Delegate session not found" });
        } else if (taskStatus === "stopped") {
          markTaskStopped(t.sessionId);
        } else {
          store.update(t.sessionId, resolveTaskStatus(t, taskStatus));
          if (taskStatus === "completed") {
            cancelDelegateTimeout(t.sessionId);
          }
        }
      } catch (err) {
        // Ghost session — do not erase the task during list refresh. Mark it as
        // stopped and let explicit remove/clear handle cleanup.
        const msg = err instanceof Error ? err.message : String(err);
        markTaskStopped(t.sessionId, { error: msg });
      }
    }
    return { tasks: store.list() };
  });

  channel.handle("session_delegate_stop", async (params) => {
    const { sessionId } = params;
    const store = getStore();
    let ok = false;
    try {
      ok = await pm.delegate_stop(sessionId);
    } catch {
      // Process manager can't stop it (already gone), still mark as stopped
      // so the user can clean it up
    }
    if (ok) {
      store.update(sessionId, { status: "stopped", completedAt: Date.now() });
      channel.emit("task_stopped", { sessionId });
    } else {
      // Even if pm failed, mark as stopped so it can be removed later
      const task = store.get(sessionId);
      if (task) {
        store.update(sessionId, { status: "stopped", completedAt: Date.now() });
      }
    }
    cancelDelegateTimeout(sessionId);
    return { ok };
  });

  channel.handle("session_delegate_remove", async (params) => {
    const { sessionId } = params;
    const store = getStore();
    const task = store.get(sessionId);
    if (!task) {
      return { ok: false };
    }
    await pm.delegate_stop(sessionId).catch(() => {});
    cancelDelegateTimeout(sessionId);
    store.remove(sessionId);
    return { ok: true };
  });

  channel.handle("session_delegate_clear_stopped", async () => {
    const store = getStore();
    const removed = store.clearStopped();
    return { removed };
  });

  channel.handle("session_delegate_fork", async (params) => {
    const {
      sessionId,
      task,
      title,
      agent,
      model,
      projectPath: rawProjectPath,
    } = params;
    const projectPath = rawProjectPath || process.cwd();

    let result: DelegateCreateResult;
    try {
      result = await pm.delegate_fork(
        sessionId,
        task,
        title,
        projectPath,
        agent,
        model
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        sessionId: `error-${Date.now()}`,
        status: "error" as const,
        error: msg,
      };
    }

    if (!result.sessionId) {
      return {
        sessionId: `error-${Date.now()}`,
        status: "error" as const,
        error: "[coordinator] fork failed: no sessionId returned",
      };
    }

    getStore().add({
      sessionId: result.sessionId,
      title: title || task.slice(0, 60),
      task,
      projectPath,
      dispatchedAt: Date.now(),
      status: "idle",
    });

    channel.emit("task_started", {
      sessionId: result.sessionId,
      title: title || task.slice(0, 60),
      task,
    });

    return result;
  });

  channel.handle("session_delegate_sync", async (params) => {
    const {
      task,
      title,
      agent,
      model,
      timeoutMs,
      projectPath: rawProjectPath,
      depth,
      variables,
    } = params;
    const projectPath = rawProjectPath || process.cwd();

    try {
      const result = await pm.delegate_sync(
        task,
        agent,
        timeoutMs ?? 180_000,
        projectPath,
        model,
        depth,
        variables
      );

      if (title) {
        getStore().add({
          sessionId: result.sessionId,
          title,
          task,
          projectPath,
          dispatchedAt: Date.now(),
          status: result.exitCode === 0 ? "completed" : "stopped",
          completedAt: Date.now(),
          result: result.finalText,
        });
      }

      return result;
    } catch (err) {
      return {
        sessionId: "",
        status: "error" as const,
        exitCode: 1,
        finalText: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
