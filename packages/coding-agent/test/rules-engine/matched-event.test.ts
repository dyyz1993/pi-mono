import { describe, expect, it } from "vitest";
import { matchesAnyGlob, matchGlob } from "../../src/rules-engine/matcher.js";

describe("Rules Engine: conditional rule matching", () => {
	it("should match *.ts glob for .ts files", () => {
		expect(matchesAnyGlob(["**/*.ts", "**/*.tsx"], "/project/src/utils/helper.ts")).toBe(true);
		expect(matchesAnyGlob(["**/*.ts", "**/*.tsx"], "/project/src/components/App.tsx")).toBe(true);
		expect(matchesAnyGlob(["**/*.ts", "**/*.tsx"], "/project/README.md")).toBe(false);
	});

	it("should match directory-path globs", () => {
		expect(matchesAnyGlob(["**/components/**/*.tsx"], "/project/src/components/Button.tsx")).toBe(true);
		expect(matchesAnyGlob(["**/components/**/*.tsx"], "/project/src/utils/helper.ts")).toBe(false);
	});

	it("should match api/routes globs", () => {
		expect(matchesAnyGlob(["**/api/**/*.ts"], "/project/src/api/users.ts")).toBe(true);
		expect(matchesAnyGlob(["**/routes/**/*.ts"], "/project/src/routes/index.ts")).toBe(true);
		expect(matchesAnyGlob(["**/handlers/**/*.ts"], "/project/src/handlers/rules.ts")).toBe(true);
	});

	it("should match test file globs", () => {
		expect(matchesAnyGlob(["**/*.test.ts", "**/*.spec.ts"], "/project/src/utils.test.ts")).toBe(true);
		expect(matchesAnyGlob(["**/*.test.ts", "**/*.spec.ts"], "/project/src/utils.spec.ts")).toBe(true);
		expect(matchesAnyGlob(["**/*.test.ts", "**/*.spec.ts"], "/project/src/utils.ts")).toBe(false);
	});

	it("should match overlapping paths (file matches multiple rules)", () => {
		const filePath = "/project/src/components/Button.test.tsx";
		expect(matchesAnyGlob(["**/*.ts", "**/*.tsx"], filePath)).toBe(true);
		expect(matchesAnyGlob(["**/components/**/*.tsx"], filePath)).toBe(true);
		expect(matchesAnyGlob(["**/*.test.ts", "**/*.test.tsx"], filePath)).toBe(true);
		expect(matchesAnyGlob(["**/*.md"], filePath)).toBe(false);
	});

	it("should match project-level extension paths", () => {
		const filePath = "/project/packages/coding-agent/src/rules-engine/loader.ts";
		expect(matchesAnyGlob(["**/packages/coding-agent/src/**/*.ts"], filePath)).toBe(true);
		expect(matchesAnyGlob(["**/*.ts"], filePath)).toBe(true);
		expect(matchesAnyGlob(["**/src/**/extensions/**/*.ts"], filePath)).toBe(false);
	});

	it("should handle exact match patterns", () => {
		expect(matchGlob("**/*.ts", "foo.ts")).toBe(true);
		expect(matchGlob("**/*.ts", "src/foo.ts")).toBe(true);
		expect(matchGlob("**/*.ts", "src/dir/foo.ts")).toBe(true);
		expect(matchGlob("**/*.ts", "src/foo.tsx")).toBe(false);
		expect(matchGlob("**/api/**/*.ts", "src/api/users.ts")).toBe(true);
		expect(matchGlob("**/api/**/*.ts", "src/db/users.ts")).toBe(false);
	});
});
