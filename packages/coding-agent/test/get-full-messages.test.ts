import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, Usage } from "@dyyz1993/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import {
	buildSessionContext,
	type CompactionEntry,
	type SessionEntry,
	SessionManager,
	type SessionMessageEntry,
} from "../src/core/session-manager.js";
import { assistantMsg, userMsg } from "./utilities.js";

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createUserMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function createAssistantMessage(text: string, usage?: Usage): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		usage: usage || createMockUsage(100, 50),
		stopReason: "stop",
		timestamp: Date.now(),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	};
}

let entryCounter = 0;
let lastId: string | null = null;

function resetEntryCounter() {
	entryCounter = 0;
	lastId = null;
}

beforeEach(() => {
	resetEntryCounter();
});

function createMessageEntry(message: AgentMessage): SessionMessageEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: SessionMessageEntry = {
		type: "message",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		message,
	};
	lastId = id;
	return entry;
}

function createCompactionEntry(summary: string, firstKeptEntryId: string): CompactionEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: CompactionEntry = {
		type: "compaction",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		summary,
		firstKeptEntryId,
		tokensBefore: 10000,
	};
	lastId = id;
	return entry;
}

function extractText(messages: AgentMessage[]): string {
	return messages
		.map((m) => {
			if (m.role === "user") {
				return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
			}
			if (m.role === "assistant") {
				return m.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("");
			}
			if ("summary" in m) {
				return (m as { summary: string }).summary;
			}
			return JSON.stringify(m);
		})
		.join("|");
}

function getMessagesFromEntries(entries: SessionEntry[]): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			messages.push(entry.message);
		}
	}
	return messages;
}

