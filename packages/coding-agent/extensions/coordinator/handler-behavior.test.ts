import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelManager } from "../../src/core/extensions/channel-manager.ts";
import { createTypedChannel } from "../../src/core/extensions/channel-factory.ts";
import { createCoordinatorHandler, TaskStore, type ProcessManagerApi } from "./handler.ts";
import type { CoordinatorChannelContract } from "./types.ts";

// ── Helpers ──

function createMockPm(overrides: Partial<ProcessManagerApi> = {}): ProcessManagerApi {
	return {
		delegate: vi.fn().mockResolvedValue({ sessionId: "sess-1", status: "started" as const }),
		delegate_send: vi.fn().mockResolvedValue({ delivered: true, targetStatus: "active" as const }),
		delegate_status: vi.fn().mockResolvedValue({ status: "idle" as const }),
		delegate_list: vi.fn().mockResolvedValue([]),
		delegate_stop: vi.fn().mockResolvedValue(true),
		delegate_fork: vi.fn().mockResolvedValue({ sessionId: "sess-fork-1", status: "started" as const }),
		delegate_compact_status: vi.fn().mockResolvedValue({
			isCompacting: false,
			contextUsage: { tokens: null, contextWindow: 128000, percent: null },
		}),
		delegate_remove: vi.fn().mockResolvedValue(true),
		delegate_clear_stopped: vi.fn().mockResolvedValue(0),
		delegate_sync: vi.fn().mockResolvedValue({
			sessionId: "sess-sync-1",
			status: "completed" as const,
			exitCode: 0,
			finalText: "done",
		}),
		...overrides,
	};
}

interface TestContext {
	tempDir: string;
	store: TaskStore;
	pm: ProcessManagerApi;
	client: ReturnType<typeof createTypedChannel<CoordinatorChannelContract>>["client"];
	emittedEvents: Map<string, unknown[]>;
	cleanup: () => void;
}

function setupTest(pmOverrides: Partial<ProcessManagerApi> = {}): TestContext {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coord-behavior-"));
	const store = new TaskStore(tempDir);
	const pm = createMockPm(pmOverrides);
	const parentSessionId = "parent-sess";

	// Two cross-connected ChannelManagers: client output → server inbound, server output → client inbound
	const clientCm = new ChannelManager(() => {});
	const serverCm = new ChannelManager((msg) => clientCm.handleInbound(msg));
	// Patch clientCm outputFn now that serverCm exists
	(clientCm as unknown as { outputFn: (msg: unknown) => void }).outputFn = (msg: unknown) => serverCm.handleInbound(msg as Parameters<typeof serverCm.handleInbound>[0]);

	const serverRaw = serverCm.register("coordinator");
	const clientRaw = clientCm.register("coordinator");

	const { server } = createTypedChannel<CoordinatorChannelContract>(serverRaw);
	const { client } = createTypedChannel<CoordinatorChannelContract>(clientRaw);

	createCoordinatorHandler(server, pm, () => parentSessionId, () => store);

	// Capture emitted events
	const emittedEvents = new Map<string, unknown[]>();
	client.on("task_started", (data) => {
		const arr = emittedEvents.get("task_started") ?? [];
		arr.push(data);
		emittedEvents.set("task_started", arr);
	});
	client.on("task_stopped", (data) => {
		const arr = emittedEvents.get("task_stopped") ?? [];
		arr.push(data);
		emittedEvents.set("task_stopped", arr);
	});

	return {
		tempDir,
		store,
		pm,
		client,
		emittedEvents,
		cleanup: () => {
			serverCm.unregister("coordinator");
			clientCm.unregister("coordinator");
			fs.rmSync(tempDir, { recursive: true, force: true });
		},
	};
}

const testContexts: TestContext[] = [];
afterEach(() => {
	for (const ctx of testContexts) ctx.cleanup();
	testContexts.length = 0;
	vi.useRealTimers();
});

function useCtx(pmOverrides: Partial<ProcessManagerApi> = {}): TestContext {
	const ctx = setupTest(pmOverrides);
	testContexts.push(ctx);
	return ctx;
}

