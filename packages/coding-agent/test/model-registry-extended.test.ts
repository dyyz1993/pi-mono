import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@dyyz1993/pi-ai";
import { registerOAuthProvider } from "@dyyz1993/pi-ai/oauth";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { clearApiKeyCache, ModelRegistry } from "../src/core/model-registry.js";

describe("ModelRegistry (extended)", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-model-registry-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = join(tempDir, "models.json");
		authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
		clearApiKeyCache();
	});

	function writeRawModelsJson(providers: Record<string, unknown>) {
		writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
	}

	describe("isUsingOAuth()", () => {
		test("returns true when provider has oauth credentials", () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			authStorage.set("anthropic", {
				type: "oauth",
				access: "test-access-token",
				refresh: "test-refresh-token",
				expires: Date.now() + 60_000,
			});

			const model = registry.getAll().find((m) => m.provider === "anthropic");
			expect(model).toBeDefined();
			expect(registry.isUsingOAuth(model!)).toBe(true);
		});

		test("returns false when provider has api_key credentials", () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			authStorage.set("anthropic", {
				type: "api_key",
				key: "sk-test-key",
			});

			const model = registry.getAll().find((m) => m.provider === "anthropic");
			expect(model).toBeDefined();
			expect(registry.isUsingOAuth(model!)).toBe(false);
		});

		test("returns false when provider has no credentials", () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			const model = registry.getAll().find((m) => m.provider === "anthropic");
			expect(model).toBeDefined();
			expect(registry.isUsingOAuth(model!)).toBe(false);
		});
	});

	describe("getApiKeyForProvider() fallback to auth storage", () => {
		test("returns key from auth storage when no provider config exists", async () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			authStorage.set("openai", {
				type: "api_key",
				key: "auth-storage-key",
			});

			const key = await registry.getApiKeyForProvider("openai");
			expect(key).toBe("auth-storage-key");
		});

		test("prefers auth storage over provider config apiKey", async () => {
			writeRawModelsJson({
				openai: {
					apiKey: "config-key",
				},
			});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			authStorage.set("openai", {
				type: "api_key",
				key: "auth-storage-key",
			});

			const key = await registry.getApiKeyForProvider("openai");
			expect(key).toBe("auth-storage-key");
		});

		test("returns undefined when neither auth storage nor provider config has key", async () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			const key = await registry.getApiKeyForProvider("unknown-provider");
			expect(key).toBeUndefined();
		});

		test("falls back to provider config apiKey when auth storage has no key", async () => {
			writeRawModelsJson({
				"custom-provider": {
					baseUrl: "https://example.com/v1",
					apiKey: "provider-config-key",
					api: "openai-completions",
					models: [
						{
							id: "test-model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 100000,
							maxTokens: 8000,
						},
					],
				},
			});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			const key = await registry.getApiKeyForProvider("custom-provider");
			expect(key).toBe("provider-config-key");
		});
	});

	describe("registerProvider() with OAuth modifyModels callback", () => {
		test("modifyModels is called when OAuth credentials exist", () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			authStorage.set("test-oauth-provider", {
				type: "oauth",
				access: "test-access",
				refresh: "test-refresh",
				expires: Date.now() + 60_000,
			});

			let modifyModelsCalled = false;
			registry.registerProvider("test-oauth-provider", {
				baseUrl: "https://example.com/v1",
				apiKey: "test-key",
				api: "openai-completions",
				oauth: {
					name: "Test OAuth Provider",
					login: async () => ({
						access: "login-access",
						refresh: "login-refresh",
						expires: Date.now() + 60_000,
					}),
					refreshToken: async (cred) => cred,
					getApiKey: (cred) => cred.access,
					modifyModels: (models) => {
						modifyModelsCalled = true;
						return models.map((m: Model<Api>) =>
							m.provider === "test-oauth-provider"
								? { ...m, baseUrl: "https://oauth-modified.example.com/v1" }
								: m,
						);
					},
				},
				models: [
					{
						id: "oauth-model",
						name: "OAuth Model",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 100000,
						maxTokens: 8000,
					},
				],
			});

			expect(modifyModelsCalled).toBe(true);
			const model = registry.find("test-oauth-provider", "oauth-model");
			expect(model).toBeDefined();
			expect(model?.baseUrl).toBe("https://oauth-modified.example.com/v1");
		});

		test("modifyModels is NOT called when no OAuth credentials exist", () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			let modifyModelsCalled = false;
			registry.registerProvider("test-oauth-provider-no-cred", {
				baseUrl: "https://example.com/v1",
				apiKey: "test-key",
				api: "openai-completions",
				oauth: {
					name: "Test OAuth Provider No Cred",
					login: async () => ({
						access: "login-access",
						refresh: "login-refresh",
						expires: Date.now() + 60_000,
					}),
					refreshToken: async (cred) => cred,
					getApiKey: (cred) => cred.access,
					modifyModels: (models) => {
						modifyModelsCalled = true;
						return models;
					},
				},
				models: [
					{
						id: "oauth-model-no-cred",
						name: "OAuth Model No Cred",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 100000,
						maxTokens: 8000,
					},
				],
			});

			expect(modifyModelsCalled).toBe(false);
			const model = registry.find("test-oauth-provider-no-cred", "oauth-model-no-cred");
			expect(model).toBeDefined();
			expect(model?.baseUrl).toBe("https://example.com/v1");
		});

		test("registerProvider with OAuth but no modifyModels does not crash", () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			authStorage.set("simple-oauth", {
				type: "oauth",
				access: "test-access",
				refresh: "test-refresh",
				expires: Date.now() + 60_000,
			});

			expect(() =>
				registry.registerProvider("simple-oauth", {
					baseUrl: "https://example.com/v1",
					apiKey: "test-key",
					api: "openai-completions",
					oauth: {
						name: "Simple OAuth",
						login: async () => ({
							access: "login-access",
							refresh: "login-refresh",
							expires: Date.now() + 60_000,
						}),
						refreshToken: async (cred) => cred,
						getApiKey: (cred) => cred.access,
					},
					models: [
						{
							id: "simple-model",
							name: "Simple Model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 100000,
							maxTokens: 8000,
						},
					],
				}),
			).not.toThrow();

			expect(registry.find("simple-oauth", "simple-model")).toBeDefined();
		});
	});

	describe("validateProviderConfig() streamSimple without api", () => {
		test("throws when streamSimple is set without api", () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(() =>
				registry.registerProvider("no-api-stream", {
					streamSimple: () => {
						throw new Error("should not run");
					},
				} as any),
			).toThrow('Provider no-api-stream: "api" is required when registering streamSimple.');
		});

		test("succeeds when streamSimple has api", () => {
			writeRawModelsJson({});
			const registry = ModelRegistry.create(authStorage, modelsJsonPath);

			expect(() =>
				registry.registerProvider("with-api-stream", {
					api: "openai-completions",
					streamSimple: () => {
						throw new Error("custom-stream");
					},
				}),
			).not.toThrow();
		});
	});

	describe("mergeCompat() deep merge with both openRouterRouting AND vercelGatewayRouting", () => {
		test("deep merges both routing objects from provider-level compat", () => {
			writeRawModelsJson({
				openrouter: {
					compat: {
						openRouterRouting: { order: ["anthropic"] },
						vercelGatewayRouting: { only: ["provider-a"] },
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const models = registry.getAll().filter((m) => m.provider === "openrouter");

			for (const model of models) {
				const compat = model.compat as Record<string, unknown> | undefined;
				expect(compat?.openRouterRouting).toEqual({ order: ["anthropic"] });
				expect(compat?.vercelGatewayRouting).toEqual({ only: ["provider-a"] });
			}
		});

		test("model override deep merges routing into existing provider compat", () => {
			writeRawModelsJson({
				openrouter: {
					compat: {
						openRouterRouting: { order: ["anthropic"], allow_fallbacks: true },
						vercelGatewayRouting: { only: ["provider-a"] },
					},
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							compat: {
								openRouterRouting: { only: ["amazon-bedrock"] },
								vercelGatewayRouting: { order: ["provider-b"] },
							},
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const sonnet = registry.find("openrouter", "anthropic/claude-sonnet-4");
			const compat = sonnet?.compat as Record<string, unknown> | undefined;

			expect(compat?.openRouterRouting).toEqual({
				order: ["anthropic"],
				allow_fallbacks: true,
				only: ["amazon-bedrock"],
			});
			expect(compat?.vercelGatewayRouting).toEqual({
				only: ["provider-a"],
				order: ["provider-b"],
			});
		});

		test("vercelGatewayRouting only in model override merges cleanly", () => {
			writeRawModelsJson({
				openrouter: {
					modelOverrides: {
						"anthropic/claude-sonnet-4": {
							compat: {
								vercelGatewayRouting: { order: ["vercel-provider"] },
							},
						},
					},
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const sonnet = registry.find("openrouter", "anthropic/claude-sonnet-4");
			const compat = sonnet?.compat as Record<string, unknown> | undefined;

			expect(compat?.vercelGatewayRouting).toEqual({ order: ["vercel-provider"] });
		});

		test("custom model with both routing types in compat", () => {
			writeRawModelsJson({
				demo: {
					baseUrl: "https://example.com/v1",
					apiKey: "DEMO_KEY",
					api: "openai-completions",
					models: [
						{
							id: "demo-routing-model",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1000,
							maxTokens: 100,
							compat: {
								openRouterRouting: { only: ["route-a"] },
								vercelGatewayRouting: { order: ["vercel-a"] },
							},
						},
					],
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			expect(registry.getError()).toBeUndefined();

			const model = registry.find("demo", "demo-routing-model");
			const compat = model?.compat as Record<string, unknown> | undefined;
			expect(compat?.openRouterRouting).toEqual({ only: ["route-a"] });
			expect(compat?.vercelGatewayRouting).toEqual({ order: ["vercel-a"] });
		});
	});

	describe("OAuth modifyModels path in loadModels()", () => {
		test("modifyModels in auth storage OAuth provider is applied during loadModels", () => {
			writeRawModelsJson({});

			registerOAuthProvider({
				id: "anthropic" as any,
				name: "Test Anthropic OAuth",
				login: async () => ({
					access: "test-access",
					refresh: "test-refresh",
					expires: Date.now() + 60_000,
				}),
				refreshToken: async (cred: any) => cred,
				getApiKey: (cred: any) => cred.access,
				modifyModels: (models: Model<Api>[]) =>
					models.map((m) =>
						m.provider === "anthropic" ? { ...m, baseUrl: "https://oauth-loadmodified.example.com/v1" } : m,
					),
			});

			authStorage.set("anthropic", {
				type: "oauth",
				access: "stored-access",
				refresh: "stored-refresh",
				expires: Date.now() + 60_000,
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const anthropicModels = registry.getAll().filter((m) => m.provider === "anthropic");

			expect(anthropicModels.length).toBeGreaterThan(0);
			for (const model of anthropicModels) {
				expect(model.baseUrl).toBe("https://oauth-loadmodified.example.com/v1");
			}
		});

		test("modifyModels is not called for providers without oauth credentials", () => {
			writeRawModelsJson({});

			let modifyCalled = false;
			registerOAuthProvider({
				id: "google" as any,
				name: "Test Google OAuth",
				login: async () => ({
					access: "test-access",
					refresh: "test-refresh",
					expires: Date.now() + 60_000,
				}),
				refreshToken: async (cred: any) => cred,
				getApiKey: (cred: any) => cred.access,
				modifyModels: (models: Model<Api>[]) => {
					modifyCalled = true;
					return models;
				},
			});

			const registry = ModelRegistry.create(authStorage, modelsJsonPath);
			const googleModels = registry.getAll().filter((m) => m.provider === "google");

			expect(googleModels.length).toBeGreaterThan(0);
			expect(modifyCalled).toBe(false);
		});
	});
});
