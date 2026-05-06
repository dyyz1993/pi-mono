import { describe, expect, test } from "vitest";

function formatTokenCount(count: number): string {
	if (count >= 1_000_000) {
		const millions = count / 1_000_000;
		return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
	}
	if (count >= 1_000) {
		const thousands = count / 1_000;
		return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
	}
	return count.toString();
}

describe("formatTokenCount", () => {
	test("formats 0", () => {
		expect(formatTokenCount(0)).toBe("0");
	});

	test("formats 1", () => {
		expect(formatTokenCount(1)).toBe("1");
	});

	test("formats 999", () => {
		expect(formatTokenCount(999)).toBe("999");
	});

	test("formats 1000 as 1K", () => {
		expect(formatTokenCount(1000)).toBe("1K");
	});

	test("formats 1500 as 1.5K", () => {
		expect(formatTokenCount(1500)).toBe("1.5K");
	});

	test("formats 200000 as 200K", () => {
		expect(formatTokenCount(200000)).toBe("200K");
	});

	test("formats 1000000 as 1M", () => {
		expect(formatTokenCount(1000000)).toBe("1M");
	});

	test("formats 1500000 as 1.5M", () => {
		expect(formatTokenCount(1500000)).toBe("1.5M");
	});

	test("formats 10000000 as 10M", () => {
		expect(formatTokenCount(10000000)).toBe("10M");
	});

	test("formats negative numbers", () => {
		expect(formatTokenCount(-1)).toBe("-1");
	});

	test("formats -1000 as -1000 (no suffix for negatives)", () => {
		expect(formatTokenCount(-1000)).toBe("-1000");
	});

	test("formats 1234 as 1.2K", () => {
		expect(formatTokenCount(1234)).toBe("1.2K");
	});

	test("formats 1234567 as 1.2M", () => {
		expect(formatTokenCount(1234567)).toBe("1.2M");
	});
});
