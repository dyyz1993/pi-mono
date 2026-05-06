import { describe, expect, it } from "vitest";
import {
	type Api,
	calculateCost,
	getModel,
	getModels,
	getProviders,
	type Model,
	modelsAreEqual,
	supportsXhigh,
	type Usage,
} from "../src/index.js";

function makeUsage(overrides?: Partial<Usage["cost"]>): Usage {
	return {
		input: 1000,
		output: 500,
		cacheRead: 100,
		cacheWrite: 200,
		totalTokens: 1800,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
			...overrides,
		},
	};
}

describe("getModel", () => {
	it("returns model for known provider and model ID", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		expect(model).toBeDefined();
		expect(model.id).toBe("claude-opus-4-6");
		expect(model.provider).toBe("anthropic");
	});

	it("returns undefined for unknown model ID", () => {
		const model = getModel("anthropic", "nonexistent-model" as any);
		expect(model).toBeUndefined();
	});
});

describe("getProviders", () => {
	it("returns array of provider names including known providers", () => {
		const providers = getProviders();
		expect(providers.length).toBeGreaterThan(0);
		expect(providers).toContain("anthropic");
		expect(providers).toContain("openai");
	});
});

describe("getModels", () => {
	it("returns models for a known provider", () => {
		const models = getModels("anthropic");
		expect(models.length).toBeGreaterThan(0);
		expect(models.every((m) => m.provider === "anthropic")).toBe(true);
	});

	it("returns empty array for unknown provider", () => {
		const models = getModels("nonexistent" as any);
		expect(models).toEqual([]);
	});
});

describe("calculateCost", () => {
	it("calculates cost from token usage and model pricing", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		const usage = makeUsage();
		const cost = calculateCost(model, usage);

		const expectedInput = (model.cost.input / 1000000) * 1000;
		const expectedOutput = (model.cost.output / 1000000) * 500;
		const expectedCacheRead = (model.cost.cacheRead / 1000000) * 100;
		const expectedCacheWrite = (model.cost.cacheWrite / 1000000) * 200;

		expect(cost.input).toBeCloseTo(expectedInput, 10);
		expect(cost.output).toBeCloseTo(expectedOutput, 10);
		expect(cost.cacheRead).toBeCloseTo(expectedCacheRead, 10);
		expect(cost.cacheWrite).toBeCloseTo(expectedCacheWrite, 10);
		expect(cost.total).toBeCloseTo(expectedInput + expectedOutput + expectedCacheRead + expectedCacheWrite, 10);
	});

	it("returns 0 cost for zero tokens", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		const usage = makeUsage();
		usage.input = 0;
		usage.output = 0;
		usage.cacheRead = 0;
		usage.cacheWrite = 0;
		usage.totalTokens = 0;

		const cost = calculateCost(model, usage);
		expect(cost.total).toBe(0);
		expect(cost.input).toBe(0);
		expect(cost.output).toBe(0);
	});

	it("mutates the usage object in place", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		const usage = makeUsage();
		const cost = calculateCost(model, usage);
		expect(usage.cost).toBe(cost);
	});
});

describe("modelsAreEqual", () => {
	it("returns true for same model reference", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		expect(modelsAreEqual(model, model)).toBe(true);
	});

	it("returns true for two models with same id and provider", () => {
		const a = getModel("anthropic", "claude-opus-4-6");
		const b = getModel("anthropic", "claude-opus-4-6");
		expect(modelsAreEqual(a, b)).toBe(true);
	});

	it("returns false for different models", () => {
		const a = getModel("anthropic", "claude-opus-4-6");
		const b = getModel("anthropic", "claude-sonnet-4-20250514");
		expect(modelsAreEqual(a, b)).toBe(false);
	});

	it("returns false if either model is null", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		expect(modelsAreEqual(null, model)).toBe(false);
		expect(modelsAreEqual(model, null)).toBe(false);
	});

	it("returns false if both models are undefined", () => {
		expect(modelsAreEqual(undefined, undefined)).toBe(false);
	});
});

describe("supportsXhigh", () => {
	it("returns true for opus-4-6 model", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		expect(supportsXhigh(model)).toBe(true);
	});

	it("returns false for sonnet model", () => {
		const model = getModel("anthropic", "claude-sonnet-4-20250514");
		expect(supportsXhigh(model)).toBe(false);
	});

	it("returns boolean for any model", () => {
		const models = getModels("anthropic");
		for (const model of models) {
			expect(typeof supportsXhigh(model)).toBe("boolean");
		}
	});
});
