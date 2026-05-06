import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WriteOperations } from "../../src/core/tools/write.js";
import { createWriteToolDefinition } from "../../src/core/tools/write.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-write-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

function createWriteToolWithOps(cwd: string, ops: Partial<WriteOperations>) {
	const fullOps: WriteOperations = {
		writeFile: ops.writeFile ?? ((p, c) => writeFile(p, c, "utf-8")),
		mkdir:
			ops.mkdir ??
			((d) => {
				const { mkdirSync } = require("node:fs");
				mkdirSync(d, { recursive: true });
				return Promise.resolve();
			}),
		...ops,
	};
	return createWriteToolDefinition(cwd, { operations: fullOps });
}

describe("write tool", () => {
	let tempDir: string;
	let tool: ReturnType<typeof createWriteToolDefinition>;

	beforeEach(() => {
		tempDir = createTempDir();
		tool = createWriteToolDefinition(tempDir);
	});

	function execute(args: { path: string; content: string }, signal?: AbortSignal) {
		return tool.execute("test-call", args, signal);
	}

	describe("creating new files", () => {
		it("writes content to a new file", async () => {
			const filePath = join(tempDir, "new.txt");
			await execute({ path: filePath, content: "hello world" });

			const content = await readFile(filePath, "utf-8");
			expect(content).toBe("hello world");
		});

		it("reports byte count in success message", async () => {
			const result = await execute({ path: join(tempDir, "bytes.txt"), content: "hello" });
			expect(result.content[0].text).toContain("5 bytes");
		});

		it("returns undefined details on success", async () => {
			const result = await execute({ path: join(tempDir, "detail.txt"), content: "data" });
			expect(result.details).toBeUndefined();
		});
	});

	describe("overwriting existing files", () => {
		it("overwrites existing file content", async () => {
			const filePath = join(tempDir, "overwrite.txt");
			writeFileSync(filePath, "old content", "utf-8");

			await execute({ path: filePath, content: "new content" });

			const content = await readFile(filePath, "utf-8");
			expect(content).toBe("new content");
		});

		it("can overwrite with empty content", async () => {
			const filePath = join(tempDir, "empty.txt");
			writeFileSync(filePath, "has content", "utf-8");

			await execute({ path: filePath, content: "" });

			const content = await readFile(filePath, "utf-8");
			expect(content).toBe("");
		});
	});

	describe("creating directories", () => {
		it("creates parent directories automatically", async () => {
			const filePath = join(tempDir, "a", "b", "c", "deep.txt");
			await execute({ path: filePath, content: "nested" });

			expect(existsSync(filePath)).toBe(true);
			const content = await readFile(filePath, "utf-8");
			expect(content).toBe("nested");
		});

		it("creates single parent directory", async () => {
			const filePath = join(tempDir, "subdir", "file.txt");
			await execute({ path: filePath, content: "in subdir" });

			expect(existsSync(filePath)).toBe(true);
		});
	});

	describe("relative paths", () => {
		it("resolves relative path against cwd", async () => {
			const result = await execute({ path: "relative.txt", content: "relative content" });
			expect(existsSync(join(tempDir, "relative.txt"))).toBe(true);
			expect(result.content[0].text).toContain("relative.txt");
		});
	});

	describe("custom operations", () => {
		it("delegates to custom writeFile", async () => {
			let writtenPath: string | undefined;
			let writtenContent: string | undefined;
			const tool = createWriteToolWithOps(tempDir, {
				writeFile: (p, c) => {
					writtenPath = p;
					writtenContent = c;
					return Promise.resolve();
				},
				mkdir: () => Promise.resolve(),
			});

			await tool.execute("test-call", { path: "custom.txt", content: "custom data" });
			expect(writtenContent).toBe("custom data");
			expect(writtenPath).toBe(join(tempDir, "custom.txt"));
		});

		it("delegates to custom mkdir", async () => {
			let mkdirCalled = false;
			const tool = createWriteToolWithOps(tempDir, {
				writeFile: () => Promise.resolve(),
				mkdir: (dir) => {
					mkdirCalled = true;
					expect(dir).toBe(join(tempDir, "sub"));
					return Promise.resolve();
				},
			});

			await tool.execute("test-call", { path: join(tempDir, "sub", "file.txt"), content: "data" });
			expect(mkdirCalled).toBe(true);
		});

		it("rejects when mkdir fails", async () => {
			const tool = createWriteToolWithOps(tempDir, {
				writeFile: () => Promise.resolve(),
				mkdir: () => Promise.reject(new Error("disk full")),
			});

			await expect(tool.execute("test-call", { path: "fail.txt", content: "data" })).rejects.toThrow("disk full");
		});

		it("rejects when writeFile fails", async () => {
			const tool = createWriteToolWithOps(tempDir, {
				writeFile: () => Promise.reject(new Error("write error")),
				mkdir: () => Promise.resolve(),
			});

			await expect(tool.execute("test-call", { path: "fail.txt", content: "data" })).rejects.toThrow("write error");
		});
	});

	describe("abort signal", () => {
		it("rejects immediately if already aborted", async () => {
			const controller = new AbortController();
			controller.abort();
			await expect(execute({ path: "abort.txt", content: "data" }, controller.signal)).rejects.toThrow(
				"Operation aborted",
			);
		});
	});

	describe("tool metadata", () => {
		it("has correct name", () => {
			expect(tool.name).toBe("write");
		});

		it("has description mentioning overwrite behavior", () => {
			expect(tool.description).toContain("overwrites");
			expect(tool.description).toContain("directories");
		});

		it("has parameters schema", () => {
			expect(tool.parameters).toBeDefined();
		});
	});

	describe("multibyte content", () => {
		it("reports byte count for UTF-8 content correctly", async () => {
			const result = await execute({ path: join(tempDir, "utf8.txt"), content: "hello" });
			expect(result.content[0].text).toContain("5 bytes");
		});

		it("writes multibyte characters correctly", async () => {
			const filePath = join(tempDir, "cjk.txt");
			await execute({ path: filePath, content: "你好世界" });

			const content = await readFile(filePath, "utf-8");
			expect(content).toBe("你好世界");
		});
	});
});