// ── session_delegate ──

describe("session_delegate handler", () => {
	it("calls pm.delegate and adds task to store", async () => {
		const ctx = useCtx();
		const result = await ctx.client.call("session_delegate", {
			task: "Do something",
			projectPath: "/tmp/proj",
		});

		expect(result.sessionId).toBe("sess-1");
		expect(result.status).toBe("started");
		expect(ctx.pm.delegate).toHaveBeenCalledWith("Do something", "/tmp/proj", undefined, undefined, undefined, 600000);

		const stored = ctx.store.get("sess-1");
		expect(stored).toBeDefined();
		expect(stored!.task).toBe("Do something");
		expect(stored!.projectPath).toBe("/tmp/proj");
		expect(stored!.status).toBe("idle");
		expect(stored!.replyMode).toBe("interrupt");
		expect(stored!.timeoutMs).toBe(600000);
		expect(stored!.timeoutAt).toBeGreaterThan(stored!.dispatchedAt);
	});

	it("passes replyMode from params to pm.delegate and store", async () => {
		const ctx = useCtx();
		await ctx.client.call("session_delegate", {
			task: "Do something",
			projectPath: "/tmp/proj",
			replyMode: "followUp",
		});

		expect(ctx.pm.delegate).toHaveBeenCalledWith("Do something", "/tmp/proj", "followUp", undefined, undefined, 600000);
		expect(ctx.store.get("sess-1")!.replyMode).toBe("followUp");
	});

	it("passes agent from params to pm.delegate", async () => {
		const ctx = useCtx();
		await ctx.client.call("session_delegate", {
			task: "Do something",
			projectPath: "/tmp/proj",
			agent: "frontend-dev",
		});

		expect(ctx.pm.delegate).toHaveBeenCalledWith("Do something", "/tmp/proj", undefined, "frontend-dev", undefined, 600000);
	});

	it("passes model from params to pm.delegate", async () => {
		const ctx = useCtx();
		await ctx.client.call("session_delegate", {
			task: "Do something",
			projectPath: "/tmp/proj",
			model: "openai/gpt-4.1",
		});

		expect(ctx.pm.delegate).toHaveBeenCalledWith("Do something", "/tmp/proj", undefined, undefined, "openai/gpt-4.1", 600000);
	});

	it("returns error result when pm.delegate throws", async () => {
		const ctx = useCtx({
			delegate: vi.fn().mockRejectedValue(new Error("delegate boom")),
		});

		const result = await ctx.client.call("session_delegate", {
			task: "fail this",
		});

		expect(result.status).toBe("already_running");
		expect(result.error).toBe("delegate boom");
		expect(result.sessionId).toMatch(/^error-/);

		// Nothing added to store
		expect(ctx.store.list()).toHaveLength(0);
	});

	it("returns error result when pm.delegate returns no sessionId", async () => {
		const ctx = useCtx({
			delegate: vi.fn().mockResolvedValue({ sessionId: "", status: "already_running" as const }),
		});

		const result = await ctx.client.call("session_delegate", {
			task: "empty session",
		});

		expect(result.status).toBe("already_running");
		expect(result.error).toContain("no sessionId returned");
		expect(result.sessionId).toMatch(/^error-/);
	});

	it("emits task_started event", async () => {
		const ctx = useCtx();

		await ctx.client.call("session_delegate", {
			task: "Do something",
			title: "My Task",
		});

		const events = ctx.emittedEvents.get("task_started");
		expect(events).toHaveLength(1);
		expect(events![0]).toEqual({
			sessionId: "sess-1",
			title: "My Task",
			task: "Do something",
		});
	});

	it("uses title from params or falls back to task slice", async () => {
		// With title
		const ctx1 = useCtx();
		await ctx1.client.call("session_delegate", {
			task: "Do something",
			title: "Custom Title",
		});
		expect(ctx1.store.get("sess-1")!.title).toBe("Custom Title");

		// Without title — falls back to task.slice(0, 60)
		const ctx2 = useCtx();
		const longTask = "A".repeat(100);
		await ctx2.client.call("session_delegate", {
			task: longTask,
		});
		expect(ctx2.store.get("sess-1")!.title).toBe(longTask.slice(0, 60));
	});

	it("stops and marks an async delegate when its explicit timeout elapses", async () => {
		vi.useFakeTimers();
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "streaming" as const }),
		});

		await ctx.client.call("session_delegate", {
			task: "Never finish",
			projectPath: "/tmp/proj",
			timeoutMs: 50,
		});

		expect(ctx.store.get("sess-1")!.status).toBe("idle");

		await vi.advanceTimersByTimeAsync(51);

		expect(ctx.pm.delegate_stop).toHaveBeenCalledWith("sess-1");
		const stored = ctx.store.get("sess-1");
		expect(stored!.status).toBe("stopped");
		expect(stored!.completedAt).toBeDefined();
		expect(stored!.result).toContain("Timed out after 50ms");
		expect(ctx.emittedEvents.get("task_stopped")).toContainEqual({ sessionId: "sess-1" });
	});

	it("marks an overdue delegate as stopped during status refresh", async () => {
		const now = Date.now();
		vi.setSystemTime(now);
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "streaming" as const }),
		});
		ctx.store.add({
			sessionId: "sess-overdue",
			title: "Overdue",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: now - 1000,
			status: "streaming",
			timeoutMs: 100,
			timeoutAt: now - 1,
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "sess-overdue",
		});

		expect(ctx.pm.delegate_stop).toHaveBeenCalledWith("sess-overdue");
		expect(result.task?.status).toBe("stopped");
		expect(result.task?.result).toContain("Timed out after 100ms");
	});

	it("does not stop an overdue delegate that already completed remotely", async () => {
		const now = Date.now();
		vi.setSystemTime(now);
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "completed" as const }),
		});
		ctx.store.add({
			sessionId: "sess-completed",
			title: "Completed",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: now - 1000,
			status: "streaming",
			timeoutMs: 100,
			timeoutAt: now - 1,
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "sess-completed",
		});

		expect(ctx.pm.delegate_stop).not.toHaveBeenCalled();
		expect(result.task?.status).toBe("completed");
	});
});

