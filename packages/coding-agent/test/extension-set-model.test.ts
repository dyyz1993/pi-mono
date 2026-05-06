import type { Model } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../src/core/extensions/index.js";
import { createHarnessWithExtensions, type Harness } from "./test-harness.js";

const FAUX_ALT_PROVIDER = {
	baseUrl: "https://faux-alt.example.com",
	apiKey: "faux-alt-key",
	api: "anthropic-messages" as const,
	models: [
		{
			id: "faux-alt",
			name: "Faux Alt",
			reasoning: false,
			input: ["text"] as const,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		},
	],
};

describe("Extension pi.setModel()", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("changes the session model via extension API and returns true", async () => {
		let extensionApi: ExtensionAPI | undefined;

		harness = await createHarnessWithExtensions({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});

		harness.session.modelRegistry.registerProvider("faux-alt", FAUX_ALT_PROVIDER);

		const target = harness.session.modelRegistry.find("faux-alt", "faux-alt")!;
		expect(target).toBeDefined();

		const result = await extensionApi!.setModel(target);

		expect(result).toBe(true);
		expect(harness.session.model?.id).toBe("faux-alt");
		expect(harness.session.model?.provider).toBe("faux-alt");
	});

	it("returns false for model without configured auth", async () => {
		let extensionApi: ExtensionAPI | undefined;

		harness = await createHarnessWithExtensions({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});

		const noAuthModel: Model<"anthropic-messages"> = {
			id: "no-auth-model",
			name: "No Auth Model",
			api: "anthropic-messages",
			provider: "no-auth-provider",
			baseUrl: "https://no-auth.example.com",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};

		const result = await extensionApi!.setModel(noAuthModel);

		expect(result).toBe(false);
		expect(harness.session.model?.id).toBe("faux-1");
	});

	it("emits model_select event with source 'set' to extension listeners", async () => {
		let extensionApi: ExtensionAPI | undefined;
		const modelEvents: Array<{ previousId: string | undefined; newId: string; source: string }> = [];

		harness = await createHarnessWithExtensions({
			extensionFactories: [
				(pi) => {
					pi.on("model_select", async (event: any) => {
						modelEvents.push({
							previousId: event.previousModel?.id,
							newId: event.model.id,
							source: event.source,
						});
					});
				},
				(pi) => {
					extensionApi = pi;
				},
			],
		});

		harness.session.modelRegistry.registerProvider("faux-alt", FAUX_ALT_PROVIDER);

		const target = harness.session.modelRegistry.find("faux-alt", "faux-alt")!;
		await extensionApi!.setModel(target);

		expect(modelEvents).toHaveLength(1);
		expect(modelEvents[0]).toEqual({
			previousId: "faux-1",
			newId: "faux-alt",
			source: "set",
		});
	});

	it("persists the model change to settings", async () => {
		let extensionApi: ExtensionAPI | undefined;

		harness = await createHarnessWithExtensions({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});

		harness.session.modelRegistry.registerProvider("faux-alt", FAUX_ALT_PROVIDER);

		const target = harness.session.modelRegistry.find("faux-alt", "faux-alt")!;
		await extensionApi!.setModel(target);

		expect(harness.settingsManager.getDefaultProvider()).toBe("faux-alt");
		expect(harness.settingsManager.getDefaultModel()).toBe("faux-alt");
	});

	it("records model_change in session manager entries", async () => {
		let extensionApi: ExtensionAPI | undefined;

		harness = await createHarnessWithExtensions({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});

		harness.session.modelRegistry.registerProvider("faux-alt", FAUX_ALT_PROVIDER);

		const target = harness.session.modelRegistry.find("faux-alt", "faux-alt")!;
		await extensionApi!.setModel(target);

		const modelChanges = harness.sessionManager.getEntries().filter((entry) => entry.type === "model_change");

		expect(modelChanges).toHaveLength(1);
		expect(modelChanges[0]).toMatchObject({
			type: "model_change",
			provider: "faux-alt",
			modelId: "faux-alt",
		});
	});
});
