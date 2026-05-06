import { describe, expect, it } from "vitest";
import { formatCost, formatModelCost, formatTokenCount, formatUsage } from "../src/utils/format.js";

vi.mock("@mariozechner/mini-lit", () => ({
	i18n: (key: string) => key,
}));

describe("formatCost", () => {
	it("formats cost with 4 decimal places", () => {
		expect(formatCost(0.1234)).toBe("$0.1234");
	});

	it("formats zero cost", () => {
		expect(formatCost(0)).toBe("$0.0000");
	});

	it("formats large cost", () => {
		expect(formatCost(123.4567)).toBe("$123.4567");
	});

	it("pads to 4 decimals", () => {
		expect(formatCost(1.1)).toBe("$1.1000");
	});
});

describe("formatTokenCount", () => {
	it("returns count as-is below 1000", () => {
		expect(formatTokenCount(0)).toBe("0");
		expect(formatTokenCount(999)).toBe("999");
	});

	it("formats 1k-9.9k with one decimal", () => {
		expect(formatTokenCount(1000)).toBe("1.0k");
		expect(formatTokenCount(1500)).toBe("1.5k");
		expect(formatTokenCount(9999)).toBe("10.0k");
	});

	it("formats 10k+ as rounded k", () => {
		expect(formatTokenCount(10000)).toBe("10k");
		expect(formatTokenCount(15500)).toBe("16k");
		expect(formatTokenCount(1000000)).toBe("1000k");
	});
});

describe("formatModelCost", () => {
	it("returns Free for falsy cost", () => {
		expect(formatModelCost(null)).toBe("Free");
		expect(formatModelCost(undefined)).toBe("Free");
		expect(formatModelCost(0)).toBe("Free");
	});

	it("returns Free when both input and output are 0", () => {
		expect(formatModelCost({ input: 0, output: 0 })).toBe("Free");
	});

	it("formats model cost with input/output", () => {
		expect(formatModelCost({ input: 3, output: 15 })).toBe("$3/$15");
	});

	it("formats small numbers with 3 decimal precision", () => {
		expect(formatModelCost({ input: 0.5, output: 1.5 })).toBe("$0.5/$1.5");
	});

	it("formats numbers >= 100 with no decimals", () => {
		expect(formatModelCost({ input: 100, output: 200 })).toBe("$100/$200");
	});

	it("handles missing input or output fields by defaulting to 0", () => {
		expect(formatModelCost({ output: 5 })).toBe("$0/$5");
		expect(formatModelCost({ input: 5 })).toBe("$5/$0");
	});
});

describe("formatUsage", () => {
	it("returns empty string for falsy usage", () => {
		expect(formatUsage(null as any)).toBe("");
		expect(formatUsage(undefined as any)).toBe("");
	});

	it("formats input tokens", () => {
		expect(formatUsage({ input: 500 })).toBe("↑500");
	});

	it("formats output tokens", () => {
		expect(formatUsage({ output: 2000 })).toBe("↓2.0k");
	});

	it("formats cache read/write tokens", () => {
		expect(formatUsage({ cacheRead: 100, cacheWrite: 200 })).toBe("R100 W200");
	});

	it("formats cost", () => {
		expect(formatUsage({ cost: { total: 1.2345 } })).toBe("$1.2345");
	});

	it("formats all fields combined", () => {
		const result = formatUsage({
			input: 1000,
			output: 500,
			cacheRead: 200,
			cacheWrite: 100,
			cost: { total: 0.05 },
		});
		expect(result).toBe("↑1.0k ↓500 R200 W100 $0.0500");
	});
});
