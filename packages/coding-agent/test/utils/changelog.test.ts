import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ChangelogEntry, compareVersions, getNewEntries, parseChangelog } from "../../src/utils/changelog.js";

describe("parseChangelog", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `pi-changelog-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
	});

	it("returns empty array for non-existent file", () => {
		expect(parseChangelog(join(testDir, "nope.md"))).toEqual([]);
	});

	it("returns empty array for file with no version headers", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(p, "# Changelog\n\nSome intro text\n");
		expect(parseChangelog(p)).toEqual([]);
	});

	it("parses a single version section", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(
			p,
			`# Changelog

## [1.2.3] - 2025-01-01

### Added
- New feature X
- Another feature Y
`,
		);
		const entries = parseChangelog(p);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ major: 1, minor: 2, patch: 3 });
		expect(entries[0].content).toContain("## [1.2.3]");
		expect(entries[0].content).toContain("### Added");
		expect(entries[0].content).toContain("New feature X");
	});

	it("parses multiple version sections", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(
			p,
			`## [2.0.0] - 2025-02-01

### Breaking Changes
- Removed old API

## [1.1.0] - 2025-01-15

### Fixed
- Bug fix

## [1.0.0] - 2025-01-01

### Added
- Initial release
`,
		);
		const entries = parseChangelog(p);
		expect(entries).toHaveLength(3);
		expect(entries[0]).toMatchObject({ major: 2, minor: 0, patch: 0 });
		expect(entries[1]).toMatchObject({ major: 1, minor: 1, patch: 0 });
		expect(entries[2]).toMatchObject({ major: 1, minor: 0, patch: 0 });
	});

	it("handles entries with issue links", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(
			p,
			`## [1.0.1]

### Fixed
- Fixed bug ([#123](https://github.com/foo/bar/issues/123))
`,
		);
		const entries = parseChangelog(p);
		expect(entries).toHaveLength(1);
		expect(entries[0].content).toContain("[#123]");
	});

	it("handles entries with PR links and author attribution", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(
			p,
			`## [1.1.0]

### Added
- New feature ([#456](https://github.com/foo/bar/pull/456) by [@contrib](https://github.com/contrib))
`,
		);
		const entries = parseChangelog(p);
		expect(entries[0].content).toContain("by [@contrib]");
	});

	it("skips unreleased section (no semver match)", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(
			p,
			`## [Unreleased]

### Added
- Upcoming feature

## [1.0.0]

### Added
- Initial release
`,
		);
		const entries = parseChangelog(p);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ major: 1, minor: 0, patch: 0 });
	});

	it("handles version headers without brackets", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(
			p,
			`## 3.2.1 - 2025-03-01

### Fixed
- Something
`,
		);
		const entries = parseChangelog(p);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ major: 3, minor: 2, patch: 1 });
	});

	it("handles subsections: Added, Fixed, Changed, Removed, Breaking Changes", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(
			p,
			`## [2.0.0]

### Breaking Changes
- Broke everything

### Added
- New stuff

### Changed
- Different now

### Fixed
- Patched

### Removed
- Gone
`,
		);
		const entries = parseChangelog(p);
		expect(entries).toHaveLength(1);
		const c = entries[0].content;
		expect(c).toContain("### Breaking Changes");
		expect(c).toContain("### Added");
		expect(c).toContain("### Changed");
		expect(c).toContain("### Fixed");
		expect(c).toContain("### Removed");
	});

	it("trims content whitespace", () => {
		const p = join(testDir, "cl.md");
		writeFileSync(
			p,
			`## [1.0.0]

### Added
- Feature

`,
		);
		const entries = parseChangelog(p);
		expect(entries[0].content).not.toMatch(/^\s|\s$/);
	});
});

describe("compareVersions", () => {
	const v = (major: number, minor: number, patch: number): ChangelogEntry => ({
		major,
		minor,
		patch,
		content: "",
	});

	it("returns 0 for equal versions", () => {
		expect(compareVersions(v(1, 2, 3), v(1, 2, 3))).toBe(0);
	});

	it("returns positive when first version is greater (major)", () => {
		expect(compareVersions(v(2, 0, 0), v(1, 9, 9))).toBeGreaterThan(0);
	});

	it("returns negative when first version is smaller (major)", () => {
		expect(compareVersions(v(1, 0, 0), v(2, 0, 0))).toBeLessThan(0);
	});

	it("compares minor when major is equal", () => {
		expect(compareVersions(v(1, 3, 0), v(1, 2, 9))).toBeGreaterThan(0);
		expect(compareVersions(v(1, 1, 0), v(1, 2, 0))).toBeLessThan(0);
	});

	it("compares patch when major and minor are equal", () => {
		expect(compareVersions(v(1, 2, 5), v(1, 2, 3))).toBeGreaterThan(0);
		expect(compareVersions(v(1, 2, 1), v(1, 2, 2))).toBeLessThan(0);
	});

	it("handles zero versions", () => {
		expect(compareVersions(v(0, 0, 1), v(0, 0, 0))).toBeGreaterThan(0);
		expect(compareVersions(v(0, 0, 0), v(0, 0, 0))).toBe(0);
	});
});

describe("getNewEntries", () => {
	const entry = (major: number, minor: number, patch: number): ChangelogEntry => ({
		major,
		minor,
		patch,
		content: `## [${major}.${minor}.${patch}]`,
	});

	it("returns entries newer than given version", () => {
		const entries = [entry(2, 0, 0), entry(1, 1, 0), entry(1, 0, 0)];
		const result = getNewEntries(entries, "1.0.0");
		expect(result).toHaveLength(2);
		expect(result.map((e) => `${e.major}.${e.minor}.${e.patch}`)).toEqual(["2.0.0", "1.1.0"]);
	});

	it("returns all entries when lastVersion is 0.0.0", () => {
		const entries = [entry(1, 0, 0), entry(0, 1, 0)];
		expect(getNewEntries(entries, "0.0.0")).toHaveLength(2);
	});

	it("returns empty when all entries are older or equal", () => {
		const entries = [entry(1, 0, 0)];
		expect(getNewEntries(entries, "1.0.0")).toHaveLength(0);
		expect(getNewEntries(entries, "2.0.0")).toHaveLength(0);
	});

	it("returns empty for empty entries", () => {
		expect(getNewEntries([], "1.0.0")).toHaveLength(0);
	});

	it("handles version not in entries", () => {
		const entries = [entry(2, 0, 0), entry(1, 0, 0)];
		const result = getNewEntries(entries, "1.5.0");
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ major: 2, minor: 0, patch: 0 });
	});

	it("handles partial version string (missing patch)", () => {
		const entries = [entry(1, 1, 0)];
		const result = getNewEntries(entries, "1.0");
		expect(result).toHaveLength(1);
	});
});
