import { Agent } from "@dyyz1993/pi-agent-core";
import { getModel } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { summarizeProviderPayloadForContextUsage } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

describe("provider request context usage", () => {
	it("summarizes provider payload structure without storing raw prompt content", () => {
		const snapshot = summarizeProviderPayloadForContextUsage(
			{
				system: "secret system prompt",
				messages: [
					{ role: "user", content: "secret user request" },
					{
						role: "assistant",
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "bash", arguments: '{"cmd":"secret command"}' },
							},
						],
					},
					{ role: "tool", tool_call_id: "call_1", content: "secret command output" },
				],
				tools: [
					{ type: "function", function: { name: "read", description: "read files" } },
					{ type: "function", function: { name: "bash", description: "run commands" } },
				],
				stream: true,
				max_tokens: 4096,
			},
			model,
		);

		expect(snapshot.version).toBe(1);
		expect(snapshot.provider).toBe(model.provider);
		expect(snapshot.modelId).toBe(model.id);
		expect(snapshot.payloadChars).toBeGreaterThan(0);
		expect(snapshot.payloadTokens).toBeGreaterThan(0);
		expect(snapshot.topLevelKeys).toEqual(["max_tokens", "messages", "stream", "system", "tools"]);
		expect(snapshot.sections.find((section) => section.id === "messages")?.count).toBe(3);
		expect(snapshot.sections.find((section) => section.id === "tools")?.count).toBe(2);
		expect(snapshot.toolDefinitions?.map((tool) => tool.name).sort()).toEqual(["bash", "read"]);
		expect(snapshot.toolInteractions?.[0]).toMatchObject({
			name: "bash",
			inputCount: 1,
			outputCount: 1,
		});
		expect(JSON.stringify(snapshot)).not.toContain("secret system prompt");
		expect(JSON.stringify(snapshot)).not.toContain("secret user request");
		expect(JSON.stringify(snapshot)).not.toContain("secret command");
		expect(JSON.stringify(snapshot)).not.toContain("secret command output");
	});

	it("exposes the latest provider payload snapshot through context usage", () => {
		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.inMemory();
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const session = new AgentSession({
			agent: new Agent({
				getApiKey: () => "test-key",
				initialState: {
					model,
					systemPrompt: "You are a helpful assistant.",
					tools: [],
					thinkingLevel: "high",
				},
			}),
			sessionManager,
			settingsManager,
			cwd: process.cwd(),
			modelRegistry: ModelRegistry.inMemory(authStorage),
			resourceLoader: createTestResourceLoader(),
		});

		try {
			const snapshot = summarizeProviderPayloadForContextUsage(
				{ system: "first", messages: [{ role: "user", content: "hi" }] },
				model,
			);
			sessionManager.appendCustomEntry("provider_request_context_usage", snapshot);

			expect(session.getContextUsage()?.providerRequest).toEqual(snapshot);
		} finally {
			session.dispose();
		}
	});
});
