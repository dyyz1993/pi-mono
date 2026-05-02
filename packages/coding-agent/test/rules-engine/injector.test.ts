import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParsedRule } from "../../extensions/rules-engine/types.js";

let buildSystemReminderSection: (rules: ParsedRule[], sources: string[]) => string;
let buildToolReminderSection: (rules: ParsedRule[], targetPath: string) => string;
let buildCompactContext: (rules: ParsedRule[]) => string;

function createMockRule(overrides: Partial<ParsedRule> = {}): ParsedRule {
	return {
		name: "test-rule",
		filePath: "/test/rule.md",
		title: "Test Rule",
		content: "This is a test rule body.",
		scope: "project",
		source: ".claude/rules",
		frontmatter: { globs: [], severity: "medium" },
		isUnconditional: true,
		...overrides,
	};
}

try {
	const mod = await import("../../extensions/rules-engine/injector.js");
	buildSystemReminderSection = mod.buildSystemReminderSection;
	buildToolReminderSection = mod.buildToolReminderSection;
	buildCompactContext = mod.buildCompactContext;
} catch {
	buildSystemReminderSection = () => {
		throw new Error("not implemented yet");
	};
	buildToolReminderSection = () => {
		throw new Error("not implemented yet");
	};
	buildCompactContext = () => {
		throw new Error("not implemented yet");
	};
}

describe("RulesEngine/Injector: system-reminder format", () => {
	describe("buildSystemReminderSection: unconditional rules", () => {
		it("should wrap content in <system-reminder> tags", () => {
			const rules = [createMockRule({ name: "global-rule", title: "Global Rule", content: "Always do X." })];
			const result = buildSystemReminderSection(rules, [".claude/rules"]);
			expect(result).toContain("<system-reminder>");
			expect(result).toContain("</system-reminder>");
			expect(result).toContain("Global Rule");
			expect(result).toContain("Always do X.");
		});

		it("should include source directory in header", () => {
			const rules = [
				createMockRule({ name: "rule-a", title: "Rule A", content: "Content A" }),
				createMockRule({ name: "rule-b", title: "Rule B", content: "Content B" }),
			];
			const result = buildSystemReminderSection(rules, [".claude/rules", ".opencode/rules"]);
			expect(result).toContain(".claude/rules");
			expect(result).toContain(".opencode/rules");
			expect(result).toContain("Rule A");
			expect(result).toContain("Rule B");
		});

		it("should include description when present", () => {
			const rules = [
				createMockRule({
					name: "desc-rule",
					title: "Described Rule",
					content: "Body",
					frontmatter: { globs: [], description: "A described rule", severity: "medium" },
				}),
			];
			const result = buildSystemReminderSection(rules, [".claude/rules"]);
			expect(result).toContain("A described rule");
		});

		it("should return empty string for empty rules array", () => {
			const result = buildSystemReminderSection([], []);
			expect(result).toBe("");
		});
	});
});

