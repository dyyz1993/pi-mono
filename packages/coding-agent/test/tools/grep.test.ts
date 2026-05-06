import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGrepToolDefinition } from "../../src/core/tools/grep.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-grep-test-"));
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

describe("grep tool", () => {
	let tempDir: string;
	let tool: ReturnType<typeof createGrepToolDefinition>;

	beforeEach(() => {
		tempDir = createTempDir();
		tool = createGrepToolDefinition(tempDir);
	});

	function execute(args: {
		pattern: string;
		path?: string;
		glob?: string;
		ignoreCase?: boolean;
		literal?: boolean;
		context?: number;
		limit?: number;
	}) {
		return tool.execute("test-call", args);
	}

	describe("basic pattern matching", () => {
		beforeEach(() => {
			writeFileSync(join(tempDir, "hello.txt"), "hello world\nfoo bar\nhello again\n");
			writeFileSync(join(tempDir, "other.txt"), "no match here\n");
		});

		it("finds matches in directory", async () => {
			const result = await execute({ pattern: "hello" });
			const text = result.content[0].text;
			expect(text).toContain("hello.txt");
			expect(text).toContain("hello world");
			expect(text).toContain("hello again");
			expect(text).not.toContain("No matches found");
		});

		it("returns No matches found for unmatched pattern", async () => {
			const result = await execute({ pattern: "zzzznonexistent" });
			expect(result.content[0].text).toBe("No matches found");
		});

		it("searches specific file", async () => {
			const result = await execute({ pattern: "hello", path: join(tempDir, "hello.txt") });
			const text = result.content[0].text;
			expect(text).toContain("hello world");
			expect(text).not.toContain("other.txt");
		});

		it("respects ignoreCase option", async () => {
			writeFileSync(join(tempDir, "case.txt"), "Hello World\n");
			const result = await execute({ pattern: "hello", ignoreCase: true });
			expect(result.content[0].text).toContain("Hello World");
		});

		it("respects case without ignoreCase", async () => {
			writeFileSync(join(tempDir, "case.txt"), "Hello World\nhello world\n");
			const result = await execute({ pattern: "hello", ignoreCase: false });
			const text = result.content[0].text;
			expect(text).toContain("hello world");
			expect(text).not.toContain("Hello World");
		});
	});

	describe("literal search", () => {
		it("treats pattern as literal string when literal=true", async () => {
			writeFileSync(join(tempDir, "regex.txt"), "file.txt\nfile[0].txt\n");
			const result = await execute({ pattern: "file.txt", literal: true });
			const text = result.content[0].text;
			expect(text).toContain("file.txt");
		});
	});

	describe("glob filter", () => {
		beforeEach(() => {
			writeFileSync(join(tempDir, "app.ts"), "const x = 1;\n");
			writeFileSync(join(tempDir, "app.js"), "const y = 2;\n");
		});

		it("filters by glob pattern", async () => {
			const result = await execute({ pattern: "const", glob: "*.ts" });
			const text = result.content[0].text;
			expect(text).toContain("app.ts");
			expect(text).not.toContain("app.js");
		});
	});

	describe("limit option", () => {
		it("respects match limit", async () => {
			const lines = Array.from({ length: 20 }, (_, i) => `match line ${i}`).join("\n");
			writeFileSync(join(tempDir, "many.txt"), `${lines}\n`);

			const result = await execute({ pattern: "match line", limit: 3 });
			const text = result.content[0].text;
			const matchCount = text.split("\n").filter((l: string) => l.includes("match line")).length;
			expect(matchCount).toBe(3);
			expect(result.details?.matchLimitReached).toBe(3);
		});
	});

	describe("context option", () => {
		it("shows context lines around match", async () => {
			writeFileSync(join(tempDir, "ctx.txt"), "line 1\nline 2\nTARGET\nline 4\nline 5\n");
			const result = await execute({ pattern: "TARGET", context: 1 });
			const text = result.content[0].text;
			expect(text).toContain("line 2");
			expect(text).toContain("TARGET");
			expect(text).toContain("line 4");
		});
	});

	describe("invalid path", () => {
		it("rejects non-existent path", async () => {
			await expect(execute({ pattern: "test", path: "/nonexistent/path/xyz" })).rejects.toThrow("Path not found");
		});
	});

	describe("tool metadata", () => {
		it("has correct name", () => {
			expect(tool.name).toBe("grep");
		});

		it("has description mentioning pattern search", () => {
			expect(tool.description).toContain("pattern");
		});

		it("has parameters schema", () => {
			expect(tool.parameters).toBeDefined();
		});
	});

	describe("result details", () => {
		it("returns undefined details when no truncation", async () => {
			writeFileSync(join(tempDir, "simple.txt"), "hello\n");
			const result = await execute({ pattern: "hello" });
			expect(result.details).toBeUndefined();
		});
	});

	describe("nested directory search", () => {
		it("searches subdirectories", async () => {
			const subDir = join(tempDir, "sub");
			mkdirSync(subDir, { recursive: true });
			writeFileSync(join(subDir, "nested.txt"), "find me\n");

			const result = await execute({ pattern: "find me" });
			expect(result.content[0].text).toContain("find me");
			expect(result.content[0].text).toContain("nested.txt");
		});

		it("shows relative paths for directory searches", async () => {
			const subDir = join(tempDir, "sub");
			mkdirSync(subDir, { recursive: true });
			writeFileSync(join(subDir, "nested.txt"), "find me\n");

			const result = await execute({ pattern: "find me" });
			expect(result.content[0].text).toContain("sub/nested.txt");
		});
	});
});