// ── session_delegate_send ──

describe("session_delegate_send handler", () => {
	it("calls pm.delegate_send with correct params", async () => {
		const ctx = useCtx();
		ctx.store.add({
			sessionId: "target-1",
			title: "Target",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_send", {
			targetSessionId: "target-1",
			message: "hello",
		});

		expect(result.delivered).toBe(true);
		expect(ctx.pm.delegate_send).toHaveBeenCalledWith("parent-sess", "target-1", "hello", undefined);
	});

	it("removes task from store when targetStatus is not_found", async () => {
		const ctx = useCtx({
			delegate_send: vi.fn().mockResolvedValue({ delivered: false, targetStatus: "not_found" as const }),
		});
		ctx.store.add({
			sessionId: "ghost-1",
			title: "Ghost",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		await ctx.client.call("session_delegate_send", {
			targetSessionId: "ghost-1",
			message: "ping",
		});

		expect(ctx.store.get("ghost-1")).toBeUndefined();
	});

	it("re-activates stopped task when delivered", async () => {
		const ctx = useCtx();
		ctx.store.add({
			sessionId: "stopped-1",
			title: "Stopped",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "stopped",
			completedAt: Date.now() - 1000,
		});

		await ctx.client.call("session_delegate_send", {
			targetSessionId: "stopped-1",
			message: "wake up",
		});

		const task = ctx.store.get("stopped-1");
		expect(task!.status).toBe("idle");
		expect(task!.completedAt).toBeUndefined();
	});
});

// ── session_delegate_status ──

describe("session_delegate_status handler", () => {
	it("returns task from store when found", async () => {
		const ctx = useCtx();
		ctx.store.add({
			sessionId: "sess-x",
			title: "Known task",
			task: "do it",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "sess-x",
		});

		expect(result.task).not.toBeNull();
		expect(result.task!.sessionId).toBe("sess-x");
		expect(result.task!.status).toBe("idle");
	});

	it("falls back to pm.delegate_status when not in store", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "streaming" as const }),
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "unknown-sess",
		});

		expect(result.task).toBeNull();
		expect(result.status).toBe("streaming");
	});

	it("updates store status from remote", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "streaming" as const }),
		});
		ctx.store.add({
			sessionId: "sess-y",
			title: "Updating",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "sess-y",
		});

		expect(result.task!.status).toBe("streaming");
		expect(ctx.store.get("sess-y")!.status).toBe("streaming");
	});

	it("returns status detail from the process manager", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({
				status: "streaming" as const,
				detail: {
					phase: "执行中",
					waitingType: "streaming",
					waitingSince: 123,
					lastMessages: ["助手: 正在执行 ls"],
				},
			}),
		});
		ctx.store.add({
			sessionId: "sess-detail",
			title: "Detailed task",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: 100,
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "sess-detail",
		});

		expect(result.detail).toMatchObject({
			phase: "执行中",
			waitingType: "streaming",
			waitingSince: 123,
			lastMessages: ["助手: 正在执行 ls"],
		});
	});

	it("returns isCompacting and contextUsage", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "idle" as const }),
			delegate_compact_status: vi.fn().mockResolvedValue({
				isCompacting: true,
				contextUsage: { tokens: 50000, contextWindow: 128000, percent: 39 },
			}),
		});
		ctx.store.add({
			sessionId: "sess-z",
			title: "Compact",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "sess-z",
		});

		expect(result.isCompacting).toBe(true);
		expect(result.contextUsage).toEqual({ tokens: 50000, contextWindow: 128000, percent: 39 });
	});

	it("marks task as stopped when pm.delegate_status throws so parent can observe it", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockRejectedValue(new Error("gone")),
		});
		ctx.store.add({
			sessionId: "ghost-sess",
			title: "Ghost",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "ghost-sess",
		});

		expect(result.task).not.toBeNull();
		expect(result.task!.status).toBe("stopped");
		expect(result.task!.completedAt).toBeDefined();
		expect(ctx.store.get("ghost-sess")!.status).toBe("stopped");
	});
});

