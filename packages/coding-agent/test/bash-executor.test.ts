import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeBashWithOperations } from "../src/core/bash-executor.js";
import type { BashOperations } from "../src/core/tools/bash.js";

function createMockOperations(overrides?: Partial<BashOperations>): BashOperations {
	return {
		async exec(_command, _cwd, _options) {
			return { exitCode: 0 };
		},
		...overrides,
	};
}

function createRecordingMock(): {
	operations: BashOperations;
	calls: Array<{ command: string; cwd: string }>;
} {
	const calls: Array<{ command: string; cwd: string }> = [];
	const operations: BashOperations = {
		async exec(command, cwd, _options) {
			calls.push({ command, cwd });
			return { exitCode: 0 };
		},
	};
	return { operations, calls };
}

function createStreamingMock(chunks: string[], exitCode: number | null = 0): BashOperations {
	return {
		async exec(_command, _cwd, options) {
			const encoder = new TextEncoder();
			for (const chunk of chunks) {
				options.onData(encoder.encode(chunk));
			}
			return { exitCode };
		},
	};
}

describe("executeBashWithOperations", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const d of tempDirs.splice(0)) {
			try {
				if (existsSync(d)) rmSync(d, { recursive: true });
			} catch {}
		}
	});

	function makeTempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "pi-bash-test-"));
		tempDirs.push(dir);
		return dir;
	}

	it("returns output from operations", async () => {
		const ops = createStreamingMock(["hello ", "world"]);
		const result = await executeBashWithOperations("echo hello", "/tmp", ops);
		expect(result.output).toBe("hello world");
		expect(result.exitCode).toBe(0);
		expect(result.cancelled).toBe(false);
		expect(result.truncated).toBe(false);
	});

	it("passes command and cwd to operations", async () => {
		const { operations, calls } = createRecordingMock();
		const cwd = makeTempDir();
		await executeBashWithOperations("ls", cwd, operations);
		expect(calls).toHaveLength(1);
		expect(calls[0].command).toBe("ls");
		expect(calls[0].cwd).toBe(cwd);
	});

	it("captures non-zero exit code", async () => {
		const ops = createStreamingMock(["error occurred\n"], 1);
		const result = await executeBashWithOperations("false", "/tmp", ops);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("error occurred");
	});

	it("returns exitCode undefined when cancelled via signal", async () => {
		const controller = new AbortController();
		const ops: BashOperations = {
			async exec(_command, _cwd, _options) {
				controller.abort();
				throw new DOMException("Aborted", "AbortError");
			},
		};
		const result = await executeBashWithOperations("sleep 999", "/tmp", ops, {
			signal: controller.signal,
		});
		expect(result.cancelled).toBe(true);
		expect(result.exitCode).toBeUndefined();
	});

	it("returns cancelled=true when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const ops = createStreamingMock(["partial output"]);
		const result = await executeBashWithOperations("echo test", "/tmp", ops, {
			signal: controller.signal,
		});
		expect(result.cancelled).toBe(true);
		expect(result.exitCode).toBeUndefined();
	});

	it("strips ANSI escape codes from output", async () => {
		const ops = createStreamingMock(["\x1b[31mred text\x1b[0m"]);
		const result = await executeBashWithOperations("echo red", "/tmp", ops);
		expect(result.output).toBe("red text");
	});

	it("sanitizes binary/control characters from output", async () => {
		const ops = createStreamingMock(["clean\x00\x01\x02text"]);
		const result = await executeBashWithOperations("echo test", "/tmp", ops);
		expect(result.output).toBe("cleantext");
	});

	it("normalizes carriage returns", async () => {
		const ops = createStreamingMock(["line1\r\nline2\r"]);
		const result = await executeBashWithOperations("echo test", "/tmp", ops);
		expect(result.output).toBe("line1\nline2");
	});

	it("streams chunks via onChunk callback", async () => {
		const chunks: string[] = [];
		const ops = createStreamingMock(["chunk1", "chunk2"]);
		await executeBashWithOperations("echo test", "/tmp", ops, {
			onChunk: (chunk) => chunks.push(chunk),
		});
		expect(chunks).toEqual(["chunk1", "chunk2"]);
	});

	it("rethrows non-abort errors", async () => {
		const ops: BashOperations = {
			async exec() {
				throw new Error("Connection refused");
			},
		};
		await expect(executeBashWithOperations("echo test", "/tmp", ops)).rejects.toThrow("Connection refused");
	});

	it("returns empty output when no data", async () => {
		const ops = createStreamingMock([]);
		const result = await executeBashWithOperations("true", "/tmp", ops);
		expect(result.output).toBe("");
		expect(result.exitCode).toBe(0);
	});

	it("handles large output without truncation by default", async () => {
		const bigChunk = "x".repeat(1000);
		const ops = createStreamingMock([bigChunk]);
		const result = await executeBashWithOperations("echo big", "/tmp", ops);
		expect(result.output).toHaveLength(1000);
		expect(result.truncated).toBe(false);
	});
});
