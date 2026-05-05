import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorHandler, type ProcessManagerApi, TaskStore } from "../../extensions/coordinator/handler.js";
import type { CoordinatorChannelContract, DelegatedTask } from "../../extensions/coordinator/types.js";
import { ClientChannel } from "../../src/core/extensions/client-channel.js";
import { ServerChannel } from "../../src/core/extensions/server-channel.js";

class MockChannel {
	name = "coordinator";
	sentMessages: unknown[] = [];
	handlers = new Set<(data: unknown) => void>();

	send(data: unknown): void {
		this.sentMessages.push(data);
		for (const handler of this.handlers) {
			handler(data);
		}
	}

	onReceive(handler: (data: unknown) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	invoke(data: unknown, _timeoutMs?: number): Promise<unknown> {
		const msg = data as Record<string, unknown>;
		return new Promise((resolve) => {
			const check = () => {
				const response = this.sentMessages.find(
					(m) => (m as Record<string, unknown>)?.invokeId === msg.invokeId && m !== msg,
				);
				if (response) {
					resolve(response);
				}
			};
			setTimeout(check, 10);
		});
	}

	call(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
		const payload = { __call: method, invokeId: `inv_${Date.now()}_${Math.random()}`, ...params };
		this.send(payload);
		return this.invoke(payload, timeoutMs);
	}

	emit(eventData: unknown): void {
		for (const handler of this.handlers) {
			handler(eventData);
		}
	}
}

function createMockProcessManager() {
	const sessions = new Map<
		string,
		{ sessionId: string; projectPath: string; status: "idle" | "streaming" | "stopped" }
	>();
	const delegateLog: Array<{ sessionId: string; task: string }> = [];
	const sendLog: Array<{ from: string; to: string; message: string }> = [];
	const compactStates = new Map<
		string,
		{ isCompacting: boolean; contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } }
	>();

	return {
		sessions,
		delegateLog,
		sendLog,
		compactStates,

		async delegate(
			task: string,
			projectPath: string,
		): Promise<{ sessionId: string; status: "started" | "already_running" }> {
			const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			sessions.set(sessionId, { sessionId, projectPath, status: "idle" });
			delegateLog.push({ sessionId, task });
			return { sessionId, status: "started" };
		},

		async delegate_send(
			fromSessionId: string,
			toSessionId: string,
			message: string,
		): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }> {
			sendLog.push({ from: fromSessionId, to: toSessionId, message });
			const target = sessions.get(toSessionId);
			if (!target) {
				return { delivered: false, targetStatus: "not_found" };
			}
			if (target.status === "stopped") {
				target.status = "idle";
				return { delivered: true, targetStatus: "started" };
			}
			return { delivered: true, targetStatus: "active" };
		},

		delegate_status(sessionId: string): { status: "idle" | "streaming" | "stopped" } {
			const s = sessions.get(sessionId);
			return s ? { status: s.status } : { status: "stopped" };
		},

		delegate_list(): Array<{ sessionId: string; status: string; projectPath: string }> {
			return Array.from(sessions.values());
		},

		delegate_stop(sessionId: string): boolean {
			const s = sessions.get(sessionId);
			if (!s) return false;
			s.status = "stopped";
			return true;
		},