// ── session_delegate_list ──

describe("session_delegate_list handler", () => {
	it("marks stopped tasks via pm status check without removing them", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "stopped" as const }),
		});
		ctx.store.add({
			sessionId: "sess-stopped-1",
			title: "Stopped",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_list", {});

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].status).toBe("stopped");
		expect(result.tasks[0].completedAt).toBeDefined();
		expect(ctx.store.get("sess-stopped-1")).toBeDefined();
	});

	it("updates live tasks via pm status check", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "streaming" as const }),
		});
		ctx.store.add({
			sessionId: "sess-live-1",
			title: "Live",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_list", {});

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].status).toBe("streaming");
	});

	it("marks ghost tasks as stopped when pm throws", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockRejectedValue(new Error("not found")),
		});
		ctx.store.add({
			sessionId: "ghost-1",
			title: "Ghost",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_list", {});

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].status).toBe("stopped");
		expect(result.tasks[0].completedAt).toBeDefined();
	});
});

// ── session_delegate_stop ──

describe("session_delegate_stop handler", () => {
	it("marks task as stopped in store when pm returns ok", async () => {
		const ctx = useCtx();
		ctx.store.add({
			sessionId: "sess-stop-1",
			title: "Stop me",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_stop", {
			sessionId: "sess-stop-1",
		});

		expect(result.ok).toBe(true);
		const task = ctx.store.get("sess-stop-1");
		expect(task!.status).toBe("stopped");
		expect(task!.completedAt).toBeDefined();
	});

	it("emits task_stopped event", async () => {
		const ctx = useCtx();
		ctx.store.add({
			sessionId: "sess-stop-evt",
			title: "Stop me",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		await ctx.client.call("session_delegate_stop", {
			sessionId: "sess-stop-evt",
		});

		const events = ctx.emittedEvents.get("task_stopped");
		expect(events).toHaveLength(1);
		expect(events![0]).toEqual({ sessionId: "sess-stop-evt" });
	});

	it("still marks as stopped when pm returns false (if task exists in store)", async () => {
		const ctx = useCtx({
			delegate_stop: vi.fn().mockResolvedValue(false),
		});
		ctx.store.add({
			sessionId: "sess-stop-fail",
			title: "Stop me",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_stop", {
			sessionId: "sess-stop-fail",
		});

		expect(result.ok).toBe(false);
		const task = ctx.store.get("sess-stop-fail");
		expect(task!.status).toBe("stopped");
		expect(task!.completedAt).toBeDefined();
	});

	it("does not mark when task not in store and pm fails", async () => {
		const ctx = useCtx({
			delegate_stop: vi.fn().mockRejectedValue(new Error("nope")),
		});

		const result = await ctx.client.call("session_delegate_stop", {
			sessionId: "nonexistent",
		});

		expect(result.ok).toBe(false);
		expect(ctx.store.get("nonexistent")).toBeUndefined();
	});
});

// ── session_delegate_remove ──

describe("session_delegate_remove handler", () => {
	it("returns ok:false when task not in store", async () => {
		const ctx = useCtx();

		const result = await ctx.client.call("session_delegate_remove", {
			sessionId: "nonexistent",
		});

		expect(result.ok).toBe(false);
	});

	it("stops session via pm and removes from store", async () => {
		const ctx = useCtx();
		ctx.store.add({
			sessionId: "sess-rm-1",
			title: "Remove me",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_remove", {
			sessionId: "sess-rm-1",
		});

		expect(ctx.pm.delegate_stop).toHaveBeenCalledWith("sess-rm-1");
		expect(ctx.store.get("sess-rm-1")).toBeUndefined();
		expect(result.ok).toBe(true);
	});
});

// ── session_delegate_clear_stopped ──

describe("session_delegate_clear_stopped handler", () => {
	it("delegates to store.clearStopped()", async () => {
		const ctx = useCtx();
		ctx.store.add({
			sessionId: "sess-cs-1",
			title: "Stopped",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "stopped",
			completedAt: Date.now(),
		});
		ctx.store.add({
			sessionId: "sess-cs-2",
			title: "Idle",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_clear_stopped", {});

		expect(result.removed).toBe(1);
		expect(ctx.store.list()).toHaveLength(1);
		expect(ctx.store.list()[0].sessionId).toBe("sess-cs-2");
	});
});

describe("session_delegate_status lifecycle semantics", () => {
	it("keeps a never-started idle task as idle", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "idle" }),
		});
		ctx.store.add({
			sessionId: "sess-idle-new",
			title: "New",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "sess-idle-new",
		});

		expect(result.task?.status).toBe("idle");
		expect(result.task?.completedAt).toBeUndefined();
	});

	it("converts a previously streaming idle task to completed", async () => {
		const ctx = useCtx({
			delegate_status: vi.fn().mockResolvedValue({ status: "idle" }),
		});
		ctx.store.add({
			sessionId: "sess-completed",
			title: "Completed",
			task: "task",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "streaming",
		});

		const result = await ctx.client.call("session_delegate_status", {
			sessionId: "sess-completed",
		});

		expect(result.task?.status).toBe("completed");
		expect(result.task?.completedAt).toBeDefined();
	});
});

