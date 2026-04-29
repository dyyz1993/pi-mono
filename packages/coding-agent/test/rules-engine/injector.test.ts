import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParsedRule } from "../../src/rules-engine/types.js";

let buildSystemPromptSection: (rules: ParsedRule[], sources: string[]) => string;
let buildToolContextSection: (rules: ParsedRule[], targetPath: string) => string;
let buildCompactContext: (rules: ParsedRule[]) => string;

function createMockRule(overrides: Partial<ParsedRule> = {}): ParsedRule {
	return {
		name: "test-rule",
		filePath: "/test/rule.md",
		title: "Test Rule",
		content: "This is a test rule body.",
		scope: "project",
		source: ".claude/rules",
		frontmatter: { paths: [], severity: "medium" },
		isUnconditional: true,
		...overrides,
	};
}

try {
	const mod = await import("../../src/rules-engine/injector.js");
	buildSystemPromptSection = mod.buildSystemPromptSection;
	buildToolContextSection = mod.buildToolContextSection;
	buildCompactContext = mod.buildCompactContext;
} catch {
	buildSystemPromptSection = () => {
		throw new Error("not implemented yet");
	};
	buildToolContextSection = () => {
		throw new Error("not implemented yet");
	};
	buildCompactContext = () => {
		throw new Error("not implemented yet");
	};
}

describe("RulesEngine/Injector: system prompt section", () => {
	describe("buildSystemPromptSection: unconditional rules", () => {
		it("should format a single unconditional rule", () => {
			const rules = [createMockRule({ name: "global-rule", title: "Global Rule", content: "Always do X." })];
			const result = buildSystemPromptSection(rules, [".claude/rules"]);
			expect(result).toContain("Global Rule");
			expect(result).toContain("Always do X.");
			expect(result).toContain(".claude/rules");
		});

		it("should format multiple unconditional rules", () => {
			const rules = [
				createMockRule({ name: "rule-a", title: "Rule A", content: "Content A" }),
				createMockRule({ name: "rule-b", title: "Rule B", content: "Content B" }),
			];
			const result = buildSystemPromptSection(rules, [".claude/rules"]);
			expect(result).toContain("Rule A");
			expect(result).toContain("Content A");
			expect(result).toContain("Rule B");
			expect(result).toContain("Content B");
		});

		it("should include description when present", () => {
			const rules = [
				createMockRule({
					name: "desc-rule",
					title: "Described Rule",
					content: "Body",
					frontmatter: { description: "A described rule", severity: "medium" },
				}),
			];
			const result = buildSystemPromptSection(rules, [".claude/rules"]);
			expect(result).toContain("A described rule");
		});

		it("should return empty string for empty rules array", () => {
			const result = buildSystemPromptSection([], []);
			expect(result).toBe("");
		});
	});
});

describe("RulesEngine/Injector: tool context section", () => {
	describe("buildToolContextSection: conditional rules", () => {
		it("should format matching rules with target path", () => {
			const rules = [
				createMockRule({
					name: "ts-rule",
					title: "TypeScript Rule",
					content: "Use strict mode.",
					frontmatter: { paths: ["src/**/*.ts"], severity: "high" },
					isUnconditional: false,
				}),
			];
			const result = buildToolContextSection(rules, "src/index.ts");
			expect(result).toContain("TypeScript Rule");
			expect(result).toContain("Use strict mode.");
			expect(result).toContain("src/index.ts");
		});

		it("should include severity icon for critical rules", () => {
			const rules = [
				createMockRule({
					name: "critical-rule",
					title: "Critical Rule",
					content: "Never do X.",
					frontmatter: { paths: ["**/*"], severity: "critical" },
					isUnconditional: false,
				}),
			];
			const result = buildToolContextSection(rules, "any-file.ts");
			expect(result).toContain("Critical Rule");
			expect(result).toContain("[critical]");
		});

		it("should return empty string for empty rules array", () => {
			const result = buildToolContextSection([], "file.ts");
			expect(result).toBe("");
		});
	});
});

describe("RulesEngine/Injector: compact context", () => {
	describe("buildCompactContext: rules for compaction", () => {
		it("should format unconditional rules for compaction", () => {
			const rules = [
				createMockRule({ name: "r1", title: "Rule One", content: "Body one" }),
				createMockRule({ name: "r2", title: "Rule Two", content: "Body two" }),
			];
			const result = buildCompactContext(rules);
			expect(result).toContain("Rule One");
			expect(result).toContain("Rule Two");
		});

		it("should include description in compact output when available", () => {
			const rules = [
				createMockRule({
					name: "desc",
					title: "Described",
					content: "Body",
					frontmatter: { description: "Short desc", severity: "medium" },
				}),
			];
			const result = buildCompactContext(rules);
			expect(result).toContain("Short desc");
		});

		it("should use first content line when no description", () => {
			const rules = [
				createMockRule({
					name: "nodesc",
					title: "No Desc",
					content: "First line of body\nSecond line",
					frontmatter: { severity: "medium" },
				}),
			];
			const result = buildCompactContext(rules);
			expect(result).toContain("No Desc");
		});

		it("should return empty string for empty rules", () => {
			const result = buildCompactContext([]);
			expect(result).toBe("");
		});
	});
});

describe("RulesEngine/Injector: idempotency", () => {
	it("should produce identical output for same input on repeated calls", () => {
		const rules = [createMockRule({ name: "r1", title: "Rule", content: "Body" })];
		const result1 = buildSystemPromptSection(rules, [".claude/rules"]);
		const result2 = buildSystemPromptSection(rules, [".claude/rules"]);
		expect(result1).toBe(result2);
	});
});