describe("RulesEngine/Injector: tool reminder section", () => {
	describe("buildToolReminderSection: conditional rules", () => {
		it("should wrap matched rules in <system-reminder> tags with target path", () => {
			const rules = [
				createMockRule({
					name: "ts-rule",
					title: "TypeScript Rule",
					content: "Use strict mode.",
					frontmatter: { globs: ["src/**/*.ts"], severity: "high" },
					isUnconditional: false,
				}),
			];
			const result = buildToolReminderSection(rules, "src/index.ts");
			expect(result).toContain("<system-reminder>");
			expect(result).toContain("</system-reminder>");
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
					frontmatter: { globs: ["**/*"], severity: "critical" },
					isUnconditional: false,
				}),
			];
			const result = buildToolReminderSection(rules, "any-file.ts");
			expect(result).toContain("Critical Rule");
			expect(result).toContain("[critical]");
		});

		it("should return empty string for empty rules array", () => {
			const result = buildToolReminderSection([], "file.ts");
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
					frontmatter: { globs: [], description: "Short desc", severity: "medium" },
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
					frontmatter: { globs: [], severity: "medium" },
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

describe("buildSystemReminderSection: alias exports", () => {
	it("buildSystemPromptSection should be an alias for buildSystemReminderSection", async () => {
		const mod = await import("../../extensions/rules-engine/injector.js");
		expect(mod.buildSystemPromptSection).toBe(mod.buildSystemReminderSection);
	});

	it("buildToolContextSection should be an alias for buildToolReminderSection", async () => {
		const mod = await import("../../extensions/rules-engine/injector.js");
		expect(mod.buildToolContextSection).toBe(mod.buildToolReminderSection);
	});
});

describe("buildSystemReminderSection: tag structure", () => {
	it("should start with <system-reminder> and end with </system-reminder>", () => {
		const rules = [createMockRule({ name: "r", title: "R", content: "Body" })];
		const result = buildSystemReminderSection(rules, []);
		expect(result).toMatch(/^<system-reminder>[\s\S]*<\/system-reminder>$/s);
	});

	it("should include source directories in header", () => {
		const rules = [createMockRule({ name: "r", title: "R", content: "Body" })];
		const result = buildSystemReminderSection(rules, [".claude/rules", ".opencode/rules"]);
		expect(result).toContain(".claude/rules");
		expect(result).toContain(".opencode/rules");
	});

	it("should include rule name and title in format 'Rule: name — title'", () => {
		const rules = [createMockRule({ name: "test-rule", title: "Test Rule Title", content: "Body" })];
		const result = buildSystemReminderSection(rules, []);
		expect(result).toContain("Rule: test-rule — Test Rule Title");
	});

	it("should not include > line when description is absent", () => {
		const rules = [
			createMockRule({
				name: "node",
				title: "Node",
				content: "Body",
				frontmatter: { globs: [], severity: "medium" },
			}),
		];
		const result = buildSystemReminderSection(rules, []);
		expect(result).not.toContain("> undefined");
	});
});

describe("buildToolReminderSection: severity icon mapping", () => {
	it("should use 🔴 for critical severity", async () => {
		const rules = [
			createMockRule({
				name: "crit",
				title: "Critical",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "critical" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🔴");
		expect(result).toContain("[critical]");
	});

	it("should use 🟠 for high severity", async () => {
		const rules = [
			createMockRule({
				name: "high",
				title: "High",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "high" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🟠");
		expect(result).toContain("[high]");
	});

	it("should use 🟡 for medium severity", async () => {
		const rules = [
			createMockRule({
				name: "med",
				title: "Medium",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "medium" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🟡");
		expect(result).toContain("[medium]");
	});

	it("should use 🔵 for low severity", async () => {
		const rules = [
			createMockRule({
				name: "low",
				title: "Low",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "low" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🔵");
		expect(result).toContain("[low]");
	});

	it("should use 💡 for hint severity", async () => {
		const rules = [
			createMockRule({
				name: "hint",
				title: "Hint",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "hint" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("💡");
	});

	it("should use default 🟡 for unknown severity", async () => {
		const rules = [
			createMockRule({
				name: "unknown",
				title: "Unknown",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "unknown" as any },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🟡");
	});

	it("should use 🟠 for high severity", () => {
		const rules = [
			createMockRule({
				name: "high",
				title: "High",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "high" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🟠");
		expect(result).toContain("[high]");
	});

	it("should use 🟡 for medium severity", () => {
		const rules = [
			createMockRule({
				name: "med",
				title: "Medium",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "medium" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🟡");
		expect(result).toContain("[medium]");
	});

	it("should use 🔵 for low severity", () => {
		const rules = [
			createMockRule({
				name: "low",
				title: "Low",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "low" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🔵");
		expect(result).toContain("[low]");
	});

	it("should use 💡 for hint severity", () => {
		const rules = [
			createMockRule({
				name: "hint",
				title: "Hint",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "hint" },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("💡");
		expect(result).toContain("[hint]");
	});

	it("should use default 🟡 for unknown severity", () => {
		const rules = [
			createMockRule({
				name: "unknown",
				title: "Unknown",
				content: "Body",
				frontmatter: { globs: ["**/*"], severity: "unknown" as any },
				isUnconditional: false,
			}),
		];
		const result = buildToolReminderSection(rules, "any-file.ts");
		expect(result).toContain("🟡");
	});
	it("should produce identical output for same input on repeated calls", () => {
		const rules = [createMockRule({ name: "r1", title: "Rule", content: "Body" })];
		const result1 = buildSystemReminderSection(rules, [".claude/rules"]);
		const result2 = buildSystemReminderSection(rules, [".claude/rules"]);
		expect(result1).toBe(result2);
	});
});
