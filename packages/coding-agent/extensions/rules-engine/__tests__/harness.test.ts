import { describe, expect, it } from "vitest";
import {
	matchesAnyGlob,
	matchGlob,
	parseFrontmatter,
	parseRuleFile,
} from "../index.ts";

describe("rules-engine — matcher (matchesAnyGlob / matchGlob)", () => {
	describe("matchGlob", () => {
		it("matches a simple file pattern", () => {
			expect(matchGlob("*.ts", "foo.ts")).toBe(true);
		});

		it("does not match when pattern doesn't apply", () => {
			expect(matchGlob("*.ts", "foo.js")).toBe(false);
		});

		it("matches directory globs", () => {
			expect(matchGlob("src/**", "src/index.ts")).toBe(true);
		});

		it("matches nested directories", () => {
			expect(matchGlob("src/**", "src/deep/nested/file.ts")).toBe(true);
		});

		it("returns false for empty pattern", () => {
			expect(matchGlob("", "foo.ts")).toBe(false);
		});

		it("returns false for empty target", () => {
			expect(matchGlob("*.ts", "")).toBe(false);
		});

		it("handles brace expansion", () => {
			expect(matchGlob("*.{ts,tsx}", "component.tsx")).toBe(true);
			expect(matchGlob("*.{ts,tsx}", "module.ts")).toBe(true);
			expect(matchGlob("*.{ts,tsx}", "style.css")).toBe(false);
		});
	});

	describe("matchesAnyGlob", () => {
		it("matches when any glob in the array matches", () => {
			expect(matchesAnyGlob(["*.css", "*.scss"], "style.scss")).toBe(true);
			expect(matchesAnyGlob(["*.css", "*.scss"], "main.css")).toBe(true);
		});

		it("does not match when no glob matches", () => {
			expect(matchesAnyGlob(["*.css", "*.scss"], "script.js")).toBe(false);
		});

		it("returns false for empty globs array", () => {
			expect(matchesAnyGlob([], "foo.ts")).toBe(false);
		});

		it("returns false for empty filePath", () => {
			expect(matchesAnyGlob(["*.ts"], "")).toBe(false);
		});

		it("handles multiple brace expansions across patterns", () => {
			expect(matchesAnyGlob(["*.{png,jpg}", "*.svg"], "icon.svg")).toBe(true);
			expect(matchesAnyGlob(["*.{png,jpg}", "*.svg"], "photo.png")).toBe(true);
			expect(matchesAnyGlob(["*.{png,jpg}", "*.svg"], "doc.pdf")).toBe(false);
		});

		it("handles absolute paths (strips leading slash for matching)", () => {
			expect(matchesAnyGlob(["src/**"], "/src/index.ts")).toBe(true);
		});

		it("handles backslash paths (normalizes to forward slash)", () => {
			expect(matchesAnyGlob(["src/**"], "src\\index.ts")).toBe(true);
		});
	});
});

describe("rules-engine — parseFrontmatter", () => {
	it("parses simple key-value frontmatter", () => {
		const content = `---
description: A test rule
severity: high
---
# Rule Body`;
		const { data, body } = parseFrontmatter(content);

		expect(data.description).toBe("A test rule");
		expect(data.severity).toBe("high");
		expect(body).toContain("# Rule Body");
	});

	it("returns empty data when no frontmatter present", () => {
		const content = "# Just a body";
		const { data, body } = parseFrontmatter(content);

		expect(data).toEqual({});
		expect(body).toBe("# Just a body");
	});

	it("parses array values from YAML list syntax", () => {
		const content = `---
globs:
  - "*.ts"
  - "*.tsx"
---
Body`;
		const { data } = parseFrontmatter(content);

		expect(data.globs).toEqual(["*.ts", "*.tsx"]);
	});

	it("parses inline JSON array values", () => {
		const content = `---
globs: ["*.ts", "*.tsx"]
---
Body`;
		const { data } = parseFrontmatter(content);

		expect(data.globs).toEqual(["*.ts", "*.tsx"]);
	});

	it("parses comma-separated string for paths/globs keys", () => {
		const content = `---
globs: "*.ts, *.tsx"
---
Body`;
		const { data } = parseFrontmatter(content);

		expect(data.globs).toEqual(["*.ts", "*.tsx"]);
	});

	it("converts kebab-case keys to camelCase", () => {
		const content = `---
when-to-use: testing
allowed-tools: bash
---
Body`;
		const { data } = parseFrontmatter(content);

		expect(data.whenToUse).toBe("testing");
		expect(data.allowedTools).toBe("bash");
	});

	it("handles null/undefined values", () => {
		const content = `---
description: null
---
Body`;
		const { data } = parseFrontmatter(content);

		expect(data.description).toBeNull();
	});

	it("handles quoted string values", () => {
		const content = `---
description: "quoted value"
---
Body`;
		const { data } = parseFrontmatter(content);

		expect(data.description).toBe("quoted value");
	});

	it("trims body whitespace", () => {
		const content = `---
key: val
---
   # Body   `;
		const { body } = parseFrontmatter(content);

		expect(body).toBe("# Body");
	});
});

