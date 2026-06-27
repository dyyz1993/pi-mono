import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";

const OLD_ENV = {
	PI_MODEL_PROXY_URL: process.env.PI_MODEL_PROXY_URL,
	PI_MODEL_PROXY_TOKEN: process.env.PI_MODEL_PROXY_TOKEN,
	PI_MODEL_PROXY_MODELS_JSON: process.env.PI_MODEL_PROXY_MODELS_JSON,
};

function restoreEnv(): void {
	for (const [key, value] of Object.entries(OLD_ENV)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

describe("model proxy runtime", () => {
	afterEach(() => {
		restoreEnv();
	});

	it("loads proxy-provided models without remote auth files", async () => {
		process.env.PI_MODEL_PROXY_URL = "http://127.0.0.1:42000";
		process.env.PI_MODEL_PROXY_TOKEN = "session-token";
		process.env.PI_MODEL_PROXY_MODELS_JSON = JSON.stringify([
			{
				id: "model-a",
				name: "Model A",
				api: "openai-responses",
				provider: "provider-a",
				baseUrl: "https://api.example.test/v1",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
			},
		]);

		const registry = ModelRegistry.create(AuthStorage.inMemory({}), "/tmp/does-not-exist-models.json");
		const available = registry.getAvailable();

		expect(available).toHaveLength(1);
		expect(available[0].provider).toBe("provider-a");
		expect(available[0].baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:42000\/proxy\//);
		expect(available[0].headers).toMatchObject({
			"x-pi-model-proxy-token": "session-token",
			"x-pi-model-proxy-provider": "provider-a",
			"x-pi-model-proxy-model": "model-a",
			"x-pi-model-proxy-api": "openai-responses",
		});

		const auth = await registry.getApiKeyAndHeaders(available[0]);
		expect(auth).toEqual({
			ok: true,
			apiKey: "pi-model-proxy-placeholder",
			headers: expect.objectContaining({
				"x-pi-model-proxy-token": "session-token",
				"x-pi-model-proxy-provider": "provider-a",
				"x-pi-model-proxy-model": "model-a",
				"x-pi-model-proxy-api": "openai-responses",
			}),
		});
	});
});
