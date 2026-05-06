import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sleep } from "../../src/utils/sleep.js";

describe("sleep", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("resolves after specified time", async () => {
		const promise = sleep(1000);
		vi.advanceTimersByTime(1000);
		await expect(promise).resolves.toBeUndefined();
	});

	test("does not resolve before time elapses", async () => {
		const promise = sleep(1000);
		let resolved = false;
		promise.then(() => {
			resolved = true;
		});
		vi.advanceTimersByTime(500);
		await vi.advanceTimersByTimeAsync(0);
		expect(resolved).toBe(false);
	});

	test("rejects immediately if signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(sleep(1000, controller.signal)).rejects.toThrow("Aborted");
	});

	test("rejects when signal is aborted during sleep", async () => {
		const controller = new AbortController();
		const promise = sleep(5000, controller.signal);
		controller.abort();
		await expect(promise).rejects.toThrow("Aborted");
	});

	test("works without signal", async () => {
		const promise = sleep(0);
		vi.advanceTimersByTime(0);
		await expect(promise).resolves.toBeUndefined();
	});
});
