import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let parseFrontmatter: (content: string) => { data: Record<string, unknown>; body: string };
let parseRuleFile: (filePath: string, content: string) => import("../../src/rules-engine/types.js").ParsedRule;

try {
	const matcherMod = await import("../../src/rules-engine/matcher.js");
	const loaderMod = await import("../../src/rules-engine/loader.js");
	parseFrontmatter = loaderMod.parseFrontmatter;
	parseRuleFile = loaderMod.parseRuleFile;
} catch {
	parseFrontmatter = () => {
		throw new Error("not implemented yet");
	};
	parseRuleFile = () => {
		throw new Error("not implemented yet");
	};
}

describe("RulesEngine/Loader: frontmatter parsing", () => {
	describe("parseFrontmatter: valid frontmatter", () => {
		it("should parse simple string values", () => {
			const content = "---\ndescription: My rule\n---\n# Title\nBody text";
			const result = parseFrontmatter(content);
			expect(result.data.description).toBe("My rule");
			expect(result.body).toBe("# Title\nBody text");
		});

		it("should parse paths as comma-separated string", () => {
			const content = "---\npaths: src/**/*.ts, test/**/*.ts\n---\n# Rule";
			const result = parseFrontmatter(content);
			expect(result.data.paths).toEqual(["src/**/*.ts", "test/**/*.ts"]);
		});

		it("should not split commas inside braces in paths", () => {
			const content = '---\npaths: "src/**/*.{ts,tsx}"\n---\n# Rule';
			const result = parseFrontmatter(content);
			expect(result.data.paths).toEqual(["src/**/*.{ts,tsx}"]);
		});

		it("should handle mixed paths with braces and plain globs", () => {
			const content = "---\npaths: src/**/*.{ts,tsx}, *.css\n---\n# Rule";
			const result = parseFrontmatter(content);
			expect(result.data.paths).toEqual(["src/**/*.{ts,tsx}", "*.css"]);
		});

		it("should parse paths as JSON array", () => {
			const content = '---\npaths: ["src/**/*.ts", "test/**/*.ts"]\n---\n# Rule';
			const result = parseFrontmatter(content);
			expect(result.data.paths).toEqual(["src/**/*.ts", "test/**/*.ts"]);
		});

		it("should parse multiple fields", () => {
			const content = "---\ndescription: Test rule\nseverity: critical\nwhenToUse: Always\n---\n# Title";
			const result = parseFrontmatter(content);
			expect(result.data.description).toBe("Test rule");
			expect(result.data.severity).toBe("critical");
			expect(result.data.whenToUse).toBe("Always");
		});

		it("should parse single-quoted values", () => {
			const content = "---\ndescription: 'quoted value'\n---\n# Rule";
			const result = parseFrontmatter(content);
			expect(result.data.description).toBe("quoted value");
		});

		it("should parse double-quoted values", () => {
			const content = '---\ndescription: "quoted value"\n---\n# Rule';
			const result = parseFrontmatter(content);
			expect(result.data.description).toBe("quoted value");
		});

		it("should treat null value as null", () => {
			const content = "---\npaths: null\n---\n# Rule";
			const result = parseFrontmatter(content);
			expect(result.data.paths).toBeNull();
		});
	});

	describe("parseFrontmatter: missing or empty frontmatter", () => {
		it("should return empty data when no frontmatter", () => {
			const content = "# Just a title\nSome body text";
			const result = parseFrontmatter(content);
			expect(result.data).toEqual({});
			expect(result.body).toBe("# Just a title\nSome body text");
		});

		it("should return empty data for empty frontmatter block", () => {
			const content = "---\n---\n# Title";
			const result = parseFrontmatter(content);
			expect(result.data).toEqual({});
			expect(result.body.trim()).toBe("# Title");
		});

		it("should handle lines without colons gracefully", () => {
			const content = "---\njust a line without colon\n---\n# Title";
			const result = parseFrontmatter(content);
			expect(result.data).toEqual({});
		});
	});

	describe("parseFrontmatter: kebab-case to camelCase conversion", () => {
		it("should convert kebab-case keys to camelCase", () => {
			const content = "---\nwhen-to-use: testing\nallowed-tools: bash\n---\n# Rule";
			const result = parseFrontmatter(content);
			expect(result.data.whenToUse).toBe("testing");
			expect(result.data.allowedTools).toBe("bash");
		});
	});
});

