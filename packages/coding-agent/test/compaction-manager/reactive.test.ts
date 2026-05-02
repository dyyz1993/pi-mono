import { describe, expect, it } from "vitest";
import { shouldForceCompact, shouldWarn } from "../../extensions/compaction-manager/reactive.js";

describe("shouldWarn", () => {
	it("warns at 75% usage", () => {
		expect(shouldWarn(150000, 200000, 75)).toBe(true);
	});

	it("does NOT warn below threshold", () => {
		expect(shouldWarn(130000, 200000, 75)).toBe(false);
	});

	it("warns at exactly the threshold boundary", () => {
		expect(shouldWarn(150000, 200000, 75)).toBe(true);
	});

	it("does NOT warn when tokens unknown", () => {
		expect(shouldWarn(null, 200000, 75)).toBe(false);
	});
});

describe("shouldForceCompact", () => {
	it("forces compact at 90% usage", () => {
		expect(shouldForceCompact(180000, 200000, 90)).toBe(true);
	});

	it("does NOT force compact below threshold", () => {
		expect(shouldForceCompact(160000, 200000, 90)).toBe(false);
	});

	it("forces compact at exactly the threshold boundary", () => {
		expect(shouldForceCompact(180000, 200000, 90)).toBe(true);
	});

	it("does NOT force compact when tokens unknown", () => {
		expect(shouldForceCompact(null, 200000, 90)).toBe(false);
	});
});