describe("rules-engine — parseRuleFile", () => {
	it("parses a complete rule file with frontmatter and body", () => {
		const content = `---
description: Test rule
severity: critical
globs:
  - "*.ts"
---
# Test Rule

This is the rule content.`;
		const rule = parseRuleFile("test-rule.md", content);

		expect(rule.name).toBe("test-rule");
		expect(rule.filePath).toBe("test-rule.md");
		expect(rule.title).toBe("Test Rule");
		expect(rule.content).toContain("This is the rule content.");
		expect(rule.scope).toBe("project");
		expect(rule.frontmatter.description).toBe("Test rule");
		expect(rule.frontmatter.severity).toBe("critical");
		expect(rule.frontmatter.globs).toEqual(["*.ts"]);
	});

	it("marks rule as unconditional when no globs specified", () => {
		const content = `---
description: Always-on rule
---
# Always`;
		const rule = parseRuleFile("always.md", content);

		expect(rule.isUnconditional).toBe(true);
	});

	it("marks rule as unconditional when glob is **", () => {
		const content = `---
globs:
  - "**"
---
# Always`;
		const rule = parseRuleFile("always.md", content);

		expect(rule.isUnconditional).toBe(true);
	});

	it("marks rule as conditional when specific globs are present", () => {
		const content = `---
globs:
  - "*.ts"
---
# Conditional`;
		const rule = parseRuleFile("conditional.md", content);

		expect(rule.isUnconditional).toBe(false);
	});

	it("extracts title from first non-empty line of body", () => {
		const content = `---
key: val
---

   **Bold Title**

Content here.`;
		const rule = parseRuleFile("rule.md", content);

		expect(rule.title).toBe("Bold Title");
	});

	it("defaults to 'Untitled Rule' when body is empty", () => {
		// NOTE: frontmatter regex requires a trailing newline after the closing "---".
		// Without it, the whole content is treated as body and the test would fail.
		const content = `---
key: val
---
`;
		const rule = parseRuleFile("empty.md", content);

		expect(rule.title).toBe("Untitled Rule");
	});

	it("strips .md extension from name", () => {
		const rule = parseRuleFile("my-rule.md", "---\n---\n# Title");
		expect(rule.name).toBe("my-rule");
	});

	it("strips .mdc extension from name", () => {
		const rule = parseRuleFile("my-rule.mdc", "---\n---\n# Title");
		expect(rule.name).toBe("my-rule");
	});

	it("parses notifyOnMatch as boolean from string 'true'", () => {
		const content = `---
notify-on-match: "true"
---
# Rule`;
		const rule = parseRuleFile("rule.md", content);
		expect(rule.frontmatter.notifyOnMatch).toBe(true);
	});

	it("parses skipInPrompt as boolean from actual boolean", () => {
		const content = `---
skip-in-prompt: true
---
# Rule`;
		const rule = parseRuleFile("rule.md", content);
		expect(rule.frontmatter.skipInPrompt).toBe(true);
	});

	it("sets paths = globs when only globs specified", () => {
		const content = `---
globs:
  - "*.ts"
---
# Rule`;
		const rule = parseRuleFile("rule.md", content);
		expect(rule.frontmatter.globs).toEqual(["*.ts"]);
		expect(rule.frontmatter.paths).toEqual(["*.ts"]);
	});

	it("preserves separate paths when both globs and paths specified", () => {
		const content = `---
globs:
  - "*.ts"
paths:
  - "src/**/*.ts"
---
# Rule`;
		const rule = parseRuleFile("rule.md", content);
		expect(rule.frontmatter.globs).toEqual(["*.ts"]);
		expect(rule.frontmatter.paths).toEqual(["src/**/*.ts"]);
	});
});
