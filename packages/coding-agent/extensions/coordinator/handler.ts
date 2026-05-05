import * as fs from "node:fs";
import * as path from "node:path";
import type { ServerChannel } from "@dyyz1993/pi-coding-agent";
import type { CoordinatorChannelContract, DelegatedTask, SessionStatus } from "./types.js";

export interface ProcessManagerApi {
	delegate(task: string, projectPath: string): Promise<{ sessionId: string; status: "started" | "already_running" }>;
	delegate_send(fromSessionId: string, toSessionId: string, message: string): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }>;
	delegate_status(sessionId: string): { status: SessionStatus };
	delegate_list(): Array<{ sessionId: string; status: SessionStatus; projectPath: string }>;
	delegate_stop(sessionId: string): boolean;
	delegate_fork(sessionId: string, task: string, title?: string): Promise<{ sessionId: string; status: "started" | "already_running" }>;
	delegate_compact_status(sessionId: string): Promise<{ isCompacting: boolean; contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } }>;
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
		catch {}
	}

	private save(): void {
		const arr = Array.from(this.tasks.values());
		fs.writeFileSync(this.filePath, JSON.stringify(arr, null, 2), "utf-8");
	}

	add(task: DelegatedTask): void {
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

	buildPrompt(): string {
		const tasks = this.list();
		if (tasks.length === 0) return "";

		const lines = ["## Delegated Tasks", ""];
		for (const t of tasks) {
			const status = t.status === "completed" ? "DONE" : t.status === "stopped" ? "STOPPED" : t.status.toUpperCase();
			const compactTag = (t as any).isCompacting ? " COMPACTING" : "";
			const ctxTag = (t as any).contextUsage?.percent != null ? ` ctx:${Math.round((t as any).contextUsage.percent)}%` : "";
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
	channel.handle("session_delegate", async ({ task, title }) => {
		const projectPath = process.cwd();
		const result = await pm.delegate(task, projectPath);

		getStore().add({
			sessionId: result.sessionId,
			title: title || task.slice(0, 60),
			task,
			projectPath,
			dispatchedAt: Date.now(),
			status: "idle",
		});

		return result;
	});

	channel.handle("session_delegate_send", async ({ targetSessionId, message }) => {
		const result = await pm.delegate_send(getSessionId(), targetSessionId, message);

		if (result.delivered) {
			const store = getStore();
			const task = store.get(targetSessionId);
			if (task && task.status === "stopped") {
				store.update(targetSessionId, { status: "idle" });
			}
		}

		return result;
	});

	channel.handle("session_delegate_status", async ({ sessionId }) => {
		const store = getStore();
		const task = store.get(sessionId);
		if (!task) {
			const status = pm.delegate_status(sessionId);
			return { task: null };
		}
		const remote = pm.delegate_status(sessionId);
		store.update(sessionId, { status: remote.status });
		const compactInfo = await pm.delegate_compact_status(sessionId);
		return { task: store.get(sessionId) ?? null, isCompacting: compactInfo.isCompacting, contextUsage: compactInfo.contextUsage };
	});

	channel.handle("session_delegate_list", async () => {
		const store = getStore();
		for (const t of store.list()) {
			const remote = pm.delegate_status(t.sessionId);
			store.update(t.sessionId, { status: remote.status });
		}
		return { tasks: store.list() };
	});

	channel.handle("session_delegate_stop", async ({ sessionId }) => {
		const ok = pm.delegate_stop(sessionId);
		if (ok) {
			getStore().update(sessionId, { status: "stopped" });
		}
		return { ok };
	});

	channel.handle("session_delegate_fork", async ({ sessionId, task, title }) => {
		const result = await pm.delegate_fork(sessionId, task, title);
		getStore().add({
			sessionId: result.sessionId,
			title: title || task.slice(0, 60),
			task,
			projectPath: process.cwd(),
			dispatchedAt: Date.now(),
			status: "idle",
		});
		return result;
	});
}
