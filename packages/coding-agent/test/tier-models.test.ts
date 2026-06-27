import type { Api, Model } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import { normalizeTierModelsForAvailableModels } from "../src/core/tier-models.ts";

function model(input: Partial<Model<Api>> & Pick<Model<Api>, "provider" | "id" | "name">): Model<Api> {
	return {
		api: "openai-completions",
		baseUrl: "https://example.com",
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 100_000,
		maxTokens: 8_000,
		reasoning: false,
		...input,
	};
}

describe("normalizeTierModelsForAvailableModels", () => {
	it("keeps tier mappings that are still available", () => {
		const available = [
			model({ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }),
			model({ provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true }),
		];
		const normalized = normalizeTierModelsForAvailableModels(
			{
				fast: "deepseek/deepseek-v4-flash",
				pro: "deepseek/deepseek-v4-pro",
				max: "deepseek/deepseek-v4-pro",
			},
			available,
		);
		expect(normalized.fast).toBe("deepseek/deepseek-v4-flash");
		expect(normalized.pro).toBe("deepseek/deepseek-v4-pro");
		expect(normalized.max).toBe("deepseek/deepseek-v4-pro");
	});

	it("replaces unavailable defaults with available proxy models", () => {
		const available = [
			model({ provider: "opencode-go", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }),
			model({
				provider: "deepseek",
				id: "deepseek-v4-pro",
				name: "DeepSeek V4 Pro",
				reasoning: true,
				contextWindow: 1_000_000,
				maxTokens: 384_000,
			}),
		];
		const normalized = normalizeTierModelsForAvailableModels(
			{
				fast: "openai-codex/gpt-5.5-codex-mini",
				pro: "openai-codex/gpt-5.5",
				max: "anthropic/claude-opus-4-8",
			},
			available,
		);
		expect(normalized.fast).toBe("opencode-go/deepseek-v4-flash");
		expect(normalized.pro).toBe("deepseek/deepseek-v4-pro");
		expect(normalized.max).toBe("deepseek/deepseek-v4-pro");
	});
});