// ── session_delegate_fork ──

describe("session_delegate_fork handler", () => {
	it("calls pm.delegate_fork and adds new task to store", async () => {
		const ctx = useCtx();

		const result = await ctx.client.call("session_delegate_fork", {
			sessionId: "orig-sess",
			task: "Forked task",
			title: "Fork Title",
			projectPath: "/tmp/fork",
		});

		expect(result.sessionId).toBe("sess-fork-1");
		expect(ctx.pm.delegate_fork).toHaveBeenCalledWith("orig-sess", "Forked task", "Fork Title", "/tmp/fork", undefined, undefined);

		const stored = ctx.store.get("sess-fork-1");
		expect(stored).toBeDefined();
		expect(stored!.task).toBe("Forked task");
		expect(stored!.title).toBe("Fork Title");
		expect(stored!.status).toBe("idle");
	});

	it("passes agent from params to pm.delegate_fork", async () => {
		const ctx = useCtx();

		await ctx.client.call("session_delegate_fork", {
			sessionId: "orig-sess",
			task: "Forked task",
			title: "Fork Title",
			projectPath: "/tmp/fork",
			agent: "backend-dev",
		});

		expect(ctx.pm.delegate_fork).toHaveBeenCalledWith("orig-sess", "Forked task", "Fork Title", "/tmp/fork", "backend-dev", undefined);
	});

	it("passes model from params to pm.delegate_fork", async () => {
		const ctx = useCtx();

		await ctx.client.call("session_delegate_fork", {
			sessionId: "orig-sess",
			task: "Forked task",
			title: "Fork Title",
			projectPath: "/tmp/fork",
			model: "openai/gpt-4.1",
		});

		expect(ctx.pm.delegate_fork).toHaveBeenCalledWith("orig-sess", "Forked task", "Fork Title", "/tmp/fork", undefined, "openai/gpt-4.1");
	});

	it("emits task_started event", async () => {
		const ctx = useCtx();

		await ctx.client.call("session_delegate_fork", {
			sessionId: "orig-sess",
			task: "Forked task",
			title: "Fork Title",
		});

		const events = ctx.emittedEvents.get("task_started");
		expect(events).toHaveLength(1);
		expect(events![0]).toEqual({
			sessionId: "sess-fork-1",
			title: "Fork Title",
			task: "Forked task",
		});
	});

	it("returns error when pm throws", async () => {
		const ctx = useCtx({
			delegate_fork: vi.fn().mockRejectedValue(new Error("fork failed")),
		});

		const result = await ctx.client.call("session_delegate_fork", {
			sessionId: "orig-sess",
			task: "Forked task",
		});

		expect(result.status).toBe("error");
		expect(result.error).toBe("fork failed");
		expect(result.sessionId).toMatch(/^error-/);
	});
});

