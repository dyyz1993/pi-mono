import { describe, expect, test } from "vitest";
import { DEFAULT_THINKING_LEVEL, DEFAULT_TIER_ALIASES } from "../src/core/defaults.js";

describe("DEFAULT_THINKING_LEVEL", () => {
	test('is "medium"', () => {
		expect(DEFAULT_THINKING_LEVEL).toBe("medium");
	});
});

describe("DEFAULT_TIER_ALIASES", () => {
	test("is an object with expected keys", () => {
		expect(Object.keys(DEFAULT_TIER_ALIASES)).toEqual(["fast", "pro", "max"]);
	});

	test("fast tier points to claude-haiku-4", () => {
		expect(DEFAULT_TIER_ALIASES.fast).toContain("claude-haiku-4");
	});

	test("pro tier points to claude-sonnet-4", () => {
		expect(DEFAULT_TIER_ALIASES.pro).toContain("claude-sonnet-4");
	});

	test("max tier points to claude-opus-4", () => {
		expect(DEFAULT_TIER_ALIASES.max).toContain("claude-opus-4");
	});

	test("all values are non-empty strings", () => {
		for (const value of Object.values(DEFAULT_TIER_ALIASES)) {
			expect(typeof value).toBe("string");
			expect(value.length).toBeGreaterThan(0);
		}
	});
});
