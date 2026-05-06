import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnManagedProcess } from "../../src/core/tools/spawn-managed.js";

describe("spawnManagedProcess", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const d of tempDirs.splice(0)) {
			try {
				if (existsSync(d)) rmSync(d, { recursive: true });
			} catch {}
		}
	});

	function makeTempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "pi-spawn-test-"));
		tempDirs.push(dir);
		return dir;
	}

	it("spawns a process and returns pid", async () => {
		const cwd = makeTempDir();
		const result = spawnManagedProcess({ command: "echo hello", cwd });
		if (result instanceof Error) {
			throw result;
		}

		expect(result.pid).toBeDefined();
		expect(typeof result.pid).toBe("number");
		expect(result.child).toBeDefined();
		expect(typeof result.isTimedOut).toBe("function");
		expect(typeof result.cleanup).toBe("function");

		await new Promise<void>((resolve, reject) => {
			result.child.on("exit", (code) => {
				if (code === 0) resolve();
				else reject(new Error(`exit code ${code}`));
			});
		});
		result.cleanup();
	});

	it("returns Error when cwd does not exist", () => {
		const result = spawnManagedProcess({
			command: "echo test",
			cwd: "/nonexistent/path/12345",
		});
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain("Working directory does not exist");
	});

	it("captures stdout output", async () => {
		const cwd = makeTempDir();
		const result = spawnManagedProcess({ command: "echo hello world", cwd });
		if (result instanceof Error) throw result;

		const chunks: Buffer[] = [];
		result.child.stdout!.on("data", (data: Buffer) => chunks.push(data));

		await new Promise<void>((resolve) => {
			result.child.on("exit", () => resolve());
		});
		result.cleanup();

		const output = Buffer.concat(chunks).toString().trim();
		expect(output).toBe("hello world");
	});

	it("captures stderr output", async () => {
		const cwd = makeTempDir();
		const result = spawnManagedProcess({ command: "echo error >&2", cwd });
		if (result instanceof Error) throw result;

		const chunks: Buffer[] = [];
		result.child.stderr!.on("data", (data: Buffer) => chunks.push(data));

		await new Promise<void>((resolve) => {
			result.child.on("exit", () => resolve());
		});
		result.cleanup();

		const output = Buffer.concat(chunks).toString().trim();
		expect(output).toBe("error");
	});

	it("kills process on abort signal", async () => {
		const cwd = makeTempDir();
		const controller = new AbortController();

		const result = spawnManagedProcess({
			command: "sleep 60",
			cwd,
			signal: controller.signal,
		});
		if (result instanceof Error) throw result;
		const pid = result.pid;

		setTimeout(() => controller.abort(), 100);

		const exitCode = await new Promise<number | null>((resolve) => {
			result.child.on("exit", (code) => resolve(code));
		});
		result.cleanup();

		expect(exitCode).not.toBe(0);
		expect(pid).toBeDefined();
	});

	it("reports timeout when process exceeds timeout", async () => {
		const cwd = makeTempDir();
		const result = spawnManagedProcess({
			command: "sleep 60",
			cwd,
			timeout: 1,
		});
		if (result instanceof Error) throw result;

		expect(result.isTimedOut()).toBe(false);

		await new Promise<void>((resolve) => {
			result.child.on("exit", () => resolve());
		});
		result.cleanup();

		expect(result.isTimedOut()).toBe(true);
	});

	it("does not timeout for fast commands", async () => {
		const cwd = makeTempDir();
		const result = spawnManagedProcess({
			command: "echo fast",
			cwd,
			timeout: 10,
		});
		if (result instanceof Error) throw result;

		await new Promise<void>((resolve) => {
			result.child.on("exit", () => resolve());
		});
		result.cleanup();

		expect(result.isTimedOut()).toBe(false);
	});

	it("kills process immediately when signal is already aborted", async () => {
		const cwd = makeTempDir();
		const controller = new AbortController();
		controller.abort();

		const result = spawnManagedProcess({
			command: "sleep 60",
			cwd,
			signal: controller.signal,
		});
		if (result instanceof Error) throw result;

		const exitCode = await new Promise<number | null>((resolve) => {
			result.child.on("exit", (code) => resolve(code));
		});
		result.cleanup();

		expect(exitCode).not.toBe(0);
	});

	it("passes custom environment variables", async () => {
		const cwd = makeTempDir();
		const result = spawnManagedProcess({
			command: "echo $PI_TEST_VAR",
			cwd,
			env: { ...process.env, PI_TEST_VAR: "custom_value_123" },
		});
		if (result instanceof Error) throw result;

		const chunks: Buffer[] = [];
		result.child.stdout!.on("data", (data: Buffer) => chunks.push(data));

		await new Promise<void>((resolve) => {
			result.child.on("exit", () => resolve());
		});
		result.cleanup();

		const output = Buffer.concat(chunks).toString().trim();
		expect(output).toBe("custom_value_123");
	});

	it("cleanup clears timeout and signal listeners", async () => {
		const cwd = makeTempDir();
		const controller = new AbortController();

		const result = spawnManagedProcess({
			command: "echo done",
			cwd,
			timeout: 30,
			signal: controller.signal,
		});
		if (result instanceof Error) throw result;

		await new Promise<void>((resolve) => {
			result.child.on("exit", () => resolve());
		});

		result.cleanup();

		expect(() => controller.abort()).not.toThrow();
	});
});
