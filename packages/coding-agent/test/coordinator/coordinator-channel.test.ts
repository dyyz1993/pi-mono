/**
 * Coordinator extension full-chain integration test.
 *
 * Tests the complete data flow through the channel mechanism:
 *   inbound RPC call → ChannelManager.handleInbound() → ServerChannel handler → TaskStore mutation → outbound response
 *
 * Uses ChannelManager with a capture outputFn to simulate the TUI/RPC round-trip.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorHandler, type ProcessManagerApi, TaskStore } from "../../extensions/coordinator/handler.js";
import type { CoordinatorChannelContract } from "../../extensions/coordinator/types.js";
import { createTypedChannel } from "../../src/core/extensions/channel-factory.js";
import { ChannelManager } from "../../src/core/extensions/channel-manager.js";
import type { ChannelDataMessage } from "../../src/core/extensions/channel-types.js";

function createTempDir(): string {
	return join(tmpdir(), `pi-coord-channel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function createHarness() {
	const outbound: ChannelDataMessage[] = [];
	const channelManager = new ChannelManager((msg) => outbound.push(msg));
	const rawChannel = channelManager.register("coordinator");
	const { server, client } = createTypedChannel<CoordinatorChannelContract>(rawChannel);

	const mockPm: ProcessManagerApi = {
		delegate: vi.fn().mockResolvedValue({ sessionId: "sid-mock-1", status: "started" as const }),
		delegate_send: vi.fn().mockResolvedValue({ delivered: true, targetStatus: "active" as const }),
		delegate_status: vi.fn().mockResolvedValue({ status: "idle" as const }),
		delegate_list: vi.fn().mockResolvedValue([]),
		delegate_stop: vi.fn().mockResolvedValue(true),
		delegate_fork: vi.fn().mockResolvedValue({ sessionId: "sid-mock-fork", status: "started" as const }),
		delegate_compact_status: vi.fn().mockResolvedValue({
			isCompacting: false,
			contextUsage: { tokens: null, contextWindow: 100000, percent: null },
		}),
		delegate_remove: vi.fn().mockResolvedValue(true),
		delegate_clear_stopped: vi.fn().mockResolvedValue(0),
	};

	const tempDir = createTempDir();
	mkdirSync(tempDir, { recursive: true });
	const store = new TaskStore(tempDir);

	createCoordinatorHandler(
		server,
		mockPm,
		() => "test-main-session",
		() => store,
	);

	return { channelManager, server, client, mockPm, store, outbound, tempDir };
}

/**
 * Simulate an inbound RPC call (as if from the TUI) and return the response.
 * The flow: handleInbound() → onReceive handlers → ServerChannel processes __call → sends response via outputFn
 */
