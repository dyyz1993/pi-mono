/**
 * TDD tests for ghost delegated task cleanup.
 *
 * Bug: When a session file is physically deleted (or the child process
      crashes without going through stop()), the task entry stays in
 * the TaskStore forever. The LLM sees it in buildPrompt(), but
 * session_delegate_stop/remove/clear_stopped can't delete it because
 * the underlying process manager throws or returns "not found".
 *
 * Fix strategy:
 * 1. session_delegate_list: catch errors from pm.delegate_status(),
 *    auto-remove tasks that throw "not found"
 * 2. session_delegate_send: when targetStatus is "not_found",
 *    auto-remove the task from store
 * 3. session_delegate_stop: when pm throws, still mark as stopped
 *    and make it removable
 * 4. session_delegate_remove: always works even if pm.delegate_stop throws
 * 5. buildPrompt: filter out very old idle tasks (zombies)
 * 6. TaskStore.save: evict idle tasks older than threshold
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createCoordinatorHandler,
	type ProcessManagerApi,
	TaskStore,
} from "../../../extensions/coordinator/handler.js";
import type { DelegatedTask } from "../../../extensions/coordinator/types.js";

// ─── helpers ────────────────────────────────────────────────────────

function makeTask(overrides: Partial<DelegatedTask> = {}): DelegatedTask {
	return {
		sessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		title: "Test task",
		task: "Do something",
		projectPath: "/tmp/test",
		dispatchedAt: Date.now(),
		status: "idle",
		...overrides,
	};
}

function createTempDir(): string {
	const dir = path.join(os.tmpdir(), `ghost-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Creates a fake channel + handler wired to a mock ProcessManagerApi.
 * Returns the store so tests can inspect state.
 */
function createHarness(pmOverrides: Partial<ProcessManagerApi> = {}) {
	const tempDir = createTempDir();
	const store = new TaskStore(tempDir);
	const sessionId = "parent-session-1";

	const emittedEvents: Array<{ event: string; payload: unknown }> = [];
	const handledRequests: Array<{ method: string; params: unknown }> = [];

	// Minimal fake channel that captures emit/handle
	const fakeChannel = {
		name: "coordinator",
		emit: (event: string, payload: unknown) => {
			emittedEvents.push({ event, payload });
		},
		handle: (method: string, handler: (params: unknown) => Promise<unknown>) => {
			handledRequests.push({ method, params: undefined });
		},
		send: () => {},
		onReceive: () => () => {},
		invoke: () => Promise.resolve({}),
		call: () => Promise.resolve({}),
	} as never;

	const pm: ProcessManagerApi = {
		delegate: vi.fn(async () => ({ sessionId: `child-${Date.now()}`, status: "started" as const })),
		delegate_send: vi.fn(async () => ({ delivered: true, targetStatus: "active" as const })),
		delegate_status: vi.fn(async () => ({ status: "idle" as const })),
		delegate_list: vi.fn(async () => []),
		delegate_stop: vi.fn(async () => true),
		delegate_fork: vi.fn(async () => ({ sessionId: `fork-${Date.now()}`, status: "started" as const })),
		delegate_compact_status: vi.fn(async () => ({
			isCompacting: false,
			contextUsage: { tokens: null, contextWindow: 128000, percent: null },
		})),
		delegate_remove: vi.fn(async () => true),
		delegate_clear_stopped: vi.fn(async () => 0),
		delegate_sync: vi.fn(async () => ({
			sessionId: `sync-${Date.now()}`,
			status: "completed" as const,
			exitCode: 0,
			finalText: "done",
		})),
		...pmOverrides,
	};

	// Wire up the handler — this calls channel.handle() for each method
	createCoordinatorHandler(
		fakeChannel,
		pm,
		() => sessionId,
		() => store,
	);

	// Now we need to re-extract the actual handlers since channel.handle was a no-op.
	// Instead, let's use the handler functions directly by re-reading the source pattern.
	// Actually, we'll build a simpler approach: invoke the handler manually.

	return { store, pm, tempDir, emittedEvents, sessionId };
}

