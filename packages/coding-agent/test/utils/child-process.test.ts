import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { waitForChildProcess } from "../../src/utils/child-process.js";

function createMockChild(overrides: Partial<ChildProcess> = {}): ChildProcess {
	const child = new EventEmitter() as unknown as ChildProcess;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = vi.fn();
	Object.assign(child, overrides);
	return child;
}

describe("waitForChildProcess", () => {
	test("resolves with exit code 0 on close", async () => {
		const child = createMockChild();
		const promise = waitForChildProcess(child);
		child.emit("close", 0);
		const code = await promise;
		expect(code).toBe(0);
	});

	test("resolves with non-zero exit code", async () => {
		const child = createMockChild();
		const promise = waitForChildProcess(child);
		child.emit("close", 1);
		const code = await promise;
		expect(code).toBe(1);
	});

	test("resolves with null exit code", async () => {
		const child = createMockChild();
		const promise = waitForChildProcess(child);
		child.emit("close", null);
		const code = await promise;
		expect(code).toBeNull();
	});

	test("rejects on error event", async () => {
		const child = createMockChild();
		const promise = waitForChildProcess(child);
		const error = new Error("spawn failed");
		child.emit("error", error);
		await expect(promise).rejects.toThrow("spawn failed");
	});

	test("resolves after exit + stdio end (close never fires)", async () => {
		vi.useFakeTimers();
		const child = createMockChild();
		const promise = waitForChildProcess(child);

		child.emit("exit", 0);
		child.stdout!.emit("end");
		child.stderr!.emit("end");

		vi.advanceTimersByTime(0);
		const code = await promise;
		expect(code).toBe(0);
		vi.useRealTimers();
	});

	test("finalizes after grace period if stdio does not end", async () => {
		vi.useFakeTimers();
		const child = createMockChild();
		const promise = waitForChildProcess(child);

		child.emit("exit", 42);

		vi.advanceTimersByTime(200);
		const code = await promise;
		expect(code).toBe(42);
		vi.useRealTimers();
	});

	test("close event takes priority over exit+timeout", async () => {
		vi.useFakeTimers();
		const child = createMockChild();
		const promise = waitForChildProcess(child);

		child.emit("exit", 1);
		child.emit("close", 0);

		vi.advanceTimersByTime(0);
		const code = await promise;
		expect(code).toBe(0);
		vi.useRealTimers();
	});

	test("handles null stdout and stderr", async () => {
		const child = new EventEmitter() as unknown as ChildProcess;
		child.stdout = null;
		child.stderr = null;
		child.kill = vi.fn();

		const promise = waitForChildProcess(child);
		child.emit("exit", 0);

		vi.useFakeTimers();
		vi.advanceTimersByTime(200);
		const code = await promise;
		expect(code).toBe(0);
		vi.useRealTimers();
	});

	test("does not settle twice (error then close)", async () => {
		const child = createMockChild();
		const promise = waitForChildProcess(child);

		child.emit("error", new Error("err"));
		child.emit("close", 0);

		await expect(promise).rejects.toThrow("err");
	});
});
