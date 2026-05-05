import { fauxAssistantMessage, registerFauxProvider } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.js";
import { createHarness as createTopHarness } from "./test-harness.js";

const ANTHROPIC_MODELS = [
	{
		id: "claude-haiku-4",
		name: "Claude Haiku 4",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "claude-sonnet-4-20250514",
		name: "Claude Sonnet 4",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
	{
		id: "claude-opus-4-6",
		name: "Claude Opus 4.6",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 32768,
	},
];

function registerAnthropic(harness: ReturnType<typeof createTopHarness>) {
	harness.session.modelRegistry.registerProvider("anthropic", {
		baseUrl: "https://api.anthropic.com",
		apiKey: "test-key",
		api: "anthropic-messages",
		models: ANTHROPIC_MODELS,
	});
}

describe("_resolveOptionalModel", () => {
	let harness: ReturnType<typeof createTopHarness>;

	afterEach(() => {
		harness?.cleanup();
	});

	it("returns session model when no modelSpec provided", async () => {
		harness = createTopHarness();
		const result = await (harness.session as any)._resolveOptionalModel();
		expect(result).toBe(harness.session.model);
	});

	it("returns session model when modelSpec is undefined", async () => {
		harness = createTopHarness();
		const result = await (harness.session as any)._resolveOptionalModel(undefined);
		expect(result).toBe(harness.session.model);
	});

	it("returns session model when modelSpec is empty string", async () => {
		harness = createTopHarness();
		const result = await (harness.session as any)._resolveOptionalModel("");
		expect(result).toBe(harness.session.model);
	});

	it("resolves 'fast' alias to haiku when provider registered", async () => {
		harness = createTopHarness();
		registerAnthropic(harness);
		const result = await (harness.session as any)._resolveOptionalModel("fast");
		expect(result.id).toBe("claude-haiku-4");
		expect(result.provider).toBe("anthropic");
	});

	it("resolves 'pro' alias to sonnet when provider registered", async () => {
		harness = createTopHarness();
		registerAnthropic(harness);
		const result = await (harness.session as any)._resolveOptionalModel("pro");
		expect(result.id).toBe("claude-sonnet-4-20250514");
	});

	it("resolves 'max' alias to opus when provider registered", async () => {
		harness = createTopHarness();
		registerAnthropic(harness);
		const result = await (harness.session as any)._resolveOptionalModel("max");
		expect(result.id).toBe("claude-opus-4-6");
	});

	it("uses session-level tierModels override when set", async () => {
		harness = createTopHarness();
		registerAnthropic(harness);
		harness.session.setTierModels({ fast: "anthropic/claude-opus-4-6" });
		const result = await (harness.session as any)._resolveOptionalModel("fast");
		expect(result.id).toBe("claude-opus-4-6");
	});

	it("resolves provider/modelId format directly", async () => {
		harness = createTopHarness();
		registerAnthropic(harness);
		const result = await (harness.session as any)._resolveOptionalModel("anthropic/claude-sonnet-4-20250514");
		expect(result.id).toBe("claude-sonnet-4-20250514");
		expect(result.provider).toBe("anthropic");
	});

	it("resolves bare modelId by searching available models", async () => {
		harness = createTopHarness();
		registerAnthropic(harness);
		const result = await (harness.session as any)._resolveOptionalModel("claude-opus-4-6");
		expect(result.id).toBe("claude-opus-4-6");
	});

	it("falls back to session model when alias resolves but provider not registered", async () => {
		harness = createTopHarness();
		const result = await (harness.session as any)._resolveOptionalModel("fast");
		expect(result).toBe(harness.session.model);
	});

	it("falls back to session model when model not found in registry", async () => {
		harness = createTopHarness();
		const result = await (harness.session as any)._resolveOptionalModel("nonexistent/model");
		expect(result).toBe(harness.session.model);
	});

	it("resolves aliases case-insensitively", async () => {
		harness = createTopHarness();
		registerAnthropic(harness);
		const result = await (harness.session as any)._resolveOptionalModel("FAST");
		expect(result.id).toBe("claude-haiku-4");
	});
});

describe("callLLM with model parameter", () => {
	let harness: Harness;
	let aliasFaux: ReturnType<typeof registerFauxProvider> | undefined;

	afterEach(() => {
		harness?.cleanup();
		aliasFaux?.unregister();
		aliasFaux = undefined;
	});

	it("uses session model when model param not specified", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("response text")]);

		const result = await harness.session.callLLM({
			messages: [{ role: "user", content: "hello" }],
		});
		expect(typeof result).toBe("string");
		expect(harness.faux.state.callCount).toBeGreaterThanOrEqual(1);
	});

	it("uses resolved model when model param is an alias mapped via tierModels", async () => {
		harness = await createHarness();
		aliasFaux = registerFauxProvider({
			provider: "alias-provider",
			models: [{ id: "alias-haiku", name: "Alias Haiku" }],
		});
		aliasFaux.setResponses([fauxAssistantMessage("fast response")]);

		harness.session.modelRegistry.registerProvider("alias-provider", {
			baseUrl: "http://localhost:0",
			apiKey: "test-key",
			api: aliasFaux.api,
			models: [
				{
					id: "alias-haiku",
					name: "Alias Haiku",
					reasoning: false,
					input: ["text"] as ("text" | "image")[],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 16384,
				},
			],
		});

		harness.session.setTierModels({ fast: "alias-provider/alias-haiku" });

		const result = await harness.session.callLLM({
			model: "fast",
			messages: [{ role: "user", content: "hello" }],
		});
		expect(result).toBe("fast response");
		expect(aliasFaux.state.callCount).toBe(1);
	});

	it("falls back to session model when specified model not found", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("fallback response")]);

		const result = await harness.session.callLLM({
			model: "nonexistent-model",
			messages: [{ role: "user", content: "hello" }],
		});
		expect(typeof result).toBe("string");
		expect(harness.faux.state.callCount).toBeGreaterThanOrEqual(1);
	});
});

describe("forkAgent with model parameter", () => {
	let harness: Harness;
	let aliasFaux: ReturnType<typeof registerFauxProvider> | undefined;

	afterEach(() => {
		harness?.cleanup();
		aliasFaux?.unregister();
		aliasFaux = undefined;
	});

	it("uses session model when model param not specified", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("fork result")]);

		const result = await harness.session.forkAgent("do something");
		expect(result.text).toBeDefined();
		expect(typeof result.text).toBe("string");
	});

	it("uses resolved model when model param is an alias mapped via tierModels", async () => {
		harness = await createHarness();
		aliasFaux = registerFauxProvider({
			provider: "alias-provider",
			models: [{ id: "alias-haiku", name: "Alias Haiku" }],
		});
		aliasFaux.setResponses([fauxAssistantMessage("fork result with model")]);

		harness.session.modelRegistry.registerProvider("alias-provider", {
			baseUrl: "http://localhost:0",
			apiKey: "test-key",
			api: aliasFaux.api,
			models: [
				{
					id: "alias-haiku",
					name: "Alias Haiku",
					reasoning: false,
					input: ["text"] as ("text" | "image")[],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 16384,
				},
			],
		});

		harness.session.setTierModels({ fast: "alias-provider/alias-haiku" });

		const result = await harness.session.forkAgent("do something", {
			model: "fast",
		});
		expect(result.text).toBe("fork result with model");
		expect(aliasFaux.state.callCount).toBe(1);
	});

	it("falls back to session model when specified model not found", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("fallback fork result")]);

		const result = await harness.session.forkAgent("do something", {
			model: "nonexistent-model",
		});
		expect(result.text).toBeDefined();
	});
});