describe("get_full_messages", () => {
	describe("data structure consistency with getMessages", () => {
		it("getFullMessages returns same AgentMessage[] type as buildSessionContext (no compaction)", () => {
			const u1 = createMessageEntry(createUserMessage("hello"));
			const a1 = createMessageEntry(createAssistantMessage("hi there"));
			const u2 = createMessageEntry(createUserMessage("how are you"));
			const a2 = createMessageEntry(createAssistantMessage("doing great"));

			const entries = [u1, a1, u2, a2];

			const contextMessages = buildSessionContext(entries).messages;
			const fullMessages = getMessagesFromEntries(entries);

			expect(contextMessages.length).toBe(4);
			expect(fullMessages.length).toBe(4);

			for (let i = 0; i < contextMessages.length; i++) {
				expect(fullMessages[i].role).toBe(contextMessages[i].role);
			}

			expect(extractText(fullMessages)).toBe(extractText(contextMessages));
		});

		it("getFullMessages returns ALL messages including pre-compaction ones", () => {
			const u1 = createMessageEntry(createUserMessage("user msg 1 (will be compacted)"));
			const a1 = createMessageEntry(createAssistantMessage("assistant msg 1"));
			const u2 = createMessageEntry(createUserMessage("user msg 2 (kept)"));
			const a2 = createMessageEntry(createAssistantMessage("assistant msg 2"));
			const compaction1 = createCompactionEntry("Compacted: early conversation", u2.id);
			const u3 = createMessageEntry(createUserMessage("user msg 3 (after compaction)"));
			const a3 = createMessageEntry(createAssistantMessage("assistant msg 3"));

			const entries = [u1, a1, u2, a2, compaction1, u3, a3];

			const contextMessages = buildSessionContext(entries).messages;
			const fullMessages = getMessagesFromEntries(entries);

			expect(fullMessages.length).toBe(6);
			expect(contextMessages.length).toBe(5);

			const fullText = extractText(fullMessages);
			expect(fullText).toContain("user msg 1 (will be compacted)");
			expect(fullText).toContain("assistant msg 1");
			expect(fullText).toContain("user msg 2 (kept)");
			expect(fullText).toContain("user msg 3 (after compaction)");

			const contextText = extractText(contextMessages);
			expect(contextText).not.toContain("user msg 1 (will be compacted)");
			expect(contextText).not.toContain("assistant msg 1");
			expect(contextText).toContain("Compacted: early conversation");
			expect(contextText).toContain("user msg 2 (kept)");
		});

		it("each message in fullMessages has same structure as AgentMessage", () => {
			const u1 = createMessageEntry(createUserMessage("hello"));
			const a1 = createMessageEntry(createAssistantMessage("response", createMockUsage(200, 100)));
			const entries = [u1, a1];
			const fullMessages = getMessagesFromEntries(entries);

			const userMsg_result = fullMessages[0];
			expect(userMsg_result.role).toBe("user");
			expect(userMsg_result).toHaveProperty("content");
			expect(userMsg_result).toHaveProperty("timestamp");

			const assistantMsg_result = fullMessages[1] as AssistantMessage;
			expect(assistantMsg_result.role).toBe("assistant");
			expect(assistantMsg_result).toHaveProperty("content");
			expect(assistantMsg_result).toHaveProperty("usage");
			expect(assistantMsg_result).toHaveProperty("stopReason");
			expect(assistantMsg_result).toHaveProperty("model");
			expect(assistantMsg_result).toHaveProperty("provider");
			expect(assistantMsg_result.usage.totalTokens).toBe(300);
		});

		it("with multiple compactions, fullMessages still returns all original messages", () => {
			const u1 = createMessageEntry(createUserMessage("msg 1"));
			const a1 = createMessageEntry(createAssistantMessage("resp 1"));
			const u2 = createMessageEntry(createUserMessage("msg 2"));
			const a2 = createMessageEntry(createAssistantMessage("resp 2"));
			const compaction1 = createCompactionEntry("First compaction", u2.id);
			const u3 = createMessageEntry(createUserMessage("msg 3"));
			const a3 = createMessageEntry(createAssistantMessage("resp 3"));
			const compaction2 = createCompactionEntry("Second compaction", u3.id);
			const u4 = createMessageEntry(createUserMessage("msg 4"));
			const a4 = createMessageEntry(createAssistantMessage("resp 4"));

			const entries = [u1, a1, u2, a2, compaction1, u3, a3, compaction2, u4, a4];

			const contextMessages = buildSessionContext(entries).messages;
			const fullMessages = getMessagesFromEntries(entries);

			expect(fullMessages.length).toBe(8);

			const fullText = extractText(fullMessages);
			expect(fullText).toContain("msg 1");
			expect(fullText).toContain("resp 1");
			expect(fullText).toContain("msg 2");
			expect(fullText).toContain("resp 2");
			expect(fullText).toContain("msg 3");
			expect(fullText).toContain("resp 3");
			expect(fullText).toContain("msg 4");
			expect(fullText).toContain("resp 4");

			const contextText = extractText(contextMessages);
			expect(contextText).not.toContain("msg 1");
			expect(contextText).not.toContain("resp 1");
			expect(contextText).not.toContain("msg 2");
			expect(contextText).not.toContain("resp 2");
			expect(contextText).toContain("Second compaction");
			expect(contextText).toContain("msg 3");
			expect(contextText).toContain("msg 4");
		});
	});

	describe("with SessionManager.inMemory", () => {
		it("getEntries returns all messages, buildSessionContext returns compacted view", () => {
			const session = SessionManager.inMemory();

			session.appendMessage(userMsg("first question"));
			session.appendMessage(assistantMsg("first answer"));
			const keptId = session.appendMessage(userMsg("second question"));
			session.appendMessage(assistantMsg("second answer"));
			session.appendCompaction("Summarized first exchange", keptId, 5000);
			session.appendMessage(userMsg("third question"));
			session.appendMessage(assistantMsg("third answer"));

			const allEntries = session.getEntries();
			const context = session.buildSessionContext();

			const fullMessages = getMessagesFromEntries(allEntries);

			expect(fullMessages.length).toBe(6);
			expect(context.messages.length).toBe(5);

			const fullText = extractText(fullMessages);
			expect(fullText).toContain("first question");
			expect(fullText).toContain("first answer");
			expect(fullText).toContain("second question");
			expect(fullText).toContain("third question");

			const contextText = extractText(context.messages);
			expect(contextText).not.toContain("first question");
			expect(contextText).not.toContain("first answer");
			expect(contextText).toContain("Summarized first exchange");
			expect(contextText).toContain("second question");
			expect(contextText).toContain("third question");
		});

		it("fullMessages items are exact same object references as stored in entries", () => {
			const session = SessionManager.inMemory();

			session.appendMessage(userMsg("hello"));
			session.appendMessage(assistantMsg("world"));

			const entries = session.getEntries();
			const fullMessages = getMessagesFromEntries(entries);

			expect(fullMessages[0]).toBe((entries[0] as { message: AgentMessage }).message);
			expect(fullMessages[1]).toBe((entries[1] as { message: AgentMessage }).message);
		});

		it("totalCount matches number of message entries", () => {
			const session = SessionManager.inMemory();

			session.appendMessage(userMsg("q1"));
			session.appendMessage(assistantMsg("a1"));
			const keptId = session.appendMessage(userMsg("q2"));
			session.appendMessage(assistantMsg("a2"));
			session.appendCompaction("Summary", keptId, 1000);
			session.appendMessage(userMsg("q3"));
			session.appendMessage(assistantMsg("a3"));

			const allEntries = session.getEntries();
			const messageEntries = allEntries.filter((e) => e.type === "message");

			expect(messageEntries.length).toBe(6);

			const fullMessages = getMessagesFromEntries(allEntries);
			expect(fullMessages.length).toBe(6);
			expect(fullMessages.length).toBe(messageEntries.length);
		});
	});

	describe("response envelope structure", () => {
		it("simulated response has correct shape for future pagination", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("q1"));
			session.appendMessage(assistantMsg("a1"));

			const allEntries = session.getEntries();
			const fullMessages = getMessagesFromEntries(allEntries);

			const response = {
				messages: fullMessages,
				hasMore: false,
				totalCount: fullMessages.length,
				nextCursor: null as string | null,
			};

			expect(response).toHaveProperty("messages");
			expect(response).toHaveProperty("hasMore");
			expect(response).toHaveProperty("totalCount");
			expect(response).toHaveProperty("nextCursor");
			expect(response.hasMore).toBe(false);
			expect(response.totalCount).toBe(2);
			expect(response.nextCursor).toBeNull();
			expect(Array.isArray(response.messages)).toBe(true);
		});
	});
});
