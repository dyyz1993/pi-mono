import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ollama/browser", () => ({
	Ollama: vi.fn(),
}));

vi.mock("@lmstudio/sdk", () => ({
	LMStudioClient: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { discoverLlamaCppModels, discoverModels, discoverVLLMModels } from "../src/utils/model-discovery.js";

beforeEach(() => {
	mockFetch.mockReset();
});

describe("discoverLlamaCppModels", () => {
	it("discovers models from /v1/models endpoint", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [{ id: "model-a", context_length: 4096, max_tokens: 2048 }, { id: "model-b" }],
			}),
		});

		const models = await discoverLlamaCppModels("http://localhost:8080");
		expect(models).toHaveLength(2);
		expect(models[0].id).toBe("model-a");
		expect(models[0].baseUrl).toBe("http://localhost:8080/v1");
		expect(models[0].api).toBe("openai-completions");
		expect(models[0].contextWindow).toBe(4096);
		expect(models[1].contextWindow).toBe(8192);
	});

	it("sends authorization header when apiKey provided", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: [] }),
		});

		await discoverLlamaCppModels("http://localhost:8080", "my-key");
		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:8080/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer my-key" }),
			}),
		);
	});

	it("throws on non-ok response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
		});

		await expect(discoverLlamaCppModels("http://localhost:8080")).rejects.toThrow("llama.cpp discovery failed");
	});

	it("throws on invalid response format", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ notData: true }),
		});

		await expect(discoverLlamaCppModels("http://localhost:8080")).rejects.toThrow("Invalid response format");
	});
});

describe("discoverVLLMModels", () => {
	it("discovers models with max_model_len", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [{ id: "vllm-model", max_model_len: 32768 }],
			}),
		});

		const models = await discoverVLLMModels("http://localhost:8000");
		expect(models).toHaveLength(1);
		expect(models[0].contextWindow).toBe(32768);
		expect(models[0].maxTokens).toBe(4096);
		expect(models[0].baseUrl).toBe("http://localhost:8000/v1");
	});

	it("defaults contextWindow to 8192 when not provided", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				data: [{ id: "default-model" }],
			}),
		});

		const models = await discoverVLLMModels("http://localhost:8000");
		expect(models[0].contextWindow).toBe(8192);
	});
});

describe("discoverModels", () => {
	it("delegates to llama.cpp discovery", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: [{ id: "test" }] }),
		});

		const models = await discoverModels("llama.cpp", "http://localhost:8080");
		expect(models).toHaveLength(1);
	});

	it("delegates to vllm discovery", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ data: [{ id: "test" }] }),
		});

		const models = await discoverModels("vllm", "http://localhost:8000");
		expect(models).toHaveLength(1);
	});
});