async function simulateInbound(
	harness: ReturnType<typeof createHarness>,
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const invokeId = `inv_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	harness.channelManager.handleInbound({
		type: "channel_data",
		name: "coordinator",
		data: { __call: method, ...params, invokeId },
	});

	// Wait for async handler to complete
	await new Promise((r) => setTimeout(r, 20));

	const response = harness.outbound.find((m) => {
		const d = m.data as Record<string, unknown>;
		return d.invokeId === invokeId;
	});

	if (!response) {
		throw new Error(
			`No response found for ${method} with invokeId ${invokeId}. Outbound: ${JSON.stringify(harness.outbound)}`,
		);
	}

	const responseData = response.data as Record<string, unknown>;
	// Strip invokeId from response data for cleaner assertions
	const { invokeId: _iid, ...result } = responseData;
	return result;
}

describe("Coordinator: full channel round-trip", () => {
	let harness: ReturnType<typeof createHarness>;

	beforeEach(() => {
		harness = createHarness();
	});

	afterEach(() => {
		if (harness.tempDir) {
			rmSync(harness.tempDir, { recursive: true, force: true });
		}
	});

	it("session_delegate → creates task in store + returns sessionId", async () => {
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-001", status: "started" });

		const result = await simulateInbound(harness, "session_delegate", { task: "build the project" });

		expect(result.sessionId).toBe("sid-001");
		expect(result.status).toBe("started");
		expect(harness.mockPm.delegate).toHaveBeenCalledWith("build the project", process.cwd());

		// Verify task was added to store
		const task = harness.store.get("sid-001");
		expect(task).toBeDefined();
		expect(task!.task).toBe("build the project");
		expect(task!.status).toBe("idle");
	});

	it("session_delegate with projectPath → passes projectPath to pm.delegate", async () => {
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-002", status: "started" });

		const result = await simulateInbound(harness, "session_delegate", {
			task: "run tests",
			projectPath: "/path/to/other/project",
		});

		expect(result.sessionId).toBe("sid-002");
		expect(harness.mockPm.delegate).toHaveBeenCalledWith("run tests", "/path/to/other/project");

		// Verify projectPath stored
		const task = harness.store.get("sid-002");
		expect(task!.projectPath).toBe("/path/to/other/project");
	});

	it("session_delegate without projectPath → falls back to process.cwd()", async () => {
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-003", status: "started" });

		await simulateInbound(harness, "session_delegate", { task: "lint" });

		expect(harness.mockPm.delegate).toHaveBeenCalledWith("lint", process.cwd());

		const task = harness.store.get("sid-003");
		expect(task!.projectPath).toBe(process.cwd());
	});

	it("session_delegate_stop → sets stopped + completedAt in store", async () => {
		// First create a task
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-010", status: "started" });
		await simulateInbound(harness, "session_delegate", { task: "some work" });

		// Stop it
		harness.mockPm.delegate_stop.mockResolvedValue(true);
		const result = await simulateInbound(harness, "session_delegate_stop", { sessionId: "sid-010" });

		expect(result.ok).toBe(true);

		const task = harness.store.get("sid-010");
		expect(task!.status).toBe("stopped");
		expect(task!.completedAt).toBeDefined();
	});

	it("session_delegate_send → re-activates stopped task (clears completedAt)", async () => {
		// Create and stop
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-020", status: "started" });
		await simulateInbound(harness, "session_delegate", { task: "work" });
		harness.mockPm.delegate_stop.mockResolvedValue(true);
		await simulateInbound(harness, "session_delegate_stop", { sessionId: "sid-020" });

		expect(harness.store.get("sid-020")!.status).toBe("stopped");
		expect(harness.store.get("sid-020")!.completedAt).toBeDefined();

		// Send message (re-activates)
		harness.mockPm.delegate_send.mockResolvedValue({ delivered: true, targetStatus: "started" });
		await simulateInbound(harness, "session_delegate_send", {
			targetSessionId: "sid-020",
			message: "continue",
		});

		const task = harness.store.get("sid-020");
		expect(task!.status).toBe("idle");
		expect(task!.completedAt).toBeUndefined();
	});

	it("session_delegate_status → returns task with current status", async () => {
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-030", status: "started" });
		await simulateInbound(harness, "session_delegate", { task: "status check" });

		harness.mockPm.delegate_status.mockResolvedValue({ status: "streaming" });
		harness.mockPm.delegate_compact_status.mockResolvedValue({
			isCompacting: false,
			contextUsage: { tokens: 5000, contextWindow: 100000, percent: 5 },
		});

		const result = await simulateInbound(harness, "session_delegate_status", { sessionId: "sid-030" });

		expect(result.task).toBeDefined();
		expect((result.task as Record<string, unknown>).status).toBe("streaming");
		expect(result.isCompacting).toBe(false);
	});

	it("session_delegate_remove → removes task from store", async () => {
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-040", status: "started" });
		await simulateInbound(harness, "session_delegate", { task: "temp work" });

		expect(harness.store.get("sid-040")).toBeDefined();

		harness.mockPm.delegate_remove.mockResolvedValue(true);
		const result = await simulateInbound(harness, "session_delegate_remove", { sessionId: "sid-040" });

		expect(result.ok).toBe(true);
		expect(harness.store.get("sid-040")).toBeUndefined();
	});

	it("session_delegate_clear_stopped → clears all stopped/completed tasks", async () => {
		// Create 3 tasks
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-a", status: "started" });
		await simulateInbound(harness, "session_delegate", { task: "task a" });
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-b", status: "started" });
		await simulateInbound(harness, "session_delegate", { task: "task b" });
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-c", status: "started" });
		await simulateInbound(harness, "session_delegate", { task: "task c" });

		// Stop 2 of them
		harness.mockPm.delegate_stop.mockResolvedValue(true);
		await simulateInbound(harness, "session_delegate_stop", { sessionId: "sid-a" });
		await simulateInbound(harness, "session_delegate_stop", { sessionId: "sid-b" });

		expect(harness.store.list().length).toBe(3);

		// Clear stopped
		harness.mockPm.delegate_clear_stopped.mockResolvedValue(2);
		const result = await simulateInbound(harness, "session_delegate_clear_stopped", {});

		expect(result.removed).toBe(2);
		expect(harness.store.list().length).toBe(1);
		expect(harness.store.list()[0].sessionId).toBe("sid-c");
	});

	it("session_delegate_fork → creates forked task with projectPath", async () => {
		harness.mockPm.delegate_fork.mockResolvedValue({ sessionId: "sid-fork-1", status: "started" });

		const result = await simulateInbound(harness, "session_delegate_fork", {
			sessionId: "sid-original",
			task: "forked task",
			projectPath: "/path/to/forked/project",
		});

		expect(result.sessionId).toBe("sid-fork-1");
		expect(harness.mockPm.delegate_fork).toHaveBeenCalledWith(
			"sid-original",
			"forked task",
			undefined,
			"/path/to/forked/project",
		);

		const task = harness.store.get("sid-fork-1");
		expect(task).toBeDefined();
		expect(task!.task).toBe("forked task");
		expect(task!.projectPath).toBe("/path/to/forked/project");
	});
});

describe("Coordinator: full lifecycle (delegate → work → complete → cleanup)", () => {
	let harness: ReturnType<typeof createHarness>;

	beforeEach(() => {
		harness = createHarness();
	});

	afterEach(() => {
		if (harness.tempDir) {
			rmSync(harness.tempDir, { recursive: true, force: true });
		}
	});

	it("complete lifecycle: delegate → send → stop → remove → prompt clears", async () => {
		// 1. Delegate a task
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-lifecycle", status: "started" });
		await simulateInbound(harness, "session_delegate", {
			task: "build and test",
			title: "Build & Test",
			projectPath: "/project/a",
		});

		// Verify task is in store and prompt
		let task = harness.store.get("sid-lifecycle");
		expect(task).toBeDefined();
		expect(task!.projectPath).toBe("/project/a");
		let prompt = harness.store.buildPrompt();
		expect(prompt).toContain("Build & Test");
		expect(prompt).toContain("IDLE");

		// 2. Simulate "streaming" status update
		harness.mockPm.delegate_status.mockResolvedValue({ status: "streaming" });
		await simulateInbound(harness, "session_delegate_status", { sessionId: "sid-lifecycle" });
		prompt = harness.store.buildPrompt();
		expect(prompt).toContain("STREAMING");

		// 3. Stop the task
		harness.mockPm.delegate_stop.mockResolvedValue(true);
		await simulateInbound(harness, "session_delegate_stop", { sessionId: "sid-lifecycle" });

		task = harness.store.get("sid-lifecycle");
		expect(task!.status).toBe("stopped");
		expect(task!.completedAt).toBeDefined();
		prompt = harness.store.buildPrompt();
		expect(prompt).toContain("STOPPED");

		// 4. Remove the task
		harness.mockPm.delegate_remove.mockResolvedValue(true);
		await simulateInbound(harness, "session_delegate_remove", { sessionId: "sid-lifecycle" });

		expect(harness.store.get("sid-lifecycle")).toBeUndefined();
		prompt = harness.store.buildPrompt();
		expect(prompt).toBe(""); // Prompt is empty after removal
	});

	it("multiple delegates → clear all stopped → prompt shows only active", async () => {
		// Create 4 tasks in different states
		for (const [id, task] of [
			["sid-1", "Active task 1"],
			["sid-2", "Active task 2"],
			["sid-3", "Stopped task"],
			["sid-4", "Another stopped"],
		] as const) {
			harness.mockPm.delegate.mockResolvedValue({ sessionId: id, status: "started" });
			await simulateInbound(harness, "session_delegate", { task });
		}

		// Stop 2 tasks
		harness.mockPm.delegate_stop.mockResolvedValue(true);
		await simulateInbound(harness, "session_delegate_stop", { sessionId: "sid-3" });
		await simulateInbound(harness, "session_delegate_stop", { sessionId: "sid-4" });

		// Prompt shows all 4
		let prompt = harness.store.buildPrompt();
		expect(prompt).toContain("Active task 1");
		expect(prompt).toContain("Active task 2");
		expect(prompt).toContain("Stopped task");
		expect(prompt).toContain("Another stopped");

		// Clear stopped
		harness.mockPm.delegate_clear_stopped.mockResolvedValue(2);
		await simulateInbound(harness, "session_delegate_clear_stopped", {});

		// Prompt now only shows active tasks
		prompt = harness.store.buildPrompt();
		expect(prompt).toContain("Active task 1");
		expect(prompt).toContain("Active task 2");
		expect(prompt).not.toContain("Stopped task");
		expect(prompt).not.toContain("Another stopped");
	});
});

// ── Supplementary tests: edge cases, error propagation, concurrency ──

describe("Coordinator: already_running / error / edge cases", () => {
	let harness: ReturnType<typeof createHarness>;

	beforeEach(() => {
		harness = createHarness();
	});

	afterEach(() => {
		if (harness.tempDir) {
			rmSync(harness.tempDir, { recursive: true, force: true });
		}
	});

	it("session_delegate with already_running status → still adds to store", async () => {
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-running", status: "already_running" as const });

		const result = await simulateInbound(harness, "session_delegate", { task: "already going" });

		expect(result.sessionId).toBe("sid-running");
		expect(result.status).toBe("already_running");

		// Task is added regardless of status
		const task = harness.store.get("sid-running");
		expect(task).toBeDefined();
		expect(task!.task).toBe("already going");
	});

	it("session_delegate when pm.delegate throws → returns __error response", async () => {
		harness.mockPm.delegate.mockRejectedValue(new Error("connection refused"));

		const result = await simulateInbound(harness, "session_delegate", { task: "will fail" });

		expect(result.__error).toBeDefined();
		expect((result.__error as string).toLowerCase()).toContain("connection refused");
		expect(harness.store.list().length).toBe(0);
	});

	it("session_delegate when pm returns no sessionId → returns __error response", async () => {
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "", status: "started" });

		const result = await simulateInbound(harness, "session_delegate", { task: "bad response" });

		expect(result.__error).toBeDefined();
		expect(result.__error as string).toContain("no sessionId returned");
	});

	it("session_delegate_fork when pm.fork returns no sessionId → returns __error response", async () => {
		harness.mockPm.delegate_fork.mockResolvedValue({ sessionId: "", status: "started" });

		const result = await simulateInbound(harness, "session_delegate_fork", {
			sessionId: "sid-src",
			task: "fork fail",
		});

		expect(result.__error).toBeDefined();
		expect(result.__error as string).toContain("fork failed");
	});

	it("session_delegate_stop when pm returns false → store NOT updated", async () => {
		harness.mockPm.delegate.mockResolvedValue({ sessionId: "sid-stopfail", status: "started" });
		await simulateInbound(harness, "session_delegate", { task: "try stop" });

		harness.mockPm.delegate_stop.mockResolvedValue(false);
		await simulateInbound(harness, "session_delegate_stop", { sessionId: "sid-stopfail" });

		// Task should remain in original status
		const task = harness.store.get("sid-stopfail");
		expect(task!.status).toBe("idle");
		expect(task!.completedAt).toBeUndefined();
	});

	it("session_delegate_remove for unknown session → returns ok: false", async () => {
		const result = await simulateInbound(harness, "session_delegate_remove", { sessionId: "nonexistent" });

		expect(result.ok).toBe(false);
		expect(harness.store.list().length).toBe(0);
	});

	it("session_delegate_status for unknown session → returns task: null", async () => {
		harness.mockPm.delegate_status.mockResolvedValue({ status: "stopped" });

		const result = await simulateInbound(harness, "session_delegate_status", { sessionId: "unknown" });

		expect(result.task).toBeNull();
	});

	it("session_delegate_send for session not in store but pm delivers → no crash", async () => {
		harness.mockPm.delegate_send.mockResolvedValue({ delivered: true, targetStatus: "active" });

		const result = await simulateInbound(harness, "session_delegate_send", {
			targetSessionId: "external-session",
			message: "hello",
		});

		expect(result.delivered).toBe(true);
		// No crash, no store mutation
		expect(harness.store.list().length).toBe(0);
	});
});

describe("Coordinator: concurrent delegates to same projectPath", () => {
	let harness: ReturnType<typeof createHarness>;

	beforeEach(() => {
		harness = createHarness();
	});

	afterEach(() => {
		if (harness.tempDir) {
			rmSync(harness.tempDir, { recursive: true, force: true });
		}
	});

	it("multiple delegates to same projectPath → each gets unique task entry", async () => {
		harness.mockPm.delegate
			.mockResolvedValueOnce({ sessionId: "sid-conc-1", status: "started" })
			.mockResolvedValueOnce({ sessionId: "sid-conc-2", status: "started" })
			.mockResolvedValueOnce({ sessionId: "sid-conc-3", status: "started" });

		// Fire all 3 in parallel
		const [r1, r2, r3] = await Promise.all([
			simulateInbound(harness, "session_delegate", { task: "task A", projectPath: "/shared/project" }),
			simulateInbound(harness, "session_delegate", { task: "task B", projectPath: "/shared/project" }),
			simulateInbound(harness, "session_delegate", { task: "task C", projectPath: "/shared/project" }),
		]);

		expect(r1.sessionId).toBe("sid-conc-1");
		expect(r2.sessionId).toBe("sid-conc-2");
		expect(r3.sessionId).toBe("sid-conc-3");

		// All 3 in store
		expect(harness.store.list().length).toBe(3);
		expect(harness.store.list().map((t) => t.projectPath)).toEqual([
			"/shared/project",
			"/shared/project",
			"/shared/project",
		]);

		// All 3 in prompt
		const prompt = harness.store.buildPrompt();
		expect(prompt).toContain("task A");
		expect(prompt).toContain("task B");
		expect(prompt).toContain("task C");
	});
});
