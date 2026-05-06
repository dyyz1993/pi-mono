import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReadOperations } from "../../src/core/tools/read.js";
import { createReadToolDefinition } from "../../src/core/tools/read.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-read-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

function createReadToolWithOps(cwd: string, ops: Partial<ReadOperations>) {
	const fullOps: ReadOperations = {
		readFile: ops.readFile ?? (() => Promise.resolve(Buffer.from(""))),
		access: ops.access ?? (() => Promise.resolve()),
		detectImageMimeType: ops.detectImageMimeType ?? (() => Promise.resolve(null)),
		...ops,
	};
	return createReadToolDefinition(cwd, { operations: fullOps, autoResizeImages: false });
}

describe("read tool", () => {
	describe("reading text files", () => {
		let tempDir: string;
		let tool: ReturnType<typeof createReadToolDefinition>;

		beforeEach(() => {
			tempDir = createTempDir();
			tool = createReadToolDefinition(tempDir, { autoResizeImages: false });
		});

		function execute(args: { path: string; offset?: number; limit?: number }) {
			return tool.execute("test-call", args);
		}

		it("reads entire file content", async () => {
			writeFileSync(join(tempDir, "test.txt"), "line 1\nline 2\nline 3\n");
			const result = await execute({ path: "test.txt" });
			const text = result.content[0].text;
			expect(text).toContain("line 1");
			expect(text).toContain("line 2");
			expect(text).toContain("line 3");
		});

		it("reads file with offset (1-indexed)", async () => {
			writeFileSync(join(tempDir, "offset.txt"), "line 1\nline 2\nline 3\nline 4\nline 5\n");
			const result = await execute({ path: "offset.txt", offset: 3 });
			const text = result.content[0].text;
			expect(text).toContain("line 3");
			expect(text).toContain("line 4");
			expect(text).toContain("line 5");
			expect(text).not.toContain("line 1");
			expect(text).not.toContain("line 2");
		});

		it("reads file with limit", async () => {
			writeFileSync(join(tempDir, "limit.txt"), "line 1\nline 2\nline 3\nline 4\nline 5\n");
			const result = await execute({ path: "limit.txt", limit: 2 });
			const text = result.content[0].text;
			expect(text).toContain("line 1");
			expect(text).toContain("line 2");
			expect(text).not.toContain("line 3");
		});

		it("reads file with offset and limit combined", async () => {
			writeFileSync(join(tempDir, "both.txt"), "line 1\nline 2\nline 3\nline 4\nline 5\n");
			const result = await execute({ path: "both.txt", offset: 2, limit: 2 });
			const text = result.content[0].text;
			expect(text).toContain("line 2");
			expect(text).toContain("line 3");
			expect(text).not.toContain("line 1");
			expect(text).not.toContain("line 4");
		});

		it("shows continuation notice when user limit stops early", async () => {
			writeFileSync(join(tempDir, "continue.txt"), "line 1\nline 2\nline 3\nline 4\n");
			const result = await execute({ path: "continue.txt", limit: 2 });
			const text = result.content[0].text;
			expect(text).toContain("more lines in file");
			expect(text).toContain("offset=3");
		});

		it("throws on offset beyond file length", async () => {
			writeFileSync(join(tempDir, "short.txt"), "only one line\n");
			await expect(execute({ path: "short.txt", offset: 999 })).rejects.toThrow("Offset 999 is beyond end of file");
		});

		it("returns text content type", async () => {
			writeFileSync(join(tempDir, "test.txt"), "content\n");
			const result = await execute({ path: "test.txt" });
			expect(result.content[0].type).toBe("text");
		});
	});

	describe("non-existent file", () => {
		it("rejects for missing file", async () => {
			const tool = createReadToolDefinition(tmpdir(), { autoResizeImages: false });
			await expect(tool.execute("test-call", { path: "nonexistent-file-xyz.txt" })).rejects.toThrow();
		});
	});

	describe("binary file detection", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = createTempDir();
		});

		it("detects image files via mime type", async () => {
			writeFileSync(join(tempDir, "photo.png"), "fake png data");

			const ops: Partial<ReadOperations> = {
				readFile: () => Promise.resolve(Buffer.from("fake png data")),
				access: () => Promise.resolve(),
				detectImageMimeType: () => Promise.resolve("image/png"),
			};
			const tool = createReadToolWithOps(tempDir, ops);
			const result = await tool.execute("test-call", { path: "photo.png" });

			const textContent = result.content.find((c) => c.type === "text");
			expect(textContent?.text).toContain("image/png");
			const imageContent = result.content.find((c) => c.type === "image");
			expect(imageContent).toBeDefined();
		});

		it("returns text content for non-image files", async () => {
			writeFileSync(join(tempDir, "data.txt"), "plain text");

			const ops: Partial<ReadOperations> = {
				readFile: () => Promise.resolve(Buffer.from("plain text")),
				access: () => Promise.resolve(),
				detectImageMimeType: () => Promise.resolve(null),
			};
			const tool = createReadToolWithOps(tempDir, ops);
			const result = await tool.execute("test-call", { path: "data.txt" });

			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");
			expect((result.content[0] as { text: string }).text).toContain("plain text");
		});
	});

	describe("custom operations", () => {
		it("delegates to custom readFile", async () => {
			const tool = createReadToolWithOps(tmpdir(), {
				readFile: () => Promise.resolve(Buffer.from("custom content\n")),
				access: () => Promise.resolve(),
				detectImageMimeType: () => Promise.resolve(null),
			});
			const result = await tool.execute("test-call", { path: "anything.txt" });
			expect(result.content[0].text).toContain("custom content");
		});

		it("delegates to custom access for permission check", async () => {
			let accessCalled = false;
			const tool = createReadToolWithOps(tmpdir(), {
				readFile: () => Promise.resolve(Buffer.from("data\n")),
				access: () => {
					accessCalled = true;
					return Promise.resolve();
				},
				detectImageMimeType: () => Promise.resolve(null),
			});
			await tool.execute("test-call", { path: "file.txt" });
			expect(accessCalled).toBe(true);
		});

		it("rejects when custom access throws", async () => {
			const tool = createReadToolWithOps(tmpdir(), {
				readFile: () => Promise.resolve(Buffer.from("")),
				access: () => Promise.reject(new Error("Permission denied")),
				detectImageMimeType: () => Promise.resolve(null),
			});
			await expect(tool.execute("test-call", { path: "secret.txt" })).rejects.toThrow("Permission denied");
		});
	});

	describe("tool metadata", () => {
		it("has correct name", () => {
			const tool = createReadToolDefinition(tmpdir());
			expect(tool.name).toBe("read");
		});

		it("has description mentioning offset and limit", () => {
			const tool = createReadToolDefinition(tmpdir());
			expect(tool.description).toContain("offset");
			expect(tool.description).toContain("limit");
		});

		it("has parameters schema", () => {
			const tool = createReadToolDefinition(tmpdir());
			expect(tool.parameters).toBeDefined();
		});
	});

	describe("abort signal", () => {
		it("rejects immediately if already aborted", async () => {
			const tool = createReadToolDefinition(tmpdir(), { autoResizeImages: false });
			const controller = new AbortController();
			controller.abort();
			await expect(tool.execute("test-call", { path: "test.txt" }, controller.signal)).rejects.toThrow(
				"Operation aborted",
			);
		});
	});

	describe("truncation details", () => {
		it("returns undefined details for small files", async () => {
			const tempDir = createTempDir();
			writeFileSync(join(tempDir, "small.txt"), "small\n");
			const tool = createReadToolDefinition(tempDir, { autoResizeImages: false });
			const result = await tool.execute("test-call", { path: "small.txt" });
			expect(result.details).toBeUndefined();
		});

		it("includes truncation details for large files", async () => {
			const tempDir = createTempDir();
			const manyLines = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
			writeFileSync(join(tempDir, "big.txt"), manyLines);
			const tool = createReadToolDefinition(tempDir, { autoResizeImages: false });
			const result = await tool.execute("test-call", { path: "big.txt" });
			expect(result.details?.truncation?.truncated).toBe(true);
		});
	});
});