// ── session_delegate_sync ──

describe("session_delegate_sync handler", () => {
	it("returns result from pm.delegate_sync", async () => {
		const ctx = useCtx();

		const result = await ctx.client.call("session_delegate_sync", {
			task: "sync task",
			projectPath: "/tmp/sync",
		});

		expect(result.sessionId).toBe("sess-sync-1");
		expect(result.status).toBe("completed");
		expect(result.exitCode).toBe(0);
		expect(result.finalText).toBe("done");
		expect(ctx.pm.delegate_sync).toHaveBeenCalledWith("sync task", undefined, 180_000, "/tmp/sync", undefined, undefined, undefined);
	});

	it("adds task to store when title is provided", async () => {
		const ctx = useCtx();

		await ctx.client.call("session_delegate_sync", {
			task: "sync task",
			title: "Sync Title",
			projectPath: "/tmp/sync",
		});

		const stored = ctx.store.get("sess-sync-1");
		expect(stored).toBeDefined();
		expect(stored!.title).toBe("Sync Title");
		expect(stored!.status).toBe("completed");
		expect(stored!.result).toBe("done");
	});

	it("does not add to store when title is omitted", async () => {
		const ctx = useCtx();

		await ctx.client.call("session_delegate_sync", {
			task: "sync task",
			projectPath: "/tmp/sync",
		});

		expect(ctx.store.list()).toHaveLength(0);
	});

	it("returns error result when pm throws", async () => {
		const ctx = useCtx({
			delegate_sync: vi.fn().mockRejectedValue(new Error("sync boom")),
		});

		const result = await ctx.client.call("session_delegate_sync", {
			task: "fail this",
		});

		expect(result.status).toBe("error");
		expect(result.exitCode).toBe(1);
		expect(result.error).toBe("sync boom");
		expect(result.sessionId).toBe("");
	});
});
