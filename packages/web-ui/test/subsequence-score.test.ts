import { describe, expect, it } from "vitest";
import { subsequenceScore } from "../src/dialogs/ModelSelector.js";

describe("subsequenceScore", () => {
	it("returns highest score for exact match", () => {
		expect(subsequenceScore("claude", "claude")).toBeGreaterThan(subsequenceScore("cde", "claude"));
	});

	it("returns 1 for exact match (no gaps)", () => {
		expect(subsequenceScore("claude", "claude")).toBe(1);
	});

	it("returns positive score for subsequence match", () => {
		expect(subsequenceScore("cld", "claude")).toBeGreaterThan(0);
	});

	it("returns 0 for no match", () => {
		expect(subsequenceScore("xyz", "claude")).toBe(0);
	});

	it("returns NaN for empty query", () => {
		expect(subsequenceScore("", "claude")).toBeNaN();
	});

	it("handles single character query", () => {
		expect(subsequenceScore("c", "claude")).toBe(1);
	});

	it("penalizes gaps between matched characters", () => {
		const closeScore = subsequenceScore("cla", "claude");
		const farScore = subsequenceScore("cde", "claude");
		expect(closeScore).toBeGreaterThan(farScore);
	});

	it("is case-sensitive", () => {
		expect(subsequenceScore("CLAUDE", "claude")).toBe(0);
		expect(subsequenceScore("claude", "CLAUDE")).toBe(0);
	});

	it("returns 0 when query is longer than text", () => {
		expect(subsequenceScore("claude-3.5-sonnet", "claude")).toBe(0);
	});

	it("scores substring prefix higher than scattered match", () => {
		const prefixScore = subsequenceScore("cl", "claude");
		const scatteredScore = subsequenceScore("ce", "claude");
		expect(prefixScore).toBeGreaterThan(scatteredScore);
	});
});
