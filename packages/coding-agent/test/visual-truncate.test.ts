import { beforeAll, describe, expect, test } from "vitest";
import { truncateToVisualLines } from "../src/modes/interactive/components/visual-truncate.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("truncateToVisualLines", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("empty text returns empty", () => {
		const result = truncateToVisualLines("", 10, 80);
		expect(result.visualLines).toEqual([]);
		expect(result.skippedCount).toBe(0);
	});

	test("short text returns all lines without truncation", () => {
		const result = truncateToVisualLines("hello\nworld", 10, 80);
		expect(result.visualLines.length).toBe(2);
		expect(result.skippedCount).toBe(0);
	});

	test("text exceeding maxVisualLines truncates with correct skippedCount", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateToVisualLines(lines, 5, 80);
		expect(result.visualLines.length).toBe(5);
		expect(result.skippedCount).toBe(15);
	});

	test("truncation keeps last N lines", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateToVisualLines(lines, 3, 80);
		expect(result.skippedCount).toBe(7);
	});

	test("width wrapping affects visual line count", () => {
		const longLine = "a".repeat(40);
		const narrowResult = truncateToVisualLines(longLine, 100, 20);
		const wideResult = truncateToVisualLines(longLine, 100, 80);
		expect(narrowResult.visualLines.length).toBeGreaterThan(wideResult.visualLines.length);
	});

	test("single line within max returns with zero skipped", () => {
		const result = truncateToVisualLines("single line", 5, 80);
		expect(result.skippedCount).toBe(0);
		expect(result.visualLines.length).toBe(1);
	});
});