		async delegate_fork(
			sessionId: string,
			task: string,
			_title?: string,
		): Promise<{ sessionId: string; status: "started" | "already_running" }> {
			const newSessionId = `fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			sessions.set(newSessionId, {
				sessionId: newSessionId,
				projectPath: sessions.get(sessionId)?.projectPath ?? "/project",
				status: "idle",
			});
			delegateLog.push({ sessionId: newSessionId, task });
			return { sessionId: newSessionId, status: "started" };
		},

		delegate_compact_status(sessionId: string): {
			isCompacting: boolean;
			contextUsage: { tokens: number | null; contextWindow: number; percent: number | null };
		} {
			const state = compactStates.get(sessionId);
			return state ?? { isCompacting: false, contextUsage: { tokens: null, contextWindow: 0, percent: null } };
		},
	};
}

function setupCoordinator() {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coordinator-test-"));
	const mockChannel = new MockChannel();
	const serverChannel = new ServerChannel<CoordinatorChannelContract>(mockChannel);
	const clientChannel = new ClientChannel<CoordinatorChannelContract>(mockChannel);
	const processManager = createMockProcessManager();
	const currentSessionId = "current_session_001";
	const store = new TaskStore(tmpDir);

	createCoordinatorHandler(serverChannel, processManager, currentSessionId, store);

	return { tmpDir, mockChannel, serverChannel, clientChannel, processManager, currentSessionId, store };
}

describe("Coordinator Handler", () => {
	describe("session_delegate", () => {
		it("should delegate a task and return sessionId", async () => {
			const { clientChannel, processManager } = setupCoordinator();

			const result = await clientChannel.call("session_delegate", { task: "重构 foo 模块" });

			expect(result.status).toBe("started");
			expect(result.sessionId).toBeTruthy();
			expect(processManager.delegateLog).toHaveLength(1);
			expect(processManager.delegateLog[0].task).toBe("重构 foo 模块");
		});

		it("should persist delegated task to store", async () => {
			const { clientChannel, store } = setupCoordinator();

			const result = await clientChannel.call("session_delegate", { task: "do something", title: "My Task" });

			const task = store.get(result.sessionId);
			expect(task).toBeDefined();
			expect(task!.title).toBe("My Task");
			expect(task!.task).toBe("do something");
			expect(task!.status).toBe("idle");
		});

		it("should use task preview as title when title not provided", async () => {
			const { clientChannel, store } = setupCoordinator();

			const result = await clientChannel.call("session_delegate", { task: "A".repeat(100) });

			const task = store.get(result.sessionId);
			expect(task!.title).toBe("A".repeat(60));
		});
	});

	describe("session_delegate_send", () => {
		it("should deliver message to an active session", async () => {
			const { clientChannel, processManager, currentSessionId } = setupCoordinator();

			await processManager.delegate("setup", "/project");
			const targetId = processManager.delegateLog[0].sessionId;

			const result = await clientChannel.call("session_delegate_send", {
				targetSessionId: targetId,
				message: "进展如何？",
			});

			expect(result.delivered).toBe(true);
			expect(result.targetStatus).toBe("active");
			expect(processManager.sendLog).toHaveLength(1);
			expect(processManager.sendLog[0].from).toBe(currentSessionId);
		});

		it("should return not_found when target does not exist", async () => {
			const { clientChannel } = setupCoordinator();

			const result = await clientChannel.call("session_delegate_send", {
				targetSessionId: "nonexistent",
				message: "hello",
			});

			expect(result.delivered).toBe(false);
			expect(result.targetStatus).toBe("not_found");
		});

		it("should restart a stopped session", async () => {
			const { clientChannel, processManager } = setupCoordinator();

			await processManager.delegate("setup", "/project");
			const targetId = processManager.delegateLog[0].sessionId;
			processManager.sessions.get(targetId)!.status = "stopped";

			const result = await clientChannel.call("session_delegate_send", {
				targetSessionId: targetId,
				message: "wake up",
			});

			expect(result.delivered).toBe(true);
			expect(result.targetStatus).toBe("started");
		});
	});

	describe("session_delegate_status", () => {
		it("should return task from store", async () => {
			const { clientChannel, store } = setupCoordinator();

			await clientChannel.call("session_delegate", { task: "analyze code" });
			const tasks = store.list();
			const sessionId = tasks[0].sessionId;

			const result = await clientChannel.call("session_delegate_status", { sessionId });

			expect(result.task).not.toBeNull();
			expect(result.task!.sessionId).toBe(sessionId);
		});

		it("should return null for unknown session", async () => {
			const { clientChannel } = setupCoordinator();

			const result = await clientChannel.call("session_delegate_status", { sessionId: "unknown" });

			expect(result.task).toBeNull();
		});

		it("should include isCompacting and contextUsage in status response", async () => {
			const { clientChannel, store } = setupCoordinator();

			const delegateResult = await clientChannel.call("session_delegate", { task: "monitor this" });
			const sessionId = delegateResult.sessionId;

			const result = await clientChannel.call("session_delegate_status", { sessionId });

			expect(result.task).not.toBeNull();
			expect(result).toHaveProperty("isCompacting");
			expect(result).toHaveProperty("contextUsage");
		});

		it("should reflect isCompacting true from process manager", async () => {
			const { clientChannel, processManager, store } = setupCoordinator();

			const delegateResult = await clientChannel.call("session_delegate", { task: "compacting task" });
			const sessionId = delegateResult.sessionId;

			processManager.compactStates.set(sessionId, {
				isCompacting: true,
				contextUsage: { tokens: 50000, contextWindow: 200000, percent: 25 },
			});

			const result = await clientChannel.call("session_delegate_status", { sessionId });

			expect(result.isCompacting).toBe(true);
			expect(result.contextUsage).toEqual({ tokens: 50000, contextWindow: 200000, percent: 25 });
		});
	});

	describe("session_delegate_list", () => {
		it("should return empty list when no tasks", async () => {
			const { clientChannel } = setupCoordinator();

			const result = await clientChannel.call("session_delegate_list", {});

			expect(result.tasks).toEqual([]);
		});

		it("should list all delegated tasks", async () => {
			const { clientChannel, store } = setupCoordinator();

			await clientChannel.call("session_delegate", { task: "task a", title: "Task A" });
			await clientChannel.call("session_delegate", { task: "task b", title: "Task B" });

			const result = await clientChannel.call("session_delegate_list", {});

			expect(result.tasks).toHaveLength(2);
			const titles = result.tasks.map((t) => t.title).sort();
			expect(titles).toEqual(["Task A", "Task B"]);
		});
	});

	describe("session_delegate_stop", () => {
		it("should stop a delegated session", async () => {
			const { clientChannel, processManager } = setupCoordinator();

			await processManager.delegate("work", "/project");
			const targetId = processManager.delegateLog[0].sessionId;

			const result = await clientChannel.call("session_delegate_stop", { sessionId: targetId });

			expect(result.ok).toBe(true);
			expect(processManager.delegate_status(targetId).status).toBe("stopped");
		});

		it("should return false for non-existent session", async () => {
			const { clientChannel } = setupCoordinator();

			const result = await clientChannel.call("session_delegate_stop", { sessionId: "ghost" });

			expect(result.ok).toBe(false);
		});

		it("should update store status to stopped", async () => {
			const { clientChannel, store } = setupCoordinator();

			const spawnResult = await clientChannel.call("session_delegate", { task: "work" });
			await clientChannel.call("session_delegate_stop", { sessionId: spawnResult.sessionId });

			const task = store.get(spawnResult.sessionId);
			expect(task!.status).toBe("stopped");
		});
	});

	describe("full lifecycle", () => {
		it("should complete delegate → send → status → stop flow", async () => {
			const { clientChannel, store } = setupCoordinator();

			const delegateResult = await clientChannel.call("session_delegate", {
				task: "分析代码质量",
				title: "Code Analysis",
			});
			expect(delegateResult.status).toBe("started");
			const sid = delegateResult.sessionId;

			const sendResult = await clientChannel.call("session_delegate_send", {
				targetSessionId: sid,
				message: "请继续",
			});
			expect(sendResult.delivered).toBe(true);

			const statusResult = await clientChannel.call("session_delegate_status", { sessionId: sid });
			expect(statusResult.task).not.toBeNull();

			const stopResult = await clientChannel.call("session_delegate_stop", { sessionId: sid });
			expect(stopResult.ok).toBe(true);

			const finalStatus = await clientChannel.call("session_delegate_status", { sessionId: sid });
			expect(finalStatus.task!.status).toBe("stopped");
		});
	});

	describe("session_delegate_fork", () => {
		it("should fork an existing session and return new sessionId", async () => {
			const { clientChannel, processManager } = setupCoordinator();

			const delegateResult = await clientChannel.call("session_delegate", { task: "original task" });
			const sourceSessionId = delegateResult.sessionId;

			const result = await clientChannel.call("session_delegate_fork", {
				sessionId: sourceSessionId,
				task: "forked task",
				title: "Fork Task",
			});

			expect(result.status).toBe("started");
			expect(result.sessionId).toBeTruthy();
			expect(result.sessionId).not.toBe(sourceSessionId);
		});

		it("should persist forked task to store", async () => {
			const { clientChannel, store } = setupCoordinator();

			const delegateResult = await clientChannel.call("session_delegate", { task: "original" });

			const result = await clientChannel.call("session_delegate_fork", {
				sessionId: delegateResult.sessionId,
				task: "forked task",
				title: "Forked Work",
			});

			const task = store.get(result.sessionId);
			expect(task).toBeDefined();
			expect(task!.title).toBe("Forked Work");
			expect(task!.task).toBe("forked task");
			expect(task!.status).toBe("idle");
		});

		it("should keep original session unaffected after fork", async () => {
			const { clientChannel, store } = setupCoordinator();

			const delegateResult = await clientChannel.call("session_delegate", {
				task: "original task",
				title: "Original",
			});

			await clientChannel.call("session_delegate_fork", {
				sessionId: delegateResult.sessionId,
				task: "forked task",
			});

			const original = store.get(delegateResult.sessionId);
			expect(original).toBeDefined();
			expect(original!.title).toBe("Original");
			expect(original!.status).toBe("idle");
		});

		it("should use task preview as title when title not provided", async () => {
			const { clientChannel, store } = setupCoordinator();

			const delegateResult = await clientChannel.call("session_delegate", { task: "original" });

			const result = await clientChannel.call("session_delegate_fork", {
				sessionId: delegateResult.sessionId,
				task: "B".repeat(100),
			});

			const task = store.get(result.sessionId);
			expect(task!.title).toBe("B".repeat(60));
		});
	});
});

describe("TaskStore", () => {
	let tmpDir: string;
	let store: TaskStore;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coordinator-store-"));
		store = new TaskStore(tmpDir);
	});

	it("should persist tasks to file", () => {
		store.add({
			sessionId: "sess_001",
			title: "Test Task",
			task: "do something",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "idle",
		});

		const filePath = path.join(tmpDir, "coordinator-tasks.json");
		expect(fs.existsSync(filePath)).toBe(true);

		const stored = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DelegatedTask[];
		expect(stored).toHaveLength(1);
		expect(stored[0].sessionId).toBe("sess_001");
	});

	it("should reload tasks from file on construction", () => {
		store.add({
			sessionId: "sess_001",
			title: "Task 1",
			task: "do something",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "idle",
		});

		const reloaded = new TaskStore(tmpDir);
		expect(reloaded.list()).toHaveLength(1);
		expect(reloaded.get("sess_001")!.title).toBe("Task 1");
	});

	it("should update tasks", () => {
		store.add({
			sessionId: "sess_001",
			title: "Test",
			task: "work",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "idle",
		});

		store.update("sess_001", { status: "completed", completedAt: 2000, result: "done" });

		const task = store.get("sess_001");
		expect(task!.status).toBe("completed");
		expect(task!.completedAt).toBe(2000);
		expect(task!.result).toBe("done");
	});

	it("should remove tasks", () => {
		store.add({
			sessionId: "sess_001",
			title: "Test",
			task: "work",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "idle",
		});

		store.remove("sess_001");
		expect(store.list()).toHaveLength(0);

		const reloaded = new TaskStore(tmpDir);
		expect(reloaded.list()).toHaveLength(0);
	});

	describe("buildPrompt", () => {
		it("should return empty string when no tasks", () => {
			expect(store.buildPrompt()).toBe("");
		});

		it("should generate prompt with task summary", () => {
			store.add({
				sessionId: "sess_001",
				title: "Code Analysis",
				task: "analyze code",
				projectPath: "/project",
				dispatchedAt: Date.now() - 5000,
				status: "streaming",
			});

			const prompt = store.buildPrompt();
			expect(prompt).toContain("## Delegated Tasks");
			expect(prompt).toContain("Code Analysis");
			expect(prompt).toContain("sess_001");
			expect(prompt).toContain("STREAMING");
		});

		it("should show result preview for completed tasks", () => {
			store.add({
				sessionId: "sess_001",
				title: "Test",
				task: "work",
				projectPath: "/project",
				dispatchedAt: 1000,
				status: "completed",
				completedAt: 2000,
				result: "All tests passed successfully",
			});

			const prompt = store.buildPrompt();
			expect(prompt).toContain("DONE");
			expect(prompt).toContain("All tests passed");
		});

		it("should truncate long results", () => {
			const longResult = "x".repeat(300);
			store.add({
				sessionId: "sess_001",
				title: "Test",
				task: "work",
				projectPath: "/project",
				dispatchedAt: 1000,
				status: "completed",
				completedAt: 2000,
				result: longResult,
			});

			const prompt = store.buildPrompt();
			expect(prompt).toContain(`${"x".repeat(200)}...`);
			expect(prompt).not.toContain("x".repeat(300));
		});

		it("should show COMPACTING tag for compacting tasks", () => {
			store.add({
				sessionId: "sess_compact",
				title: "Big Task",
				task: "do big work",
				projectPath: "/project",
				dispatchedAt: Date.now() - 5000,
				status: "streaming",
				isCompacting: true,
			} as any);

			const prompt = store.buildPrompt();
			expect(prompt).toContain("Big Task");
			expect(prompt).toContain("COMPACTING");
		});

		it("should show context usage percentage when available", () => {
			store.add({
				sessionId: "sess_ctx",
				title: "Context Task",
				task: "use context",
				projectPath: "/project",
				dispatchedAt: Date.now(),
				status: "idle",
				contextUsage: { tokens: 100000, contextWindow: 200000, percent: 50 },
			} as any);

			const prompt = store.buildPrompt();
			expect(prompt).toContain("Context Task");
			expect(prompt).toContain("ctx:50%");
		});
	});
});

describe("Events", () => {
	it("should emit and receive message_received", async () => {
		const { mockChannel, serverChannel } = setupCoordinator();

		const received: unknown[] = [];
		const client = new ClientChannel<CoordinatorChannelContract>(mockChannel);
		client.on("message_received", (data) => received.push(data));

		serverChannel.emit("message_received", { fromSessionId: "other", message: "hello" });

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ fromSessionId: "other", message: "hello" });
	});

	it("should emit task_started", async () => {
		const { mockChannel, serverChannel } = setupCoordinator();

		const started: unknown[] = [];
		const client = new ClientChannel<CoordinatorChannelContract>(mockChannel);
		client.on("task_started", (data) => started.push(data));

		serverChannel.emit("task_started", { sessionId: "s1", title: "Test", task: "work" });

		expect(started).toHaveLength(1);
	});
});
