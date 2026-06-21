import { Agent } from "@dyyz1993/pi-agent-core";
import { type AssistantMessage, getModel, type Usage } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function createAssistantMessage(
	text: string,
	totalTokens: number,
	timestamp: number,
	thinking?: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: [...(thinking ? [{ type: "thinking" as const, thinking }] : []), { type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(totalTokens),
		stopReason: "stop",
		timestamp,
	};
}

function createUserMessage(text: string, timestamp: number) {
	return {
		role: "user" as const,
		content: text,
		timestamp,
	};
}

function createSession() {
	const settingsManager = SettingsManager.inMemory();
	const sessionManager = SessionManager.inMemory();
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

	return { session, sessionManager };
}

function syncAgentMessages(session: AgentSession, sessionManager: SessionManager): void {
	session.agent.state.messages = sessionManager.buildSessionContext().messages;
}

describe("AgentSession.getSessionStats", () => {
	it("exposes the current context usage alongside token totals", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendMessage(createAssistantMessage("hi", 10_000, 2));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage).toEqual(session.getContextUsage());
			const breakdownTotal = stats.contextUsage?.breakdown?.reduce((sum, item) => sum + item.tokens, 0);
			expect(stats.contextUsage?.tokens).toBe(10_000);
			expect(stats.contextUsage?.tokens).toBe(breakdownTotal);
			expect(stats.contextUsage?.contextWindow).toBe(model.contextWindow);
			expect(stats.contextUsage?.percent).toBe((stats.contextUsage!.tokens! / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("falls back to estimated context usage immediately after compaction", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(195_000);
			expect(stats.contextUsage).toBeDefined();
			expect(typeof stats.contextUsage?.tokens).toBe("number");
			expect(typeof stats.contextUsage?.percent).toBe("number");
		} finally {
			session.dispose();
		}
	});

	it("uses post-compaction usage for current context instead of stale kept usage", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			sessionManager.appendMessage(createAssistantMessage("response3", 25_000, 6));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(220_000);
			expect(stats.contextUsage).toBeDefined();
			const breakdownTotal = stats.contextUsage?.breakdown?.reduce((sum, item) => sum + item.tokens, 0);
			expect(stats.contextUsage?.tokens).toBe(25_000);
			expect(stats.contextUsage?.tokens).toBe(breakdownTotal);
			expect(stats.contextUsage?.percent).toBe((stats.contextUsage!.tokens! / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("breaks down system prompt and extension-injected messages", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("real user request", 1));
			sessionManager.appendCustomMessageEntry(
				"memory_relevant",
				'<memory_context fingerprint="abc"><files>Remember this</files></memory_context>',
				false,
			);
			sessionManager.appendCustomMessageEntry(
				"rules-engine",
				"<system-reminder>\nFollow project rules\n</system-reminder>",
				false,
			);
			sessionManager.appendCustomMessageEntry(
				"lsp_diagnostics",
				"[LSP] Post-edit diagnostics found issues in src/app.ts",
				true,
			);
			syncAgentMessages(session, sessionManager);

			const usage = session.getContextUsage();
			const byId = new Map(usage?.breakdown?.map((item) => [item.id, item]));

			expect(byId.get("system_base")?.tokens).toBeGreaterThan(0);
			expect(byId.get("conversation")?.tokens).toBeGreaterThan(0);
			expect(byId.get("memory")?.tokens).toBeGreaterThan(0);
			expect(byId.get("rules")?.tokens).toBeGreaterThan(0);
			expect(byId.get("lsp")?.tokens).toBeGreaterThan(0);
			expect(usage?.tokens).toBe(usage?.breakdown?.reduce((sum, item) => sum + item.tokens, 0));
		} finally {
			session.dispose();
		}
	});

	it("breaks assistant thinking out from conversation tokens", () => {
		const { session, sessionManager } = createSession();
		const thinking = "hidden chain".repeat(100);

		try {
			sessionManager.appendMessage(createUserMessage("real user request", 1));
			sessionManager.appendMessage(createAssistantMessage("visible answer", 10, 2, thinking));
			syncAgentMessages(session, sessionManager);

			const usage = session.getContextUsage();
			const byId = new Map(usage?.breakdown?.map((item) => [item.id, item]));

			expect(byId.get("thinking")?.tokens).toBeGreaterThanOrEqual(Math.ceil(thinking.length / 4));
			expect(byId.get("conversation")?.tokens).toBeGreaterThan(0);
		} finally {
			session.dispose();
		}
	});

	it("counts repeated auto-memory contexts in context usage", () => {
		const { session, sessionManager } = createSession();
		const repeatedMemory = `<memory_context fingerprint="same-memory"><files>${"x".repeat(4000)}</files></memory_context>`;

		try {
			sessionManager.appendMessage(createUserMessage("real user request", 1));
			sessionManager.appendCustomMessageEntry("memory_relevant", repeatedMemory, false);
			sessionManager.appendCustomMessageEntry("memory_relevant", repeatedMemory, false);
			sessionManager.appendMessage(
				createAssistantMessage("Discussing <memory_context> should not count as memory", 10, 2),
			);
			syncAgentMessages(session, sessionManager);

			const usage = session.getContextUsage();
			const memory = usage?.breakdown?.find((item) => item.id === "memory");

			expect(memory?.tokens).toBeGreaterThan(0);
			expect(memory?.tokens).toBeGreaterThanOrEqual(Math.ceil((repeatedMemory.length * 2) / 4));
		} finally {
			session.dispose();
		}
	});

	it("attributes provider payload wrapping deltas before falling back to unclassified", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("real user request", 1));
			sessionManager.appendMessage(createAssistantMessage("visible answer", 10_000, 2));
			sessionManager.appendCustomEntry("provider_request_context_usage", {
				version: 1,
				provider: model.provider,
				modelId: model.id,
				api: model.api,
				timestamp: new Date().toISOString(),
				payloadChars: 20_000,
				payloadTokens: 5_000,
				topLevelKeys: ["messages", "metadata", "system", "tools"],
				sections: [
					{ id: "system", label: "Provider system/instructions", chars: 2_000, tokens: 500 },
					{ id: "messages", label: "Provider messages/input", chars: 12_000, tokens: 3_000, count: 2 },
					{ id: "tools", label: "Provider tools", chars: 4_000, tokens: 1_000, count: 1 },
					{ id: "options", label: "Provider options/metadata", chars: 800, tokens: 200 },
				],
				toolInteractions: [
					{
						name: "bash",
						inputCount: 1,
						inputChars: 200,
						inputTokens: 50,
						avgInputTokens: 50,
						outputCount: 1,
						outputChars: 1_200,
						outputTokens: 300,
						avgOutputTokens: 300,
					},
				],
			});
			syncAgentMessages(session, sessionManager);

			const usage = session.getContextUsage();
			const byId = new Map(usage?.breakdown?.map((item) => [item.id, item]));

			expect(byId.get("tool_inputs")?.tokens).toBe(50);
			expect(byId.get("tool_outputs")?.tokens).toBe(300);
			expect(byId.get("provider_messages")?.tokens).toBeGreaterThan(0);
			expect(byId.get("provider_tools")?.tokens).toBeGreaterThan(0);
			expect(byId.get("provider_options")?.tokens).toBe(200);
			expect(usage?.tokens).toBe(usage?.breakdown?.reduce((sum, item) => sum + item.tokens, 0));
		} finally {
			session.dispose();
		}
	});
});
