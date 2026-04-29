import { afterEach, beforeEach, describe, expect, it } from "vitest";

let matchGlob: (pattern: string, target: string) => boolean;
let matchesAnyGlob: (globs: string[], filePath: string) => boolean;

try {
	const mod = await import("../../src/rules-engine/matcher.js");
	matchGlob = mod.matchGlob;
	matchesAnyGlob = mod.matchesAnyGlob;
} catch {
	matchGlob = () => {
		throw new Error("not implemented yet");
	};
	matchesAnyGlob = () => {
		throw new Error("not implemented yet");
	};
}

describe("RulesEngine/Matcher: glob pattern matching", () => {
	describe("matchGlob: basic patterns", () => {
		it("should match exact file path", () => {
			expect(matchGlob("src/index.ts", "src/index.ts")).toBe(true);
		});

		it("should not match different file path", () => {
			expect(matchGlob("src/index.ts", "src/other.ts")).toBe(false);
		});

		it("should match single * wildcard in filename", () => {
			expect(matchGlob("src/*.ts", "src/index.ts")).toBe(true);
		});

		it("should not match single * across directory boundary", () => {
			expect(matchGlob("src/*.ts", "src/sub/index.ts")).toBe(false);
		});

		it("should match ? single character", () => {
			expect(matchGlob("file?.ts", "file1.ts")).toBe(true);
		});

		it("should not match ? against no character", () => {
			expect(matchGlob("file?.ts", "file.ts")).toBe(false);
		});
	});

	describe("matchGlob: ** doublestar patterns", () => {
		it("should match ** across multiple directory levels", () => {
			expect(matchGlob("src/**/*.ts", "src/deep/nested/file.ts")).toBe(true);
		});

		it("should match ** with zero intermediate directories", () => {
			expect(matchGlob("src/**/*.ts", "src/file.ts")).toBe(true);
		});

		it("should match ** at start of pattern", () => {
			expect(matchGlob("**/*.ts", "a/b/c/file.ts")).toBe(true);
		});

		it("should match ** alone matches everything", () => {
			expect(matchGlob("**", "any/path/file.txt")).toBe(true);
		});

		it("should match ** at end of pattern", () => {
			expect(matchGlob("src/**", "src/a/b/c")).toBe(true);
		});
	});

	describe("matchGlob: brace expansion {a,b}", () => {
		it("should match {ts,tsx} brace expansion", () => {
			expect(matchGlob("src/*.{ts,tsx}", "src/component.tsx")).toBe(true);
		});

		it("should match first option in brace expansion", () => {
			expect(matchGlob("src/*.{ts,tsx}", "src/index.ts")).toBe(true);
		});

		it("should not match outside brace expansion options", () => {
			expect(matchGlob("src/*.{ts,tsx}", "src/style.css")).toBe(false);
		});
	});

	describe("matchGlob: path normalization", () => {
		it("should normalize backslashes to forward slashes", () => {
			expect(matchGlob("src/**/*.ts", "src\\deep\\file.ts")).toBe(true);
		});
	});

	describe("matchGlob: edge cases", () => {
		it("should return false for empty pattern and non-empty target", () => {
			expect(matchGlob("", "file.ts")).toBe(false);
		});

		it("should return false for non-empty pattern and empty target", () => {
			expect(matchGlob("*.ts", "")).toBe(false);
		});

		it("should handle dot files correctly", () => {
			expect(matchGlob(".*", ".gitignore")).toBe(true);
		});

		it("should match file in nested dot directory", () => {
			expect(matchGlob(".claude/rules/**", ".claude/rules/my-rule.md")).toBe(true);
		});
	});

	describe("matchesAnyGlob: multiple patterns", () => {
		it("should return true when at least one glob matches", () => {
			expect(matchesAnyGlob(["*.ts", "*.js"], "index.ts")).toBe(true);
		});

		it("should return true when second glob matches", () => {
			expect(matchesAnyGlob(["*.ts", "*.js"], "index.js")).toBe(true);
		});

		it("should return false when no globs match", () => {
			expect(matchesAnyGlob(["*.ts", "*.js"], "style.css")).toBe(false);
		});

		it("should return false for empty globs array", () => {
			expect(matchesAnyGlob([], "file.ts")).toBe(false);
		});

		it("should return false for undefined file path", () => {
			expect(matchesAnyGlob(["*.ts"], "")).toBe(false);
		});

		it("should handle complex multi-pattern scenarios", () => {
			const globs = ["src/**/*.ts", "test/**/*.test.ts", "*.config.js"];
			expect(matchesAnyGlob(globs, "src/core/module.ts")).toBe(true);
			expect(matchesAnyGlob(globs, "test/unit/module.test.ts")).toBe(true);
			expect(matchesAnyGlob(globs, "vitest.config.js")).toBe(true);
			expect(matchesAnyGlob(globs, "README.md")).toBe(false);
		});
	});
});
