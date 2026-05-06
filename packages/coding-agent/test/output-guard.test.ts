import { afterEach, describe, expect, test } from "vitest";
import {
	flushRawStdout,
	isStdoutTakenOver,
	restoreStdout,
	takeOverStdout,
	writeRawStdout,
} from "../src/core/output-guard.js";

describe("output-guard", () => {
	afterEach(() => {
		restoreStdout();
	});

	test("initially stdout is not taken over", () => {
		expect(isStdoutTakenOver()).toBe(false);
	});

	test("takeOverStdout sets taken over state", () => {
		takeOverStdout();
		expect(isStdoutTakenOver()).toBe(true);
	});

	test("restoreStdout clears taken over state", () => {
		takeOverStdout();
		restoreStdout();
		expect(isStdoutTakenOver()).toBe(false);
	});

	test("restoreStdout when not taken over is a no-op", () => {
		expect(isStdoutTakenOver()).toBe(false);
		expect(() => restoreStdout()).not.toThrow();
		expect(isStdoutTakenOver()).toBe(false);
	});

	test("takeOverStdout is idempotent", () => {
		takeOverStdout();
		const originalWrite = process.stdout.write;
		takeOverStdout();
		expect(process.stdout.write).toBe(originalWrite);
		expect(isStdoutTakenOver()).toBe(true);
	});

	test("writeRawStdout does not throw when not taken over", () => {
		expect(() => writeRawStdout("")).not.toThrow();
	});

	test("writeRawStdout does not throw when taken over", () => {
		takeOverStdout();
		expect(() => writeRawStdout("")).not.toThrow();
	});

	test("flushRawStdout resolves when not taken over", async () => {
		await expect(flushRawStdout()).resolves.toBeUndefined();
	});

	test("flushRawStdout resolves when taken over", async () => {
		takeOverStdout();
		await expect(flushRawStdout()).resolves.toBeUndefined();
	});
});
