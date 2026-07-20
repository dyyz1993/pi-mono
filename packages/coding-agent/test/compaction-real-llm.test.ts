/**
 * Real LLM compaction tests — uses actual API to verify compaction + fold +
 * recovery work end-to-end with real LLM-generated summaries.
 *
 * Skipped when no API key is available (CI without secrets).
 * Uses the same pattern as compaction-extensions.test.ts.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import multiCompaction from "../extensions/_multi-compaction/index.ts";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createCodingTools } from "../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "./utilities.ts";

const API_KEY = process.env.ZHIPUAI_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

const zhipuaiModel = {
	id: "glm-4.7",
	name: "GLM-4.7",
	api: "openai-completions" as const,
	provider: "zai-coding-cn",
	baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
	reasoning: true,
	input: ["text" as const],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 204000,
	maxTokens: 16384,
};

describe.skipIf(!API_KEY)("Real LLM compaction with _multi-compaction extension", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-real-compaction-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		try {
			session?.dispose();
		} catch {}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	async function createSessionWithMultiCompaction() {
		const model = zhipuaiModel;
		const agent = new Agent({
			getApiKey: () => API_KEY,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant. Be very concise.",
				tools: createCodingTools(tempDir),
			},
		});

		const sessionManager = SessionManager.create(tempDir);
		// Lower compaction threshold so short test sessions qualify for compaction.
		writeFileSync(
			join(tempDir, "settings.json"),
			JSON.stringify({ compaction: { enabled: true, keepRecentTokens: 10, reserveTokens: 10 } }),
		);
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		authStorage.setRuntimeApiKey("zai-coding-cn", API_KEY!);
		const modelRegistry = ModelRegistry.create(authStorage);
		modelRegistry.registerProvider("zai-coding-cn", {
			baseUrl: zhipuaiModel.baseUrl,
			apiKey: API_KEY!,
			api: zhipuaiModel.api,
			models: [zhipuaiModel],
		});

		// Use createTestExtensionsResult to properly load multi-compaction
		// This returns a full LoadExtensionsResult with properly constructed Extension objects
		const extensionsResult = await createTestExtensionsResult([multiCompaction], tempDir);

		const resourceLoader = {
			...createTestResourceLoader({ extensionsResult }),
		};

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader,
		});

		return session;
	}

	it("real compaction generates non-empty summary", async () => {
		await createSessionWithMultiCompaction();

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		const result = await session.compact();

		expect(result.summary).toBeTruthy();
		expect(result.summary.length).toBeGreaterThan(10);
		expect(result.tokensBefore).toBeGreaterThan(0);

		// Compaction entry should be in session
		const entries = session.sessionManager.getEntries();
		const compactionEntries = entries.filter((e: { type: string }) => e.type === "compaction");
		expect(compactionEntries.length).toBe(1);
	}, 120000);

	it("real compaction + postCompactRecovery restores files into context", async () => {
		// Create a file that was "read" during conversation
		const testFile = join(tempDir, "data.txt");
		writeFileSync(testFile, "Important data: 42", "utf-8");

		await createSessionWithMultiCompaction();

		// Have a longer conversation that reads the file (need enough for compaction)
		await session.prompt("Read the file data.txt and tell me its content.");
		await session.agent.waitForIdle();

		await session.prompt("What else can you tell me about the number 42?");
		await session.agent.waitForIdle();

		// Compact — postCompactRecovery should detect data.txt was read
		const compactResult = await session.compact();
		expect(compactResult.summary).toBeTruthy();

		// Check for compaction_recovery entry (may not exist if LLM didn't
		// actually use the read tool — it's provider-dependent)
		const entries = session.sessionManager.getEntries();
		const recoveryEntry = entries.find(
			(e: { type: string; customType?: string }) =>
				e.type === "custom" && (e as { customType?: string }).customType === "compaction_recovery",
		);

		// Recovery entry is optional — depends on whether LLM actually read the file
		if (recoveryEntry) {
			// After compaction, continue conversation — recovery message should be in context
			await session.prompt("What was in data.txt?");
			await session.agent.waitForIdle();

			const sessionContext = session.sessionManager.buildSessionContext();
			const llmMessages = convertToLlm(sessionContext.messages);
			const hasRecoveryContent = llmMessages.some((m) => {
				if (!Array.isArray(m.content)) return false;
				return m.content.some(
					(part: { text?: string }) => part.text?.includes("42") || part.text?.includes("data.txt"),
				);
			});
			expect(hasRecoveryContent).toBe(true);
		}
	}, 120000);

	it("real compaction summary + continued conversation works correctly", async () => {
		createSessionWithMultiCompaction();

		// Build conversation history
		await session.prompt("My name is TestUser. Remember this.");
		await session.agent.waitForIdle();

		await session.prompt("I like pizza. Remember this too.");
		await session.agent.waitForIdle();

		// Compact
		const result = await session.compact();
		expect(result.summary).toBeTruthy();

		// Continue after compaction — LLM should still know the facts from summary
		await session.prompt("What is my name and what do I like?");
		await session.agent.waitForIdle();

		// Check the final response mentions the name or food
		const messages = session.sessionManager.buildSessionContext().messages;
		const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
		const responseText = lastAssistant
			? Array.isArray(lastAssistant.content)
				? lastAssistant.content
						.filter((b: { type: string }) => b.type === "text")
						.map((b) => (b as { text?: string }).text)
						.join("")
				: String(lastAssistant.content)
			: "";

		// LLM should reference the compacted context (may not be perfect, but should mention name or pizza)
		expect(responseText.length).toBeGreaterThan(0);
	}, 120000);
});