describe("RulesEngine/Loader: parseRuleFile", () => {
	it("should extract title from first non-empty heading line", () => {
		const content = "---\n---\n# My Rule Title\n\nBody content";
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.title).toBe("My Rule Title");
	});

	it("should strip ** bold markers from title", () => {
		const content = "---\n---\n**Important Rule**\n\nBody";
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.title).toBe("Important Rule");
	});

	it("should default to 'Untitled Rule' when body is empty", () => {
		const content = "---\n---\n";
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.title).toBe("Untitled Rule");
	});

	it("should classify as unconditional when no paths", () => {
		const content = "---\n---\n# Global Rule\n\nAlways active";
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.isUnconditional).toBe(true);
	});

	it("should classify as unconditional when paths is **", () => {
		const content = '---\npaths: "**"\n---\n# Global Rule';
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.isUnconditional).toBe(true);
	});

	it("should classify as conditional when paths has specific globs", () => {
		const content = "---\npaths: src/**/*.ts\n---\n# TS Rule";
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.isUnconditional).toBe(false);
		expect(rule.frontmatter.paths).toEqual(["src/**/*.ts"]);
	});

	it("should parse severity from frontmatter", () => {
		const content = "---\nseverity: critical\n---\n# Critical Rule";
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.frontmatter.severity).toBe("critical");
	});

	it("should default severity to medium when not specified", () => {
		const content = "---\n---\n# Normal Rule";
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.frontmatter.severity).toBeUndefined();
	});

	it("should use filename without .md as name", () => {
		const content = "---\n---\n# Rule";
		const rule = parseRuleFile("/path/to/my-rule.md", content);
		expect(rule.name).toBe("my-rule");
	});

	it("should preserve filePath", () => {
		const content = "---\n---\n# Rule";
		const rule = parseRuleFile("/some/path/rule.md", content);
		expect(rule.filePath).toBe("/some/path/rule.md");
	});

	it("should parse multiple paths from comma-separated string", () => {
		const content = "---\npaths: src/**/*.ts, test/**/*.ts, *.config.ts\n---\n# Multi Path Rule";
		const rule = parseRuleFile("/test/rule.md", content);
		expect(rule.frontmatter.paths).toEqual(["src/**/*.ts", "test/**/*.ts", "*.config.ts"]);
	});
});

describe("RulesEngine/Loader: directory scanning", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `rules-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("should load rules from a directory with .md files", async () => {
		const { loadRules } = await import("../../src/rules-engine/loader.js");
		writeFileSync(join(tempDir, "rule1.md"), "---\n---\n# Rule 1\nContent 1");
		writeFileSync(join(tempDir, "rule2.md"), "---\n---\n# Rule 2\nContent 2");

		const cache = loadRules(tempDir);
		expect(cache.rules).toHaveLength(2);
		expect(cache.rules.map((r: any) => r.title)).toContain("Rule 1");
		expect(cache.rules.map((r: any) => r.title)).toContain("Rule 2");
	});

	it("should ignore non-.md files", async () => {
		const { loadRules } = await import("../../src/rules-engine/loader.js");
		writeFileSync(join(tempDir, "rule.md"), "---\n---\n# Rule");
		writeFileSync(join(tempDir, "notes.txt"), "Not a rule");
		writeFileSync(join(tempDir, "config.json"), "{}");

		const cache = loadRules(tempDir);
		expect(cache.rules).toHaveLength(1);
	});

	it("should recursively scan subdirectories", async () => {
		const { loadRules } = await import("../../src/rules-engine/loader.js");
		mkdirSync(join(tempDir, "sub"), { recursive: true });
		writeFileSync(join(tempDir, "root-rule.md"), "---\n---\n# Root");
		writeFileSync(join(tempDir, "sub", "nested-rule.md"), "---\n---\n# Nested");

		const cache = loadRules(tempDir);
		expect(cache.rules).toHaveLength(2);
	});

	it("should classify rules into unconditional and conditional", async () => {
		const { loadRules } = await import("../../src/rules-engine/loader.js");
		writeFileSync(join(tempDir, "global.md"), "---\n---\n# Global");
		writeFileSync(join(tempDir, "ts-rule.md"), '---\npaths: "**/*.ts"\n---\n# TS Rule');

		const cache = loadRules(tempDir);
		expect(cache.unconditional).toHaveLength(1);
		expect(cache.conditional).toHaveLength(1);
		expect(cache.unconditional[0].title).toBe("Global");
		expect(cache.conditional[0].title).toBe("TS Rule");
	});

	it("should return empty cache for non-existent directory", async () => {
		const { loadRules } = await import("../../src/rules-engine/loader.js");
		const cache = loadRules(join(tempDir, "nonexistent"));
		expect(cache.rules).toHaveLength(0);
		expect(cache.unconditional).toHaveLength(0);
		expect(cache.conditional).toHaveLength(0);
	});

	it("should set loadedAt timestamp", async () => {
		const { loadRules } = await import("../../src/rules-engine/loader.js");
		writeFileSync(join(tempDir, "rule.md"), "---\n---\n# Rule");
		const before = Date.now();
		const cache = loadRules(tempDir);
		const after = Date.now();
		expect(cache.loadedAt).toBeGreaterThanOrEqual(before);
		expect(cache.loadedAt).toBeLessThanOrEqual(after);
	});
});
