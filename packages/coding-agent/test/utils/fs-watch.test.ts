import { EventEmitter } from "node:events";
import type { FSWatcher, WatchListener } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { closeWatcher, FS_WATCH_RETRY_DELAY_MS, watchWithErrorHandler } from "../../src/utils/fs-watch.js";

describe("closeWatcher", () => {
	test("handles null watcher", () => {
		expect(() => closeWatcher(null)).not.toThrow();
	});

	test("handles undefined watcher", () => {
		expect(() => closeWatcher(undefined)).not.toThrow();
	});

	test("calls close on active watcher", () => {
		const watcher = { close: vi.fn() } as unknown as FSWatcher;
		closeWatcher(watcher);
		expect(watcher.close).toHaveBeenCalledTimes(1);
	});

	test("ignores errors from watcher.close()", () => {
		const watcher = {
			close: vi.fn(() => {
				throw new Error("close error");
			}),
		} as unknown as FSWatcher;
		expect(() => closeWatcher(watcher)).not.toThrow();
	});
});

describe("watchWithErrorHandler", () => {
	test("returns watcher and sets up error handler", () => {
		const dir = mkdtempSync(join(tmpdir(), "fs-watch-test-"));
		const filePath = join(dir, "test.txt");
		writeFileSync(filePath, "hello");
		try {
			const listener = vi.fn() as WatchListener<string>;
			const onError = vi.fn();
			const result = watchWithErrorHandler(filePath, listener, onError);
			expect(result).not.toBeNull();
			closeWatcher(result);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("calls onError and returns null when watch throws", () => {
		const listener = vi.fn() as WatchListener<string>;
		const onError = vi.fn();
		const result = watchWithErrorHandler("/nonexistent/path/that/does/not/exist", listener, onError);
		expect(result).toBeNull();
		expect(onError).toHaveBeenCalledTimes(1);
	});
});

describe("FS_WATCH_RETRY_DELAY_MS", () => {
	test("is 5000", () => {
		expect(FS_WATCH_RETRY_DELAY_MS).toBe(5000);
	});
});