/**
 * Invokes a coordinator handler by re-creating the wiring with real handle tracking.
 */
function createRealHarness(pmOverrides: Partial<ProcessManagerApi> = {}) {
	const tempDir = createTempDir();
	const store = new TaskStore(tempDir);
	const sessionId = "parent-session-1";
	const emittedEvents: Array<{ event: string; payload: unknown }> = [];

	const handlers = new Map<string, (params: unknown) => Promise<unknown>>();

	const fakeChannel = {
		name: "coordinator",
		emit: (event: string, payload: unknown) => {
			emittedEvents.push({ event, payload });
		},
		handle: (method: string, handler: (params: unknown) => Promise<unknown>) => {
			handlers.set(method, handler);
		},
		send: () => {},
		onReceive: () => () => {},
		invoke: () => Promise.resolve({}),
		call: () => Promise.resolve({}),
	} as never;

	const pm: ProcessManagerApi = {
		delegate: vi.fn(async () => ({ sessionId: `child-${Date.now()}`, status: "started" as const })),
		delegate_send: vi.fn(async () => ({ delivered: true, targetStatus: "active" as const })),
		delegate_status: vi.fn(async () => ({ status: "idle" as const })),
		delegate_list: vi.fn(async () => []),
		delegate_stop: vi.fn(async () => true),
		delegate_fork: vi.fn(async () => ({ sessionId: `fork-${Date.now()}`, status: "started" as const })),
		delegate_compact_status: vi.fn(async () => ({
			isCompacting: false,
			contextUsage: { tokens: null, contextWindow: 128000, percent: null },
		})),
		delegate_remove: vi.fn(async () => true),
		delegate_clear_stopped: vi.fn(async () => 0),
		delegate_sync: vi.fn(async () => ({
			sessionId: `sync-${Date.now()}`,
			status: "completed" as const,
			exitCode: 0,
			finalText: "done",
		})),
		...pmOverrides,
	};

	createCoordinatorHandler(
		fakeChannel,
		pm,
		() => sessionId,
		() => store,
	);

	return {
		store,
		pm,
		tempDir,
		sessionId,
		emittedEvents,
		handlers,
		invoke: (method: string, params: unknown) => {
			const handler = handlers.get(method);
			if (!handler) throw new Error(`No handler for method: ${method}`);
			return handler(params) as Promise<unknown>;
		},
	};
}

// ─── Test suites ─────────────────────────────────────────────────────

const tempDirs: string[] = [];

