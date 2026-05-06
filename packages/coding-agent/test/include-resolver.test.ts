import { mkdirSync as mkdir, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveIncludes } from "../src/core/include-resolver.js";

const TMP_DIR = join("/tmp", "include-resolver-test", String(process.pid));

beforeAll(() => {
	mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TMP_DIR, { recursive: true, force: true });
});

function writeTmp(name: string, content: string): string {
	const p = join(TMP_DIR, name);
	writeFileSync(p, content, "utf-8");
	return p;
}

describe("resolveIncludes", () => {
	describe("basic include resolution", () => {
		it("returns content unchanged when no includes present", () => {
			writeTmp("no-include.md", "Hello world\nNo includes here.");
			const result = resolveIncludes("Hello world\nNo includes here.", join(TMP_DIR, "no-include.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toBe("Hello world\nNo includes here.");
			expect(result.diagnostics).toHaveLength(0);
			expect(result.includedPaths).toHaveLength(0);
		});

		it("resolves a single include", () => {
			writeTmp("target.md", "included content");
			writeTmp("source.md", "before <!-- @include target.md --> after");
			const result = resolveIncludes("before <!-- @include target.md --> after", join(TMP_DIR, "source.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toBe("before included content after");
			expect(result.diagnostics).toHaveLength(0);
			expect(result.includedPaths).toHaveLength(1);
		});

		it("resolves multiple includes in same file", () => {
			writeTmp("a.md", "AAA");
			writeTmp("b.md", "BBB");
			writeTmp("multi.md", "X <!-- @include a.md --> Y <!-- @include b.md --> Z");
			const result = resolveIncludes(
				"X <!-- @include a.md --> Y <!-- @include b.md --> Z",
				join(TMP_DIR, "multi.md"),
				{
					cwd: TMP_DIR,
					agentDir: TMP_DIR,
				},
			);
			expect(result.content).toBe("X AAA Y BBB Z");
			expect(result.includedPaths).toHaveLength(2);
		});

		it("resolves nested includes", () => {
			writeTmp("inner.md", "INNER");
			writeTmp("outer.md", "OUT[<!-- @include inner.md -->]");
			writeTmp("root.md", "ROOT<!-- @include outer.md -->END");
			const result = resolveIncludes("ROOT<!-- @include outer.md -->END", join(TMP_DIR, "root.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toBe("ROOTOUT[INNER]END");
		});
	});

	describe("code block protection", () => {
		it("does not resolve includes inside code blocks", () => {
			writeTmp("coded.md", "SHOULD NOT APPEAR");
			const input = "Some text\n\n```\n<!-- @include coded.md -->\n```\n\nMore text";
			writeTmp("codeblock-source.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "codeblock-source.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toContain("<!-- @include coded.md -->");
			expect(result.content).not.toContain("SHOULD NOT APPEAR");
			expect(result.includedPaths).toHaveLength(0);
		});

		it("resolves includes outside code blocks but not inside", () => {
			writeTmp("inside.md", "INSIDE");
			writeTmp("outside.md", "OUTSIDE");
			const input = "before<!-- @include outside.md -->\n```\n<!-- @include inside.md -->\n```\nafter";
			writeTmp("mixed.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "mixed.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toContain("OUTSIDE");
			expect(result.content).toContain("<!-- @include inside.md -->");
			expect(result.content).not.toContain("INSIDE");
		});
	});

	describe("path resolution", () => {
		it("resolves absolute paths", () => {
			const target = writeTmp("abs-target.md", "ABS_CONTENT");
			const input = `<!-- @include ${target} -->`;
			writeTmp("abs-source.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "abs-source.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toBe("ABS_CONTENT");
		});

		it("resolves relative paths from source directory", () => {
			mkdirSync(join(TMP_DIR, "sub"), { recursive: true });
			writeFileSync(join(TMP_DIR, "sub", "nested.md"), "NESTED", "utf-8");
			const input = "<!-- @include nested.md -->";
			writeFileSync(join(TMP_DIR, "sub", "parent.md"), input, "utf-8");
			const result = resolveIncludes(input, join(TMP_DIR, "sub", "parent.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toBe("NESTED");
		});
	});

	describe("circular include detection", () => {
		it("detects circular includes and emits warning", () => {
			writeTmp("circle-a.md", "A<!-- @include circle-b.md -->");
			writeTmp("circle-b.md", "B<!-- @include circle-a.md -->");
			const result = resolveIncludes("<!-- @include circle-a.md -->", join(TMP_DIR, "root.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
			expect(result.diagnostics.some((d) => d.message.includes("circular include"))).toBe(true);
		});

		it("detects self-include", () => {
			writeTmp("self.md", "SELF<!-- @include self.md -->");
			const result = resolveIncludes("<!-- @include self.md -->", join(TMP_DIR, "self-root.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.diagnostics.some((d) => d.message.includes("circular include"))).toBe(true);
		});
	});

	describe("error handling", () => {
		it("warns on missing file", () => {
			const relPath = "nonexistent-xyz-abc.md";
			const input = `<!-- @include ${relPath} -->`;
			writeTmp("missing.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "missing.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toContain("FAILED:");
			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
		});

		it("warns on disallowed file extension", () => {
			const input = "<!-- @include evil.exe -->";
			writeTmp("ext-source.md", input);
			writeTmp("evil.exe", "binary");
			const result = resolveIncludes(input, join(TMP_DIR, "ext-source.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.diagnostics.some((d) => d.message.includes("not allowed"))).toBe(true);
		});

		it("errors on path outside allowed directories", () => {
			const input = "<!-- @include /etc/passwd -->";
			writeTmp("outside.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "outside.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.diagnostics.some((d) => d.type === "error" && d.message.includes("outside allowed"))).toBe(true);
		});

		it("warns when max depth exceeded", () => {
			writeTmp("depth1.md", "D1<!-- @include depth2.md -->");
			writeTmp("depth2.md", "D2<!-- @include depth3.md -->");
			writeTmp("depth3.md", "D3");
			const chain = "<!-- @include depth1.md -->";
			writeTmp("depth-root.md", chain);
			const result = resolveIncludes(chain, join(TMP_DIR, "depth-root.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
				maxDepth: 1,
			});
			expect(result.diagnostics.some((d) => d.message.includes("maximum include depth"))).toBe(true);
		});
	});

	describe("max file size", () => {
		it("warns on file exceeding maxFileSize", () => {
			const bigContent = "x".repeat(1000);
			writeTmp("big.md", bigContent);
			const input = "<!-- @include big.md -->";
			writeTmp("big-source.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "big-source.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
				maxFileSize: 100,
			});
			expect(result.diagnostics.some((d) => d.message.includes("file exceeds max size"))).toBe(true);
		});

		it("warns when total size limit exceeded", () => {
			writeTmp("total1.md", "a".repeat(500));
			writeTmp("total2.md", "b".repeat(500));
			const input = "<!-- @include total1.md --> <!-- @include total2.md -->";
			writeTmp("total-source.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "total-source.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
				maxTotalSize: 700,
			});
			expect(result.diagnostics.some((d) => d.message.includes("total include size"))).toBe(true);
		});
	});

	describe("allowed file extensions", () => {
		it("allows .md files", () => {
			writeTmp("allowed.md", "OK");
			const input = "<!-- @include allowed.md -->";
			writeTmp("ext-md.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "ext-md.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toBe("OK");
		});

		it("allows .ts files", () => {
			writeTmp("code.ts", "export const x = 1;");
			const input = "<!-- @include code.ts -->";
			writeTmp("ext-ts.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "ext-ts.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toBe("export const x = 1;");
		});

		it("allows files without extension", () => {
			writeTmp("Makefile", "all: build");
			const input = "<!-- @include Makefile -->";
			writeTmp("ext-none.md", input);
			const result = resolveIncludes(input, join(TMP_DIR, "ext-none.md"), {
				cwd: TMP_DIR,
				agentDir: TMP_DIR,
			});
			expect(result.content).toBe("all: build");
		});
	});
});
