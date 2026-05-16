import * as fs from "node:fs";
import * as path from "node:path";
import type { ServerChannel } from "@dyyz1993/pi-coding-agent";
import type { CoordinatorChannelContract, DelegatedTask, SessionStatus } from "./types.js";

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

	buildPrompt(): string {
		const FINISHED_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
		const now = Date.now();
		const tasks = this.list().filter((t) => {
			if ((t.status === "stopped" || t.status === "completed") && t.completedAt && now - t.completedAt > FINISHED_MAX_AGE_MS) {
				return false;
			}
			return true;
		});
		if (tasks.length === 0) return "";

		const lines = ["## Delegated Tasks", ""];
		for (const t of tasks) {
			const status = t.status === "completed" ? "DONE" : t.status === "stopped" ? "STOPPED" : t.status.toUpperCase();
			const compactTag = (t as Record<string, unknown>).isCompacting ? " COMPACTING" : "";
			const ctxUsage = (t as Record<string, unknown>).contextUsage as { percent: number | null } | undefined;
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
	channel.handle("session_delegate", async (params: unknown) => {
		const { task, title, projectPath: rawProjectPath } = params as { task: string; title?: string; projectPath?: string };
		const projectPath = rawProjectPath || process.cwd();

		let result: { sessionId: string; status: "started" | "already_running" };
		try {
			result = await pm.delegate(task, projectPath);
		} catch (err) {
			return { __error: err instanceof Error ? err.message : String(err) };
		}

		if (!result.sessionId) {
			return { __error: "[coordinator] delegate failed: no sessionId returned" };
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

	channel.handle("session_delegate_send", async (params: unknown) => {
		const { targetSessionId, message } = params as { targetSessionId: string; message: string };
		const result = await pm.delegate_send(getSessionId(), targetSessionId, message);

		if (result.delivered) {
			const store = getStore();
			const task = store.get(targetSessionId);
			if (task && task.status === "stopped") {
				store.update(targetSessionId, { status: "idle", completedAt: undefined });
			}
		}

		return result;
	});

	channel.handle("session_delegate_status", async (params: unknown) => {
		const { sessionId } = params as { sessionId: string };
		const store = getStore();
		const task = store.get(sessionId);
		if (!task) {
			await pm.delegate_status(sessionId);
			return { task: null };
		}
		const remote = await pm.delegate_status(sessionId);
		store.update(sessionId, { status: remote.status });
		const compactInfo = await pm.delegate_compact_status(sessionId);
		return { task: store.get(sessionId) ?? null, isCompacting: compactInfo.isCompacting, contextUsage: compactInfo.contextUsage };
	});

	channel.handle("session_delegate_list", async () => {
		const store = getStore();
		for (const t of store.list()) {
			const remote = await pm.delegate_status(t.sessionId);
			store.update(t.sessionId, { status: remote.status });
		}
		return { tasks: store.list() };
	});

	channel.handle("session_delegate_stop", async (params: unknown) => {
		const { sessionId } = params as { sessionId: string };
		const ok = await pm.delegate_stop(sessionId);
		if (ok) {
			const store = getStore();
			store.update(sessionId, { status: "stopped", completedAt: Date.now() });
			channel.emit("task_stopped", { sessionId });
		}
		return { ok };
	});

	channel.handle("session_delegate_remove", async (params: unknown) => {
		const { sessionId } = params as { sessionId: string };
		const store = getStore();
		const task = store.get(sessionId);
		if (!task) {
			return { ok: false };
		}
		await pm.delegate_stop(sessionId).catch(() => {});
		store.remove(sessionId);
		return { ok: true };
	});

	channel.handle("session_delegate_clear_stopped", async () => {
		const store = getStore();
		const removed = store.clearStopped();
		return { removed };
	});

	channel.handle("session_delegate_fork", async (params: unknown) => {
		const { sessionId, task, title, projectPath: rawProjectPath } = params as { sessionId: string; task: string; title?: string; projectPath?: string };
		const projectPath = rawProjectPath || process.cwd();

		let result: { sessionId: string; status: "started" | "already_running" };
		try {
			result = await pm.delegate_fork(sessionId, task, title, projectPath);
		} catch (err) {
			return { __error: err instanceof Error ? err.message : String(err) };
		}

		if (!result.sessionId) {
			return { __error: "[coordinator] fork failed: no sessionId returned" };
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
}
