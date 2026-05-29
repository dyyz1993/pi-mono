import * as fs from "node:fs";
import * as path from "node:path";
import type { ServerChannel } from "@dyyz1993/pi-coding-agent";
import type { CoordinatorChannelContract, DelegatedTask, DelegateCreateResult, SessionStatus } from "./types.js";

export interface ProcessManagerApi {
  delegate(task: string, projectPath: string): Promise<{ sessionId: string; status: "started" | "already_running" }>;
  delegate_send(fromSessionId: string, toSessionId: string, message: string): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }>;
  delegate_status(sessionId: string): Promise<{ status: SessionStatus }>;
  delegate_list(): Promise<Array<{ sessionId: string; status: SessionStatus; projectPath: string }>>;
  delegate_stop(sessionId: string): Promise<boolean>;
  delegate_fork(sessionId: string, task: string, title?: string, projectPath?: string): Promise<{ sessionId: string; status: "started" | "already_running" }>;
  delegate_compact_status(sessionId: string): Promise<{ isCompacting: boolean; contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } }>;
  delegate_remove(sessionId: string): Promise<boolean>;
  delegate_clear_stopped(): Promise<number>;
  delegate_sync(task: string, agent: string | undefined, timeoutMs: number, projectPath: string): Promise<{ sessionId: string; status: "completed" | "timeout" | "error" | "aborted"; exitCode: number; finalText: string; error?: string }>;
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
    }
    catch (err) {
      console.debug("[coordinator] task file load failed:", err instanceof Error ? err.message : err);
    }
  }

  private static readonly EVICT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes (stopped/completed)
  private static readonly IDLE_EVICT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours (idle zombies)

  private save(): void {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      // Evict stopped/completed tasks older than 5 minutes
      if (
        (task.status === "stopped" || task.status === "completed") &&
        task.completedAt &&
        now - task.completedAt > TaskStore.EVICT_MAX_AGE_MS
      ) {
        this.tasks.delete(id);
        continue;
      }
      // Evict idle tasks older than 24 hours (zombies whose process has vanished)
      if (
        task.status === "idle" &&
        now - task.dispatchedAt > TaskStore.IDLE_EVICT_MAX_AGE_MS
      ) {
        this.tasks.delete(id);
      }
    }
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

  buildPrompt(): string {
    const FINISHED_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const IDLE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    const tasks = this.list().filter((t) => {
      if ((t.status === "stopped" || t.status === "completed") && t.completedAt && now - t.completedAt > FINISHED_MAX_AGE_MS) {
        return false;
      }
      // Filter out idle tasks older than 24 hours (zombies)
      if (t.status === "idle" && now - t.dispatchedAt > IDLE_MAX_AGE_MS) {
        return false;
      }
      return true;
    });
    if (tasks.length === 0) return "";

    const lines = ["## Delegated Tasks", ""];
    for (const t of tasks) {
      const status = t.status === "completed" ? "DONE" : t.status === "stopped" ? "STOPPED" : t.status.toUpperCase();
      const compactTag = t.isCompacting ? " COMPACTING" : "";
      const ctxUsage = t.contextUsage;
      const ctxTag = ctxUsage?.percent != null ? ` ctx:${Math.round(ctxUsage.percent)}%` : "";
      const elapsed = t.completedAt
        ? `${((t.completedAt - t.dispatchedAt) / 1000).toFixed(1)}s`
        : `${((Date.now() - t.dispatchedAt) / 1000).toFixed(0)}s elapsed`;
      lines.push(`- **${t.title}** (id: \`${t.sessionId}\`) — ${status}${compactTag}${ctxTag} — ${elapsed}`);
      if (t.result) {
        const preview = t.result.length > 200 ? `${t.result.slice(0, 200)}...` : t.result;
        lines.push(`  > ${preview}`);
      }
    }
    return lines.join("\n");
  }
}

export function createCoordinatorHandler(
  channel: ServerChannel<CoordinatorChannelContract>,
  pm: ProcessManagerApi,
  getSessionId: () => string,
  getStore: () => TaskStore,
): void {
  channel.handle("session_delegate", async (params) => {
    const { task, title, projectPath: rawProjectPath } = params;
    const projectPath = rawProjectPath || process.cwd();

    let result: DelegateCreateResult;
    try {
      result = await pm.delegate(task, projectPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sessionId: `error-${Date.now()}`, status: "already_running" as const, error: msg };
    }

    if (!result.sessionId) {
      return { sessionId: `error-${Date.now()}`, status: "already_running" as const, error: "[coordinator] delegate failed: no sessionId returned" };
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

  channel.handle("session_delegate_send", async (params) => {
    const { targetSessionId, message } = params;
    const result = await pm.delegate_send(getSessionId(), targetSessionId, message);

    if (result.targetStatus === "not_found") {
      // Ghost session — remove from store
      getStore().remove(targetSessionId);
    } else if (result.delivered) {
      const store = getStore();
      const task = store.get(targetSessionId);
      if (task && task.status === "stopped") {
        store.update(targetSessionId, { status: "idle", completedAt: undefined });
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
        return { task: null, status: remote.status };
      } catch {
        return { task: null };
      }
    }
    try {
      const remote = await pm.delegate_status(sessionId);
      store.update(sessionId, { status: remote.status });
      const compactInfo = await pm.delegate_compact_status(sessionId);
      return { task: store.get(sessionId) ?? null, isCompacting: compactInfo.isCompacting, contextUsage: compactInfo.contextUsage };
    } catch {
      // Ghost session — process manager can't find it, remove from store
      store.remove(sessionId);
      return { task: null };
    }
  });

  channel.handle("session_delegate_list", async () => {
    const store = getStore();
    const tasks = store.list();
    for (const t of tasks) {
      try {
        const remote = await pm.delegate_status(t.sessionId);
        if (remote.status === "stopped") {
          store.remove(t.sessionId);
        } else {
          store.update(t.sessionId, { status: remote.status });
        }
      } catch {
        // Ghost session — process manager can't find it, remove from store
        store.remove(t.sessionId);
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
    return { ok };
  });

  channel.handle("session_delegate_remove", async (params) => {
    const { sessionId } = params;
    const store = getStore();
    const task = store.get(sessionId);
    if (!task) {
      return { ok: false };
    }
    await pm.delegate_stop(sessionId).catch(() => { });
    store.remove(sessionId);
    return { ok: true };
  });

  channel.handle("session_delegate_clear_stopped", async () => {
    const store = getStore();
    const removed = store.clearStopped();
    return { removed };
  });

  channel.handle("session_delegate_fork", async (params) => {
    const { sessionId, task, title, projectPath: rawProjectPath } = params;
    const projectPath = rawProjectPath || process.cwd();

    let result: DelegateCreateResult;
    try {
      result = await pm.delegate_fork(sessionId, task, title, projectPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sessionId: `error-${Date.now()}`, status: "already_running" as const, error: msg };
    }

    if (!result.sessionId) {
      return { sessionId: `error-${Date.now()}`, status: "already_running" as const, error: "[coordinator] fork failed: no sessionId returned" };
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
    const { task, title, agent, timeoutMs, projectPath: rawProjectPath } = params;
    const projectPath = rawProjectPath || process.cwd();

    try {
      const result = await pm.delegate_sync(task, agent, timeoutMs ?? 180_000, projectPath);

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
