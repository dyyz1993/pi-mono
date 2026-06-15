import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { ExtensionAPI, ExtensionFactory } from "../../src/index.ts";

describe("Session fork copy and compact", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeForTest(extensionFactory: ExtensionFactory, options?: { cwd?: string }) {
		const tempDir =
			options?.cwd ?? join(tmpdir(), `pi-fork-copy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider({
			models: [{ id: "faux-1", reasoning: true }],
		});
		faux.setResponses([
			fauxAssistantMessage("reply 1"),
			fauxAssistantMessage("reply 2"),
			fauxAssistantMessage("reply 3"),
			fauxAssistantMessage("reply 4"),
			fauxAssistantMessage("reply 5"),
			fauxAssistantMessage("reply 6"),
		]);

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((m) => ({
								id: m.id,
								name: m.name,
								api: m.api,
								reasoning: m.reasoning,
								input: m.input,
								cost: m.cost,
								contextWindow: m.contextWindow,
								maxTokens: m.maxTokens,
							})),
						});
						extensionFactory(pi);
					},
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: runtimeOptions.model,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});

		cleanups.push(async () => {
			runtime.session.dispose();
			rmSync(tempDir, { recursive: true, force: true });
		});

		return { runtime, tempDir };
	}

	function readSessionEntries(filePath: string) {
		const content = readFileSync(filePath, "utf-8");
		return content
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	}

	function extractText(content: unknown): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) return content.map((c: any) => c.text ?? "").join("");
		return String(content);
	}

	it("copyBranchedSession creates a new file without switching current session", async () => {
		const { runtime } = await createRuntimeForTest(() => {});

		await runtime.session.prompt("msg 1");
		await runtime.session.prompt("msg 2");

		const originalSessionId = runtime.session.sessionId;
		const originalSessionFile = runtime.session.sessionFile;

		// Get the second user message entry
		const userMessages = runtime.session.getUserMessagesForForking();
		expect(userMessages.length).toBeGreaterThanOrEqual(2);

		const copiedPath = runtime.session.sessionManager.copyBranchedSession(userMessages[1]!.entryId);

		// Verify current session is unchanged
		expect(runtime.session.sessionId).toBe(originalSessionId);
		expect(runtime.session.sessionFile).toBe(originalSessionFile);

		// Verify new file exists
		expect(copiedPath).toBeDefined();
		expect(existsSync(copiedPath!)).toBe(true);

		// Verify the copy has entries
		const entries = readSessionEntries(copiedPath!);
		expect(entries.length).toBeGreaterThan(0);
	});

	it("copyBranchedSession preserves conversation history", async () => {
		const { runtime } = await createRuntimeForTest(() => {});

		await runtime.session.prompt("hello");
		await runtime.session.prompt("world");

		const userMessages = runtime.session.getUserMessagesForForking();
		const copiedPath = runtime.session.sessionManager.copyBranchedSession(
			userMessages[userMessages.length - 1]!.entryId,
		);

		const entries = readSessionEntries(copiedPath!);
		const messages = entries.filter((e: any) => e.type === "message");

		// Should contain both user messages and assistant replies
		const userTexts = messages
			.filter((e: any) => e.message?.role === "user")
			.map((e: any) => extractText(e.message.content))
			.join("|");
		expect(userTexts).toContain("hello");
		expect(userTexts).toContain("world");
	});

	it("copyBranchedSession with compact truncates before compaction entry", async () => {
		const { runtime } = await createRuntimeForTest(() => {});

		// Create 4 messages: msg1, msg2, msg3, msg4
		await runtime.session.prompt("msg 1");
		await runtime.session.prompt("msg 2");

		// Insert a compaction entry after msg2
		const entries = runtime.session.sessionManager.getEntries();
		const lastEntry = entries[entries.length - 1]!;
		runtime.session.sessionManager.appendCompaction("Summary of msg1 and msg2", lastEntry.id, 1000);

		// Add more messages after compaction
		await runtime.session.prompt("msg 3");
		await runtime.session.prompt("msg 4");

		// Copy with compact
		const userMessages = runtime.session.getUserMessagesForForking();
		const lastUserMsg = userMessages[userMessages.length - 1]!;
		const copiedPath = runtime.session.sessionManager.copyBranchedSession(lastUserMsg.entryId, { compact: true });

		const entriesInCopy = readSessionEntries(copiedPath!);
		const messagesInCopy = entriesInCopy.filter((e: any) => e.type === "message");
		const compactionsInCopy = entriesInCopy.filter((e: any) => e.type === "compaction");

		// Should have the compaction entry
		expect(compactionsInCopy.length).toBe(1);
		expect(compactionsInCopy[0].summary).toBe("Summary of msg1 and msg2");

		// Should have messages after compaction (msg 3 and msg 4)
		const userTexts = messagesInCopy
			.filter((e: any) => e.message?.role === "user")
			.map((e: any) => extractText(e.message.content))
			.join("|");
		expect(userTexts).toContain("msg 3");
		expect(userTexts).toContain("msg 4");

		// Should NOT have messages before compaction (msg 1 and msg 2)
		expect(userTexts).not.toContain("msg 1");
		expect(userTexts).not.toContain("msg 2");
	});

	it("copyBranchedSession without compact copies everything including pre-compaction", async () => {
		const { runtime } = await createRuntimeForTest(() => {});

		await runtime.session.prompt("msg 1");
		await runtime.session.prompt("msg 2");

		const entries = runtime.session.sessionManager.getEntries();
		const lastEntry = entries[entries.length - 1]!;
		runtime.session.sessionManager.appendCompaction("Summary", lastEntry.id, 1000);

		await runtime.session.prompt("msg 3");

		const userMessages = runtime.session.getUserMessagesForForking();
		const lastUserMsg = userMessages[userMessages.length - 1]!;
		const copiedPath = runtime.session.sessionManager.copyBranchedSession(lastUserMsg.entryId);

		const entriesInCopy = readSessionEntries(copiedPath!);
		const messagesInCopy = entriesInCopy.filter((e: any) => e.type === "message");
		const userTexts = messagesInCopy
			.filter((e: any) => e.message?.role === "user")
			.map((e: any) => extractText(e.message.content))
			.join("|");

		// Without compact: should have ALL messages
		expect(userTexts).toContain("msg 1");
		expect(userTexts).toContain("msg 2");
		expect(userTexts).toContain("msg 3");
	});

	it("createBranchedSession with compact switches to compacted branch", async () => {
		const { runtime } = await createRuntimeForTest(() => {});

		await runtime.session.prompt("msg 1");
		await runtime.session.prompt("msg 2");

		const entries = runtime.session.sessionManager.getEntries();
		const lastEntry = entries[entries.length - 1]!;
		runtime.session.sessionManager.appendCompaction("Summary of early messages", lastEntry.id, 1000);

		await runtime.session.prompt("msg 3");

		const originalSessionId = runtime.session.sessionId;

		// Fork with compact — this switches the session
		const userMessages = runtime.session.getUserMessagesForForking();
		await runtime.fork(userMessages[userMessages.length - 1]!.entryId);

		// Session should have switched (new session ID)
		expect(runtime.session.sessionId).not.toBe(originalSessionId);
	});

	it("copyBranchedSession with compact finds the NEAREST compaction before fork point", async () => {
		const { runtime } = await createRuntimeForTest(() => {});

		// Create: msg1 → compaction1 → msg2 → compaction2 → msg3
		await runtime.session.prompt("early msg 1");

		let entries = runtime.session.sessionManager.getEntries();
		let lastEntry = entries[entries.length - 1]!;
		runtime.session.sessionManager.appendCompaction("Summary 1: early messages", lastEntry.id, 1000);

		await runtime.session.prompt("mid msg 2");

		entries = runtime.session.sessionManager.getEntries();
		lastEntry = entries[entries.length - 1]!;
		runtime.session.sessionManager.appendCompaction("Summary 2: mid messages", lastEntry.id, 2000);

		await runtime.session.prompt("late msg 3");

		// Fork at msg3 with compact
		const userMessages = runtime.session.getUserMessagesForForking();
		// userMessages should have 3 entries: early msg 1, mid msg 2, late msg 3
		// We fork at "mid msg 2" — so the nearest compaction should be compaction1 (not compaction2)
		const midMsg = userMessages[1]!; // "mid msg 2"
		const copiedPath = runtime.session.sessionManager.copyBranchedSession(midMsg.entryId, { compact: true });

		const entriesInCopy = readSessionEntries(copiedPath!);
		const compactionsInCopy = entriesInCopy.filter((e: any) => e.type === "compaction");
		const messagesInCopy = entriesInCopy.filter((e: any) => e.type === "message");
		const userTexts = messagesInCopy
			.filter((e: any) => e.message?.role === "user")
			.map((e: any) => extractText(e.message.content))
			.join("|");

		// Should have compaction1 (nearest before mid msg 2), NOT compaction2
		expect(compactionsInCopy.length).toBe(1);
		expect(compactionsInCopy[0].summary).toBe("Summary 1: early messages");

		// Should contain mid msg 2 but NOT early msg 1 or late msg 3
		expect(userTexts).toContain("mid msg 2");
		expect(userTexts).not.toContain("early msg 1");
		expect(userTexts).not.toContain("late msg 3");
	});

	it("copyBranchedSession with compact at leaf uses the last compaction", async () => {
		const { runtime } = await createRuntimeForTest(() => {});

		// Create: msg1 → compaction1 → msg2 → compaction2 → msg3
		await runtime.session.prompt("early msg 1");

		let entries = runtime.session.sessionManager.getEntries();
		let lastEntry = entries[entries.length - 1]!;
		runtime.session.sessionManager.appendCompaction("Summary 1", lastEntry.id, 1000);

		await runtime.session.prompt("mid msg 2");

		entries = runtime.session.sessionManager.getEntries();
		lastEntry = entries[entries.length - 1]!;
		runtime.session.sessionManager.appendCompaction("Summary 2", lastEntry.id, 2000);

		await runtime.session.prompt("late msg 3");

		// Fork at the latest message (leaf) — should use compaction2 (nearest before leaf)
		const userMessages = runtime.session.getUserMessagesForForking();
		const lastMsg = userMessages[userMessages.length - 1]!;
		const copiedPath = runtime.session.sessionManager.copyBranchedSession(lastMsg.entryId, { compact: true });

		const entriesInCopy = readSessionEntries(copiedPath!);
		const compactionsInCopy = entriesInCopy.filter((e: any) => e.type === "compaction");
		const messagesInCopy = entriesInCopy.filter((e: any) => e.type === "message");
		const userTexts = messagesInCopy
			.filter((e: any) => e.message?.role === "user")
			.map((e: any) => extractText(e.message.content))
			.join("|");

		// Should have compaction2 (nearest before late msg 3)
		expect(compactionsInCopy.length).toBe(1);
		expect(compactionsInCopy[0].summary).toBe("Summary 2");

		// Should contain late msg 3 but NOT early or mid messages
		expect(userTexts).toContain("late msg 3");
		expect(userTexts).not.toContain("early msg 1");
		expect(userTexts).not.toContain("mid msg 2");
	});
});