describe("ghost delegated task cleanup", () => {
	afterEach(() => {
		for (const dir of tempDirs) {
			if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
		vi.restoreAllMocks();
	});

	// ─── 1. TaskStore level tests ─────────────────────────────────────

	describe("TaskStore: idle zombie eviction on save", () => {
		it("save() evicts idle tasks older than 24 hours", () => {
			const dir = createTempDir();
			tempDirs.push(dir);

			const store = new TaskStore(dir);
			const oneDayAgo = Date.now() - 25 * 60 * 60 * 1000;

			store.add(
				makeTask({
					sessionId: "zombie-old",
					status: "idle",
					dispatchedAt: oneDayAgo,
				}),
			);
			store.add(
				makeTask({
					sessionId: "fresh-idle",
					status: "idle",
					dispatchedAt: Date.now(),
				}),
			);

			// save() is called internally by add(), so reload from disk
			const store2 = new TaskStore(dir);
			expect(store2.list().length).toBe(1);
			expect(store2.list()[0].sessionId).toBe("fresh-idle");
		});

		it("save() keeps active tasks regardless of age", () => {
			const dir = createTempDir();
			tempDirs.push(dir);

			const store = new TaskStore(dir);
			const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;

			store.add(
				makeTask({
					sessionId: "old-streaming",
					status: "streaming",
					dispatchedAt: twoDaysAgo,
				}),
			);

			const store2 = new TaskStore(dir);
			expect(store2.list().length).toBe(1);
			expect(store2.list()[0].sessionId).toBe("old-streaming");
		});

		it("save() keeps recently stopped tasks (under 5 min)", () => {
			const dir = createTempDir();
			tempDirs.push(dir);

			const store = new TaskStore(dir);
			store.add(
				makeTask({
					sessionId: "recent-stopped",
					status: "stopped",
					completedAt: Date.now() - 3 * 60 * 1000, // 3 min ago
				}),
			);

			const store2 = new TaskStore(dir);
			expect(store2.list().length).toBe(1);
		});
	});

	describe("TaskStore: buildPrompt filters idle zombies", () => {
		it("buildPrompt() excludes idle tasks older than 24 hours", () => {
			const dir = createTempDir();
			tempDirs.push(dir);

			const store = new TaskStore(dir);
			const oneDayAgo = Date.now() - 25 * 60 * 60 * 1000;

			store.add(
				makeTask({
					sessionId: "zombie-idle",
					title: "Zombie Idle Task",
					status: "idle",
					dispatchedAt: oneDayAgo,
				}),
			);
			store.add(
				makeTask({
					sessionId: "fresh-idle",
					title: "Fresh Idle Task",
					status: "idle",
					dispatchedAt: Date.now(),
				}),
			);

			const prompt = store.buildPrompt();
			expect(prompt).not.toContain("Zombie Idle Task");
			expect(prompt).toContain("Fresh Idle Task");
		});
	});

	// ─── 2. Handler level tests — ghost session scenarios ─────────────

	describe("session_delegate_list: auto-cleanup on ghost detection", () => {
		it("removes task from store when pm.delegate_status throws", async () => {
			const harness = createRealHarness({
				delegate_status: vi.fn(async () => {
					throw new Error("Session not found or already stopped");
				}),
			});

			harness.store.add(makeTask({ sessionId: "ghost-1", status: "idle" }));
			harness.store.add(makeTask({ sessionId: "alive-1", status: "idle" }));

			// Override delegate_status to only throw for ghost-1
			(harness.pm.delegate_status as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
				if (id === "ghost-1") throw new Error("Session not found");
				return { status: "idle" as const };
			});

			const result = await harness.invoke("session_delegate_list", {});

			const tasks = (result as { tasks: DelegatedTask[] }).tasks;
			expect(tasks.find((t) => t.sessionId === "ghost-1")).toBeUndefined();
			expect(tasks.find((t) => t.sessionId === "alive-1")).toBeDefined();
			expect(harness.store.get("ghost-1")).toBeUndefined();
		});

		it("removes task when pm.delegate_status returns stopped", async () => {
			const harness = createRealHarness({
				delegate_status: vi.fn(async (id: string) => {
					if (id === "stopped-1") return { status: "stopped" as const };
					return { status: "idle" as const };
				}),
			});

			harness.store.add(makeTask({ sessionId: "stopped-1", status: "idle" }));
			harness.store.add(makeTask({ sessionId: "alive-2", status: "idle" }));

			const result = await harness.invoke("session_delegate_list", {});

			const tasks = (result as { tasks: DelegatedTask[] }).tasks;
			expect(tasks.find((t) => t.sessionId === "stopped-1")).toBeUndefined();
			expect(harness.store.get("stopped-1")).toBeUndefined();
		});

		it("does not crash when one task's status check throws — continues checking others", async () => {
			const harness = createRealHarness({
				delegate_status: vi.fn(async (id: string) => {
					if (id === "ghost-a") throw new Error("not found");
					if (id === "ghost-b") throw new Error("session file deleted");
					return { status: "idle" as const };
				}),
			});

			harness.store.add(makeTask({ sessionId: "ghost-a", status: "idle" }));
			harness.store.add(makeTask({ sessionId: "ghost-b", status: "idle" }));
			harness.store.add(makeTask({ sessionId: "alive-c", status: "idle" }));

			// Should NOT throw
			const result = await harness.invoke("session_delegate_list", {});

			const tasks = (result as { tasks: DelegatedTask[] }).tasks;
			expect(tasks.length).toBe(1);
			expect(tasks[0].sessionId).toBe("alive-c");
			expect(harness.store.get("ghost-a")).toBeUndefined();
			expect(harness.store.get("ghost-b")).toBeUndefined();
		});
	});

	describe("session_delegate_send: auto-cleanup on not_found", () => {
		it("removes task from store when targetStatus is not_found", async () => {
			const harness = createRealHarness({
				delegate_send: vi.fn(async () => ({
					delivered: false,
					targetStatus: "not_found" as const,
				})),
			});

			harness.store.add(makeTask({ sessionId: "ghost-target", status: "idle" }));
			expect(harness.store.get("ghost-target")).toBeDefined();

			await harness.invoke("session_delegate_send", {
				targetSessionId: "ghost-target",
				message: "hello",
			});

			expect(harness.store.get("ghost-target")).toBeUndefined();
		});

		it("does not remove task when delivered is true", async () => {
			const harness = createRealHarness({
				delegate_send: vi.fn(async () => ({
					delivered: true,
					targetStatus: "active" as const,
				})),
			});

			harness.store.add(makeTask({ sessionId: "alive-target", status: "idle" }));

			await harness.invoke("session_delegate_send", {
				targetSessionId: "alive-target",
				message: "hello",
			});

			expect(harness.store.get("alive-target")).toBeDefined();
		});
	});

	describe("session_delegate_stop: graceful handling when pm throws", () => {
		it("still marks as stopped in store when pm.delegate_stop throws", async () => {
			const harness = createRealHarness({
				delegate_stop: vi.fn(async () => {
					throw new Error("Session not found or already stopped");
				}),
			});

			harness.store.add(makeTask({ sessionId: "ghost-stop", status: "idle" }));

			const result = await harness.invoke("session_delegate_stop", {
				sessionId: "ghost-stop",
			});

			// The handler should NOT crash, and should still mark as stopped
			// so it can be cleaned up later
			const { ok } = result as { ok: boolean };
			expect(ok).toBe(false);
			// Even though stop failed, the task should be marked stopped for cleanup
			const task = harness.store.get("ghost-stop");
			expect(task).toBeDefined();
			expect(task?.status).toBe("stopped");
		});
	});

	describe("session_delegate_remove: always works even on ghost tasks", () => {
		it("removes task from store even when task exists but pm throws", async () => {
			const harness = createRealHarness({
				delegate_stop: vi.fn(async () => {
					throw new Error("Session not found");
				}),
			});

			harness.store.add(makeTask({ sessionId: "ghost-remove", status: "idle" }));

			const result = await harness.invoke("session_delegate_remove", {
				sessionId: "ghost-remove",
			});

			const { ok } = result as { ok: boolean };
			expect(ok).toBe(true);
			expect(harness.store.get("ghost-remove")).toBeUndefined();
		});

		it("returns ok:false when task not in store at all", async () => {
			const harness = createRealHarness({});

			const result = await harness.invoke("session_delegate_remove", {
				sessionId: "never-existed",
			});

			const { ok } = result as { ok: boolean };
			expect(ok).toBe(false);
		});
	});

	describe("session_delegate_status: cleanup on ghost detection", () => {
		it("removes task from store when pm throws not_found", async () => {
			const harness = createRealHarness({
				delegate_status: vi.fn(async () => {
					throw new Error("Session not found");
				}),
				delegate_compact_status: vi.fn(async () => ({
					isCompacting: false,
					contextUsage: { tokens: null, contextWindow: 128000, percent: null },
				})),
			});

			harness.store.add(makeTask({ sessionId: "ghost-status", status: "idle" }));

			const result = await harness.invoke("session_delegate_status", {
				sessionId: "ghost-status",
			});

			const { task } = result as { task: DelegatedTask | null };
			expect(task).toBeNull();
			expect(harness.store.get("ghost-status")).toBeUndefined();
		});

		it("keeps task when pm returns a valid status", async () => {
			const harness = createRealHarness({
				delegate_status: vi.fn(async () => ({ status: "streaming" as const })),
				delegate_compact_status: vi.fn(async () => ({
					isCompacting: false,
					contextUsage: { tokens: null, contextWindow: 128000, percent: null },
				})),
			});

			harness.store.add(makeTask({ sessionId: "alive-status", status: "idle" }));

			const result = await harness.invoke("session_delegate_status", {
				sessionId: "alive-status",
			});

			const { task } = result as { task: DelegatedTask | null };
			expect(task).not.toBeNull();
			expect(task?.status).toBe("streaming");
		});
	});

	// ─── 3. End-to-end ghost scenario ─────────────────────────────────

	describe("full ghost scenario: create → crash → list → clean", () => {
		it("ghost tasks (pm can't find) are cleaned by list regardless of age", async () => {
			const harness = createRealHarness({
				delegate_status: vi.fn(async (id: string) => {
					if (id.startsWith("ghost-")) throw new Error("not found");
					return { status: "idle" as const };
				}),
			});

			// Simulate 7 ghost tasks — recent but pm can't find them
			// (process crashed but store entry survived)
			for (let i = 0; i < 7; i++) {
				harness.store.add(
					makeTask({
						sessionId: `ghost-${i}`,
						title: `Ghost task ${i}`,
						status: "idle",
						dispatchedAt: Date.now(), // recent, so save() won't evict them
					}),
				);
			}
			// One alive task
			harness.store.add(
				makeTask({
					sessionId: "alive-task",
					title: "Alive task",
					status: "idle",
				}),
			);

			expect(harness.store.list().length).toBe(8);

			// Call list — should clean all ghosts (pm throws for ghost-*)
			const result = await harness.invoke("session_delegate_list", {});
			const tasks = (result as { tasks: DelegatedTask[] }).tasks;

			expect(tasks.length).toBe(1);
			expect(tasks[0].sessionId).toBe("alive-task");

			// Store should be clean too
			expect(harness.store.list().length).toBe(1);
			// buildPrompt should only show alive task
			const prompt = harness.store.buildPrompt();
			expect(prompt).not.toContain("Ghost");
			expect(prompt).toContain("Alive task");
		});

		it("clear_stopped then list removes all zombie types", async () => {
			const harness = createRealHarness({
				delegate_status: vi.fn(async (id: string) => {
					if (id.includes("ghost")) throw new Error("not found");
					return { status: "idle" as const };
				}),
			});

			// Mix of zombie types
			harness.store.add(makeTask({ sessionId: "ghost-idle-1", status: "idle" }));
			harness.store.add(makeTask({ sessionId: "ghost-idle-2", status: "idle" }));
			harness.store.add(
				makeTask({ sessionId: "zombie-stopped", status: "stopped", completedAt: Date.now() - 10 * 60 * 1000 }),
			);
			harness.store.add(makeTask({ sessionId: "alive-fresh", status: "idle" }));

			// First: clear stopped tasks
			await harness.invoke("session_delegate_clear_stopped", {});
			expect(harness.store.get("zombie-stopped")).toBeUndefined();

			// Then: list cleans up ghosts
			const result = await harness.invoke("session_delegate_list", {});
			const tasks = (result as { tasks: DelegatedTask[] }).tasks;
			expect(tasks.length).toBe(1);
			expect(tasks[0].sessionId).toBe("alive-fresh");
		});
	});
});
