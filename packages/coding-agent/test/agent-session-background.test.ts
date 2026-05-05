import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./test-harness.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("AgentSession.background() task ID", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.session?.dispose();
	});

	it("generates a valid UUID for background task id", async () => {
		harness = createHarness();

		const task = harness.session.background(async () => "result");
		await task.promise;

		expect(task.id).toBeDefined();
		expect(typeof task.id).toBe("string");
		expect(task.id.length).toBe(36);
		expect(UUID_REGEX.test(task.id)).toBe(true);
	});

	it("generates unique IDs for consecutive background tasks", async () => {
		harness = createHarness();

		const task1 = harness.session.background(async () => "a");
		const task2 = harness.session.background(async () => "b");
		const task3 = harness.session.background(async () => "c");

		await Promise.all([task1.promise, task2.promise, task3.promise]);

		const ids = [task1.id, task2.id, task3.id];
		expect(new Set(ids).size).toBe(3);
	});

	it("task has cancel function and abort signal", async () => {
		harness = createHarness();

		const task = harness.session.background(async (_signal) => {
			await new Promise((r) => setTimeout(r, 500));
			return "done";
		});

		expect(task.cancel).toBeDefined();
		expect(typeof task.cancel).toBe("function");
		expect(task.signal).toBeDefined();
		expect(task.signal.aborted).toBe(false);

		task.cancel();
		expect(task.signal.aborted).toBe(true);
	});

	it("cleans up task from _backgroundTasks after completion", async () => {
		harness = createHarness();

		const task = harness.session.background(async () => "done");
		await task.promise;

		const tasks = (harness.session as any)._backgroundTasks as Set<any>;
		expect(tasks.has(task)).toBe(false);
	});
});
