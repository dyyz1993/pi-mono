import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import { applySlidingWindow, estimateMessageTokens } from "../../extensions/compaction-manager/sliding-window.js";

function makeUserMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function makeAssistantMessage(text: string): AgentMessage {
	return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() } as AgentMessage;
}

const defaultConfig = { enabled: true, windowTokens: 80000, truncationNotice: true };

describe("applySlidingWindow", () => {
	it("should return undefined for empty messages array", () => {
		const result = applySlidingWindow([], defaultConfig);
		expect(result).toBeUndefined();
	});

	it("should return undefined when all messages fit within window", () => {
		const messages: AgentMessage[] = [makeUserMessage("hello"), makeAssistantMessage("world")];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 80000 });
		expect(result).toBeUndefined();
	});

	it("should truncate oldest messages that exceed window", () => {
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 10; i++) {
			messages.push(makeUserMessage("a".repeat(400)));
		}
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 200 });
		expect(result).toBeDefined();
		expect(result!.messages.length).toBeLessThan(messages.length);
	});

	it("should keep newest messages within the window", () => {
		const messages: AgentMessage[] = [
			makeUserMessage("a".repeat(400)),
			makeUserMessage("b".repeat(400)),
			makeUserMessage("c".repeat(400)),
			makeUserMessage("keep me"),
		];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 50 });
		expect(result).toBeDefined();
		const kept = result!.messages;
		const last = kept[kept.length - 1];
		expect((last as { content: string }).content).toBe("keep me");
	});

	it("should return undefined when all messages exceed window but only one message exists", () => {
		// With a single message: cutIndex = 1, length = 1 → cutIndex >= length → undefined
		// The function cannot truncate the only message in the conversation
		const messages: AgentMessage[] = [makeUserMessage("a".repeat(4000))];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 1 });
		expect(result).toBeUndefined();
	});

	it("should truncate oldest messages when messages exceed window", () => {
		// Need enough messages so that newest alone fits but oldest are truncated
		// Each user message: "a"*200 → 50 tokens. windowTokens=100 → keeps ~2 newest
		const messages: AgentMessage[] = [
			makeUserMessage("a".repeat(200)), // 50 tokens
			makeUserMessage("b".repeat(200)), // 50 tokens
			makeUserMessage("c".repeat(200)), // 50 tokens
			makeUserMessage("d".repeat(200)), // 50 tokens
		];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 100 });
		expect(result).toBeDefined();
		expect(result!.messages.length).toBeGreaterThanOrEqual(1);
		// Newest message should be kept
		const last = result!.messages[result!.messages.length - 1];
		expect((last as { content: string }).content).toBe("d".repeat(200));
	});

	it("should preserve first user message when messages are truncated and first is user role", () => {
		// Each user message: 200 chars → 50 tokens. windowTokens=80 → keeps ~1 newest
		const messages: AgentMessage[] = [
			makeUserMessage("system prompt"), // short, ~4 tokens
			makeUserMessage("a".repeat(200)), // 50 tokens
			makeUserMessage("b".repeat(200)), // 50 tokens
			makeUserMessage("c".repeat(200)), // 50 tokens
		];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 80 });
		expect(result).toBeDefined();
		const first = result!.messages[0];
		expect((first as { content: string }).content).toBe("system prompt");
	});

	it("should add truncation notice when config.truncationNotice is true", () => {
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 5; i++) {
			messages.push(makeUserMessage("a".repeat(400)));
		}
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 100, truncationNotice: true });
		expect(result).toBeDefined();
		const hasNotice = result!.messages.some((m) => {
			const c = (m as { content: unknown }).content;
			if (Array.isArray(c)) {
				return c.some(
					(b) =>
						typeof b === "object" &&
						b !== null &&
						"text" in b &&
						typeof b.text === "string" &&
						b.text.includes("[Sliding window:"),
				);
			}
			return false;
		});
		expect(hasNotice).toBe(true);
	});

	it("should NOT add truncation notice when config.truncationNotice is false", () => {
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 5; i++) {
			messages.push(makeUserMessage("a".repeat(400)));
		}
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 100, truncationNotice: false });
		expect(result).toBeDefined();
		const hasNotice = result!.messages.some((m) => {
			const c = (m as { content: unknown }).content;
			if (Array.isArray(c)) {
				return c.some(
					(b) =>
						typeof b === "object" &&
						b !== null &&
						"text" in b &&
						typeof b.text === "string" &&
						b.text.includes("[Sliding window:"),
				);
			}
			return false;
		});
		expect(hasNotice).toBe(false);
	});

	it("should correctly count tokens from messages with string content", () => {
		const messages: AgentMessage[] = [makeUserMessage("a".repeat(400)), makeUserMessage("short")];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 50 });
		expect(result).toBeDefined();
	});

	it("should correctly count tokens from messages with array content", () => {
		const messages: AgentMessage[] = [makeAssistantMessage("a".repeat(400)), makeAssistantMessage("short")];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 50 });
		expect(result).toBeDefined();
	});

	it("should handle single message that fits within window", () => {
		const messages: AgentMessage[] = [makeUserMessage("hello")];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 80000 });
		expect(result).toBeUndefined();
	});

	it("should return undefined when single message exceeds window", () => {
		// Single message: cutIndex always equals length → returns undefined
		const messages: AgentMessage[] = [makeUserMessage("a".repeat(4000))];
		const result = applySlidingWindow(messages, { ...defaultConfig, windowTokens: 1 });
		expect(result).toBeUndefined();
	});
});

describe("estimateMessageTokens", () => {
	it("should estimate tokens for string content as ceil(length / 4)", () => {
		const msg = makeUserMessage("a".repeat(10));
		expect(estimateMessageTokens(msg)).toBe(3);
	});

	it("should estimate tokens for text blocks in array content", () => {
		const msg = makeAssistantMessage("a".repeat(10));
		expect(estimateMessageTokens(msg)).toBe(3);
	});

	it("should estimate tokens for thinking blocks in array content", () => {
		const msg = {
			role: "assistant",
			content: [{ type: "thinking", thinking: "a".repeat(10) }],
			timestamp: Date.now(),
		} as AgentMessage;
		expect(estimateMessageTokens(msg)).toBe(3);
	});

	it("should return 50 for blocks that are not text or thinking", () => {
		const msg = {
			role: "assistant",
			content: [{ type: "image", url: "http://example.com/img.png" }],
			timestamp: Date.now(),
		} as AgentMessage;
		expect(estimateMessageTokens(msg)).toBe(50);
	});

	it("should return 50 for messages with no content", () => {
		const msg = { role: "assistant", timestamp: Date.now() } as AgentMessage;
		expect(estimateMessageTokens(msg)).toBe(50);
	});

	it("should handle empty string content", () => {
		const msg = makeUserMessage("");
		expect(estimateMessageTokens(msg)).toBe(0);
	});

	it("should handle empty array content", () => {
		const msg = {
			role: "assistant",
			content: [],
			timestamp: Date.now(),
		} as AgentMessage;
		expect(estimateMessageTokens(msg)).toBe(0);
	});
});
