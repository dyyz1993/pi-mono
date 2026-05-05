import type { Model } from "@dyyz1993/pi-ai";
import { describe, expect, test } from "vitest";
import { DEFAULT_TIER_ALIASES } from "../src/core/defaults.js";
import { findInitialModel, resolveCliModel, resolveModelAlias, resolveModelScope } from "../src/core/model-resolver.js";

const mockModels: Model<"anthropic-messages">[] = [
	{
		id: "claude-haiku-4",
		name: "Claude Haiku 4",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "claude-sonnet-4-20250514",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
	{
		id: "claude-opus-4-6",
		name: "Claude Opus 4.6",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 32768,
	},
	{
		id: "gpt-4o",
		name: "GPT-4o",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://api.openai.com",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
];

function makeRegistry(models: Model<"anthropic-messages">[] = mockModels) {
	return {
		getAll: () => models,
		getAvailable: () => Promise.resolve(models),
		find: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
		hasConfiguredAuth: () => true,
	};
}

describe("resolveModelAlias", () => {
	test("resolves 'fast' to default haiku model", () => {
		const result = resolveModelAlias("fast");
		expect(result).toBe("anthropic/claude-haiku-4");
	});

	test("resolves 'pro' to default sonnet model", () => {
		const result = resolveModelAlias("pro");
		expect(result).toBe("anthropic/claude-sonnet-4-20250514");
	});

	test("resolves 'max' to default opus model", () => {
		const result = resolveModelAlias("max");
		expect(result).toBe("anthropic/claude-opus-4-6");
	});

	test("returns undefined for non-alias strings", () => {
		expect(resolveModelAlias("claude-sonnet-4")).toBeUndefined();
		expect(resolveModelAlias("gpt-4o")).toBeUndefined();
		expect(resolveModelAlias("some-random-string")).toBeUndefined();
	});

	test("case-insensitive: 'Fast', 'FAST', 'fast' all resolve", () => {
		expect(resolveModelAlias("Fast")).toBe("anthropic/claude-haiku-4");
		expect(resolveModelAlias("FAST")).toBe("anthropic/claude-haiku-4");
		expect(resolveModelAlias("Pro")).toBe("anthropic/claude-sonnet-4-20250514");
		expect(resolveModelAlias("MAX")).toBe("anthropic/claude-opus-4-6");
	});

	test("user tierModels override defaults", () => {
		const userMapping = { fast: "openai/gpt-4o" };
		const result = resolveModelAlias("fast", userMapping);
		expect(result).toBe("openai/gpt-4o");
	});

	test("partial user override: only overridden alias changes, others keep defaults", () => {
		const userMapping = { fast: "openai/gpt-4o" };
		expect(resolveModelAlias("fast", userMapping)).toBe("openai/gpt-4o");
		expect(resolveModelAlias("pro", userMapping)).toBe("anthropic/claude-sonnet-4-20250514");
		expect(resolveModelAlias("max", userMapping)).toBe("anthropic/claude-opus-4-6");
	});

	test("prevents infinite recursion: alias mapping to itself returns undefined", () => {
		const userMapping = { fast: "fast" };
		const result = resolveModelAlias("fast", userMapping);
		expect(result).toBeUndefined();
	});
});

describe("DEFAULT_TIER_ALIASES", () => {
	test("has exactly 3 entries: fast, pro, max", () => {
		expect(Object.keys(DEFAULT_TIER_ALIASES)).toEqual(["fast", "pro", "max"]);
	});

	test("all values are in provider/modelId format", () => {
		for (const value of Object.values(DEFAULT_TIER_ALIASES)) {
			expect(value).toContain("/");
		}
	});
});

describe("resolveCliModel with tier aliases", () => {
	const registry = makeRegistry();

	test("'--model fast' resolves to haiku via alias", () => {
		const result = resolveCliModel({
			cliModel: "fast",
			modelRegistry: registry as Parameters<typeof resolveCliModel>[0]["modelRegistry"],
			tierModels: DEFAULT_TIER_ALIASES,
		});
		expect(result.model).toBeDefined();
		expect(result.model?.id).toBe("claude-haiku-4");
	});

	test("'--model max' resolves to opus via alias", () => {
		const result = resolveCliModel({
			cliModel: "max",
			modelRegistry: registry as Parameters<typeof resolveCliModel>[0]["modelRegistry"],
			tierModels: DEFAULT_TIER_ALIASES,
		});
		expect(result.model).toBeDefined();
		expect(result.model?.id).toBe("claude-opus-4-6");
	});

	test("'--model fast:high' resolves alias then applies thinking level", () => {
		const result = resolveCliModel({
			cliModel: "fast:high",
			modelRegistry: registry as Parameters<typeof resolveCliModel>[0]["modelRegistry"],
			tierModels: DEFAULT_TIER_ALIASES,
		});
		expect(result.model).toBeDefined();
		expect(result.model?.id).toBe("claude-haiku-4");
		expect(result.thinkingLevel).toBe("high");
	});

	test("custom tierModels override in resolveCliModel", () => {
		const customMapping = { fast: "openai/gpt-4o" };
		const result = resolveCliModel({
			cliModel: "fast",
			modelRegistry: registry as Parameters<typeof resolveCliModel>[0]["modelRegistry"],
			tierModels: customMapping,
		});
		expect(result.model).toBeDefined();
		expect(result.model?.id).toBe("gpt-4o");
	});

	test("non-alias model string still works normally", () => {
		const result = resolveCliModel({
			cliModel: "claude-sonnet-4-20250514",
			modelRegistry: registry as Parameters<typeof resolveCliModel>[0]["modelRegistry"],
		});
		expect(result.model).toBeDefined();
		expect(result.model?.id).toBe("claude-sonnet-4-20250514");
	});
});

describe("resolveModelScope with tier aliases", () => {
	const registry = makeRegistry();

	test("tier aliases in enabledModels resolve correctly", async () => {
		const result = await resolveModelScope(
			["fast", "pro", "max"],
			registry as Parameters<typeof resolveModelScope>[1],
			DEFAULT_TIER_ALIASES,
		);
		expect(result.length).toBe(3);
		expect(result.map((r) => r.model.id)).toEqual(
			expect.arrayContaining(["claude-haiku-4", "claude-sonnet-4-20250514", "claude-opus-4-6"]),
		);
	});

	test("mixed aliases and concrete model names", async () => {
		const result = await resolveModelScope(
			["fast", "claude-sonnet-4-20250514"],
			registry as Parameters<typeof resolveModelScope>[1],
			DEFAULT_TIER_ALIASES,
		);
		expect(result.length).toBe(2);
	});
});

describe("findInitialModel with tier aliases", () => {
	const registry = makeRegistry();

	test("resolves alias as defaultModelId", async () => {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: "anthropic",
			defaultModelId: "fast",
			modelRegistry: registry as Parameters<typeof findInitialModel>[0]["modelRegistry"],
			tierModels: DEFAULT_TIER_ALIASES,
		});
		expect(result.model).toBeDefined();
		expect(result.model?.id).toBe("claude-haiku-4");
	});
});
