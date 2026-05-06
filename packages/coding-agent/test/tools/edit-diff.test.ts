import { mkdtempSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyEditsToNormalizedContent,
	computeEditDiff,
	computeEditsDiff,
	detectLineEnding,
	fuzzyFindText,
	generateDiffString,
	normalizeForFuzzyMatch,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "../../src/core/tools/edit-diff.js";

describe("edit-diff", () => {
	describe("detectLineEnding", () => {
		it("returns LF for LF-only content", () => {
			expect(detectLineEnding("a\nb\nc")).toBe("\n");
		});

		it("returns CRLF when CRLF appears before LF", () => {
			expect(detectLineEnding("a\r\nb\nc")).toBe("\r\n");
		});

		it("returns LF when no line endings present", () => {
			expect(detectLineEnding("no newlines")).toBe("\n");
		});

		it("returns LF for empty string", () => {
			expect(detectLineEnding("")).toBe("\n");
		});

		it("returns CRLF for CRLF-only content", () => {
			expect(detectLineEnding("a\r\nb\r\nc")).toBe("\r\n");
		});

		it("returns CRLF when CRLF comes first, then plain LF", () => {
			expect(detectLineEnding("a\r\nb\nc")).toBe("\r\n");
		});

		it("returns LF when plain LF comes before CRLF", () => {
			expect(detectLineEnding("a\nb\r\nc")).toBe("\n");
		});
	});

	describe("normalizeToLF", () => {
		it("converts CRLF to LF", () => {
			expect(normalizeToLF("a\r\nb\r\nc")).toBe("a\nb\nc");
		});

		it("converts standalone CR to LF", () => {
			expect(normalizeToLF("a\rb\rc")).toBe("a\nb\nc");
		});

		it("leaves LF-only content unchanged", () => {
			expect(normalizeToLF("a\nb\nc")).toBe("a\nb\nc");
		});

		it("handles empty string", () => {
			expect(normalizeToLF("")).toBe("");
		});

		it("handles string with no line endings", () => {
			expect(normalizeToLF("hello")).toBe("hello");
		});

		it("handles mixed line endings", () => {
			expect(normalizeToLF("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
		});
	});

	describe("restoreLineEndings", () => {
		it("converts LF to CRLF when ending is CRLF", () => {
			expect(restoreLineEndings("a\nb\nc", "\r\n")).toBe("a\r\nb\r\nc");
		});

		it("leaves LF unchanged when ending is LF", () => {
			expect(restoreLineEndings("a\nb\nc", "\n")).toBe("a\nb\nc");
		});

		it("handles empty string", () => {
			expect(restoreLineEndings("", "\r\n")).toBe("");
		});

		it("handles string with no newlines", () => {
			expect(restoreLineEndings("hello", "\r\n")).toBe("hello");
		});
	});

	describe("normalizeForFuzzyMatch", () => {
		it("strips trailing whitespace from each line", () => {
			expect(normalizeForFuzzyMatch("hello   \nworld  ")).toBe("hello\nworld");
		});

		it("normalizes smart single quotes to ASCII", () => {
			expect(normalizeForFuzzyMatch("\u2018hello\u2019")).toBe("'hello'");
		});

		it("normalizes smart double quotes to ASCII", () => {
			expect(normalizeForFuzzyMatch("\u201Chello\u201D")).toBe('"hello"');
		});

		it("normalizes unicode dashes to ASCII hyphen", () => {
			expect(normalizeForFuzzyMatch("a\u2013b\u2014c\u2212d")).toBe("a-b-c-d");
		});

		it("normalizes special spaces to regular space", () => {
			expect(normalizeForFuzzyMatch("a\u00A0b\u3000c")).toBe("a b c");
		});

		it("returns unchanged text with no special characters", () => {
			expect(normalizeForFuzzyMatch("hello world")).toBe("hello world");
		});

		it("handles empty string", () => {
			expect(normalizeForFuzzyMatch("")).toBe("");
		});

		it("handles multiple normalizations at once", () => {
			const input = "\u201Ctest\u201D \u2018value\u2019\u00A0\u2013  trailing  ";
			const result = normalizeForFuzzyMatch(input);
			expect(result).toBe("\"test\" 'value' -  trailing");
		});
	});

	describe("fuzzyFindText", () => {
		it("finds exact match", () => {
			const result = fuzzyFindText("hello world", "world");
			expect(result).toEqual({
				found: true,
				index: 6,
				matchLength: 5,
				usedFuzzyMatch: false,
				contentForReplacement: "hello world",
			});
		});

		it("finds exact match at start", () => {
			const result = fuzzyFindText("hello world", "hello");
			expect(result.found).toBe(true);
			expect(result.index).toBe(0);
			expect(result.usedFuzzyMatch).toBe(false);
		});

		it("returns not found for missing text", () => {
			const result = fuzzyFindText("hello world", "xyz");
			expect(result).toEqual({
				found: false,
				index: -1,
				matchLength: 0,
				usedFuzzyMatch: false,
				contentForReplacement: "hello world",
			});
		});

		it("falls back to fuzzy match when exact fails", () => {
			const content = "hello \u2018world\u2019";
			const result = fuzzyFindText(content, "'world'");
			expect(result.found).toBe(true);
			expect(result.usedFuzzyMatch).toBe(true);
			expect(result.contentForReplacement).toBe("hello 'world'");
		});

		it("fuzzy matches with trailing whitespace differences", () => {
			const content = "hello   \nworld";
			const result = fuzzyFindText(content, "hello\nworld");
			expect(result.found).toBe(true);
			expect(result.usedFuzzyMatch).toBe(true);
		});

		it("finds empty oldText as exact match at position 0", () => {
			const result = fuzzyFindText("hello", "");
			expect(result.found).toBe(true);
			expect(result.index).toBe(0);
			expect(result.matchLength).toBe(0);
		});

		it("finds in empty content with empty oldText", () => {
			const result = fuzzyFindText("", "");
			expect(result.found).toBe(true);
			expect(result.index).toBe(0);
		});

		it("does not find non-empty text in empty content", () => {
			const result = fuzzyFindText("", "hello");
			expect(result.found).toBe(false);
		});

		it("finds multiline exact match", () => {
			const content = "line1\nline2\nline3";
			const result = fuzzyFindText(content, "line2\nline3");
			expect(result.found).toBe(true);
			expect(result.index).toBe(6);
			expect(result.usedFuzzyMatch).toBe(false);
		});
	});

	describe("stripBom", () => {
		it("strips UTF-8 BOM", () => {
			expect(stripBom("\uFEFFhello")).toEqual({ bom: "\uFEFF", text: "hello" });
		});

		it("returns empty bom when no BOM present", () => {
			expect(stripBom("hello")).toEqual({ bom: "", text: "hello" });
		});

		it("handles empty string", () => {
			expect(stripBom("")).toEqual({ bom: "", text: "" });
		});

		it("handles string that is only BOM", () => {
			expect(stripBom("\uFEFF")).toEqual({ bom: "\uFEFF", text: "" });
		});

		it("does not strip BOM in middle of string", () => {
			expect(stripBom("a\uFEFFb")).toEqual({ bom: "", text: "a\uFEFFb" });
		});
	});

	describe("applyEditsToNormalizedContent", () => {
		it("applies a single edit", () => {
			const result = applyEditsToNormalizedContent(
				"hello world",
				[{ oldText: "world", newText: "there" }],
				"test.txt",
			);
			expect(result.newContent).toBe("hello there");
		});

		it("applies multiple non-overlapping edits in reverse order", () => {
			const content = "aaa bbb ccc";
			const result = applyEditsToNormalizedContent(
				content,
				[
					{ oldText: "aaa", newText: "AAA" },
					{ oldText: "ccc", newText: "CCC" },
				],
				"test.txt",
			);
			expect(result.newContent).toBe("AAA bbb CCC");
		});

		it("throws on empty oldText (single edit)", () => {
			expect(() => applyEditsToNormalizedContent("hello", [{ oldText: "", newText: "x" }], "test.txt")).toThrow(
				"oldText must not be empty in test.txt",
			);
		});

		it("throws on empty oldText (multiple edits)", () => {
			expect(() =>
				applyEditsToNormalizedContent(
					"hello",
					[
						{ oldText: "hello", newText: "hi" },
						{ oldText: "", newText: "x" },
					],
					"test.txt",
				),
			).toThrow("edits[1].oldText must not be empty in test.txt");
		});

		it("throws when text not found (single edit)", () => {
			expect(() => applyEditsToNormalizedContent("hello", [{ oldText: "xyz", newText: "abc" }], "test.txt")).toThrow(
				"Could not find the exact text in test.txt",
			);
		});

		it("throws when text not found (multiple edits)", () => {
			expect(() =>
				applyEditsToNormalizedContent(
					"hello",
					[
						{ oldText: "hello", newText: "hi" },
						{ oldText: "xyz", newText: "abc" },
					],
					"test.txt",
				),
			).toThrow("Could not find edits[1] in test.txt");
		});

		it("throws on duplicate occurrences (single edit)", () => {
			expect(() =>
				applyEditsToNormalizedContent("abc abc", [{ oldText: "abc", newText: "xyz" }], "test.txt"),
			).toThrow("Found 2 occurrences of the text in test.txt");
		});

		it("throws on duplicate occurrences (multiple edits)", () => {
			expect(() =>
				applyEditsToNormalizedContent("abc abc def", [{ oldText: "abc", newText: "xyz" }], "test.txt"),
			).toThrow("Found 2 occurrences of the text in test.txt");
		});

		it("throws on overlapping edits", () => {
			expect(() =>
				applyEditsToNormalizedContent(
					"abcdefgh",
					[
						{ oldText: "bcd", newText: "BCD" },
						{ oldText: "cde", newText: "CDE" },
					],
					"test.txt",
				),
			).toThrow("overlap");
		});

		it("throws when no change produced (single edit)", () => {
			expect(() =>
				applyEditsToNormalizedContent("hello", [{ oldText: "hello", newText: "hello" }], "test.txt"),
			).toThrow("No changes made to test.txt");
		});

		it("throws when no change produced (multiple edits)", () => {
			expect(() =>
				applyEditsToNormalizedContent(
					"hello world",
					[
						{ oldText: "hello", newText: "hello" },
						{ oldText: "world", newText: "world" },
					],
					"test.txt",
				),
			).toThrow("No changes made to test.txt");
		});

		it("normalizes CRLF in edit inputs", () => {
			const result = applyEditsToNormalizedContent(
				"hello\r\nworld",
				[{ oldText: "hello\r\nworld", newText: "hi\r\nthere" }],
				"test.txt",
			);
			expect(result.newContent).toBe("hi\nthere");
		});

		it("uses fuzzy-normalized content when fuzzy match needed", () => {
			const content = "hello \u2018world\u2019";
			const result = applyEditsToNormalizedContent(
				content,
				[{ oldText: "'world'", newText: "'earth'" }],
				"test.txt",
			);
			expect(result.newContent).toBe("hello 'earth'");
		});

		it("returns baseContent reflecting fuzzy normalization", () => {
			const content = "hello \u2018world\u2019";
			const result = applyEditsToNormalizedContent(
				content,
				[{ oldText: "'world'", newText: "'earth'" }],
				"test.txt",
			);
			expect(result.baseContent).toBe("hello 'world'");
		});

		it("applies adjacent non-overlapping edits", () => {
			const content = "abcdefgh";
			const result = applyEditsToNormalizedContent(
				content,
				[
					{ oldText: "abc", newText: "ABC" },
					{ oldText: "def", newText: "DEF" },
				],
				"test.txt",
			);
			expect(result.newContent).toBe("ABCDEFgh");
		});

		it("handles single character replacement", () => {
			const result = applyEditsToNormalizedContent("abc", [{ oldText: "b", newText: "X" }], "test.txt");
			expect(result.newContent).toBe("aXc");
		});
	});

	describe("generateDiffString", () => {
		it("returns diff with line numbers for a simple change", () => {
			const result = generateDiffString("line1\nline2\nline3", "line1\nchanged\nline3");
			expect(result.diff).toContain("-2 line2");
			expect(result.diff).toContain("+2 changed");
			expect(result.firstChangedLine).toBe(2);
		});

		it("returns undefined firstChangedLine for identical content", () => {
			const result = generateDiffString("abc", "abc");
			expect(result.diff).toBe("");
			expect(result.firstChangedLine).toBeUndefined();
		});

		it("shows insertion at end", () => {
			const result = generateDiffString("line1\nline2", "line1\nline2\nline3");
			expect(result.diff).toContain("+");
			expect(result.diff).toContain("line3");
			expect(result.firstChangedLine).toBe(2);
		});

		it("shows insertion at beginning", () => {
			const result = generateDiffString("line1\nline2", "line0\nline1\nline2");
			expect(result.diff).toContain("+1 line0");
			expect(result.firstChangedLine).toBe(1);
		});

		it("shows deletion", () => {
			const result = generateDiffString("line1\nline2\nline3", "line1\nline3");
			expect(result.diff).toContain("-2 line2");
			expect(result.firstChangedLine).toBe(2);
		});

		it("truncates context lines around changes", () => {
			const oldContent = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n");
			const newContent = oldContent.replace("line10", "CHANGED");
			const result = generateDiffString(oldContent, newContent, 2);
			expect(result.diff).toContain("...");
		});

		it("handles empty old content", () => {
			const result = generateDiffString("", "new line");
			expect(result.diff).toContain("+1 new line");
			expect(result.firstChangedLine).toBe(1);
		});

		it("handles empty new content", () => {
			const result = generateDiffString("old line", "");
			expect(result.diff).toContain("-1 old line");
			expect(result.firstChangedLine).toBe(1);
		});

		it("uses correct line number width padding", () => {
			const oldLines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join("\n");
			const newContent = oldLines.replace("line50", "CHANGED");
			const result = generateDiffString(oldLines, newContent);
			expect(result.diff).toMatch(/-\s*50 line50/);
		});
	});

	describe("computeEditsDiff", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = mkdtempSync(join(tmpdir(), "edit-diff-test-"));
		});

		afterEach(() => {
			const files = readdirSync(tempDir);
			for (const file of files) {
				unlinkSync(join(tempDir, file));
			}
			rmdirSync(tempDir);
		});

		it("returns error for non-existent file", async () => {
			const result = await computeEditsDiff("nonexistent.txt", [{ oldText: "x", newText: "y" }], tempDir);
			expect(result).toEqual({ error: "File not found: nonexistent.txt" });
		});

		it("computes diff for a single edit", async () => {
			const filePath = join(tempDir, "test.txt");
			writeFileSync(filePath, "hello world", "utf-8");
			const result = await computeEditsDiff("test.txt", [{ oldText: "world", newText: "there" }], tempDir);
			if ("diff" in result) {
				expect(result.diff).toContain("hello world");
				expect(result.diff).toContain("hello there");
				expect(result.firstChangedLine).toBe(1);
			} else {
				expect.fail("Expected diff result, got error");
			}
		});

		it("computes diff for multiple edits", async () => {
			const filePath = join(tempDir, "multi.txt");
			writeFileSync(filePath, "aaa\nbbb\nccc", "utf-8");
			const result = await computeEditsDiff(
				"multi.txt",
				[
					{ oldText: "aaa", newText: "AAA" },
					{ oldText: "ccc", newText: "CCC" },
				],
				tempDir,
			);
			if ("diff" in result) {
				expect(result.diff).toContain("AAA");
				expect(result.diff).toContain("CCC");
			} else {
				expect.fail("Expected diff result, got error");
			}
		});

		it("strips BOM before matching", async () => {
			const filePath = join(tempDir, "bom.txt");
			writeFileSync(filePath, "\uFEFFhello world", "utf-8");
			const result = await computeEditsDiff("bom.txt", [{ oldText: "hello", newText: "hi" }], tempDir);
			if ("diff" in result) {
				expect(result.diff).toContain("hi");
			} else {
				expect.fail("Expected diff result, got error");
			}
		});

		it("returns error when text not found", async () => {
			const filePath = join(tempDir, "notfound.txt");
			writeFileSync(filePath, "hello world", "utf-8");
			const result = await computeEditsDiff("notfound.txt", [{ oldText: "xyz", newText: "abc" }], tempDir);
			expect("error" in result && result.error).toContain("Could not find the exact text in notfound.txt");
		});

		it("returns error on duplicate matches", async () => {
			const filePath = join(tempDir, "dup.txt");
			writeFileSync(filePath, "abc abc", "utf-8");
			const result = await computeEditsDiff("dup.txt", [{ oldText: "abc", newText: "xyz" }], tempDir);
			expect("error" in result && result.error).toContain("Found 2 occurrences");
		});

		it("handles CRLF files", async () => {
			const filePath = join(tempDir, "crlf.txt");
			writeFileSync(filePath, "hello\r\nworld", "utf-8");
			const result = await computeEditsDiff("crlf.txt", [{ oldText: "hello", newText: "hi" }], tempDir);
			if ("diff" in result) {
				expect(result.diff).toContain("hi");
			} else {
				expect.fail("Expected diff result, got error");
			}
		});
	});

	describe("computeEditDiff", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = mkdtempSync(join(tmpdir(), "edit-diff-single-"));
		});

		afterEach(() => {
			const files = readdirSync(tempDir);
			for (const file of files) {
				unlinkSync(join(tempDir, file));
			}
			rmdirSync(tempDir);
		});

		it("returns error for non-existent file", async () => {
			const result = await computeEditDiff("missing.txt", "x", "y", tempDir);
			expect(result).toEqual({ error: "File not found: missing.txt" });
		});

		it("computes diff for a single oldText/newText pair", async () => {
			const filePath = join(tempDir, "single.txt");
			writeFileSync(filePath, "foo bar baz", "utf-8");
			const result = await computeEditDiff("single.txt", "bar", "BAR", tempDir);
			if ("diff" in result) {
				expect(result.diff).toContain("BAR");
			} else {
				expect.fail("Expected diff result, got error");
			}
		});
	});
});
