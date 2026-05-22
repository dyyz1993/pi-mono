import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { HalfCompactionConfig } from "../../extensions/compaction-manager/half-compaction.js";
import { buildHalfSummary, prepareHalfCompaction } from "../../extensions/compaction-manager/half-compaction.js";

interface CompactionPreparation {
	firstKeptEntryId: string;
	messagesToSummarize: AgentMessage[];
	turnPrefixMessages: AgentMessage[];
	isSplitTurn: boolean;
	tokensBefore: number;
	previousSummary?: string;
	fileOps: { read: Set<string>; edited: Set<string> };
	settings: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
}

function makePreparation(overrides?: Partial<CompactionPreparation>): CompactionPreparation {
	return {
		firstKeptEntryId: "entry-123",
		tokensBefore: 150000,
		messagesToSummarize: [],
		turnPrefixMessages: [],
		isSplitTurn: false,
		fileOps: { read: new Set(), edited: new Set() },
		settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
		...overrides,
	} as CompactionPreparation;
}

function makeUserMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function makeAssistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as AgentMessage;
}

function makeToolResultMessage(toolName: string, text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	} as AgentMessage;
}

const defaultConfig: HalfCompactionConfig = { enabled: true, ratio: 0.5 };

describe("prepareHalfCompaction", () => {
	it("should return null when messagesToSummarize has 0 messages", () => {
		const result = prepareHalfCompaction(makePreparation({ messagesToSummarize: [] }), defaultConfig);
		expect(result).toBeNull();
	});

	it("should return null when messagesToSummarize has 1 message", () => {
		const messages = [makeUserMessage("hello")];
		const result = prepareHalfCompaction(makePreparation({ messagesToSummarize: messages }), defaultConfig);
		expect(result).toBeNull();
	});

	it("should return null when messagesToSummarize has 3 messages", () => {
		const messages = [makeUserMessage("a"), makeAssistantMessage("b"), makeUserMessage("c")];
		const result = prepareHalfCompaction(makePreparation({ messagesToSummarize: messages }), defaultConfig);
		expect(result).toBeNull();
	});

	it("should return CompactionResult with correct firstKeptEntryId and tokensBefore", () => {
		const messages = [
			makeUserMessage("msg1"),
			makeAssistantMessage("msg2"),
			makeUserMessage("msg3"),
			makeAssistantMessage("msg4"),
			makeUserMessage("msg5"),
			makeAssistantMessage("msg6"),
		];
		const prep = makePreparation({
			messagesToSummarize: messages,
			firstKeptEntryId: "entry-456",
			tokensBefore: 200000,
		});
		const result = prepareHalfCompaction(prep, defaultConfig);

		expect(result).not.toBeNull();
		expect(result!.firstKeptEntryId).toBe("entry-456");
		expect(result!.tokensBefore).toBe(200000);
		expect(result!.summary).toBeTruthy();
	});

	it("should compress only the oldest half based on ratio", () => {
		const messages = Array.from({ length: 8 }, (_, i) => makeUserMessage(`msg-${i}`));
		const prep = makePreparation({ messagesToSummarize: messages });
		const result = prepareHalfCompaction(prep, { enabled: true, ratio: 0.5 });

		expect(result).not.toBeNull();
		expect(result!.summary).toContain("Compressed 4 message(s)");
		expect(result!.summary).toContain("msg-0");
		expect(result!.summary).toContain("msg-3");
		expect(result!.summary).not.toContain("msg-4");
		expect(result!.summary).not.toContain("msg-7");
	});

	it("should clamp ratio 0.0 to 0.1", () => {
		const messages = Array.from({ length: 10 }, (_, i) => makeUserMessage(`msg-${i}`));
		const prep = makePreparation({ messagesToSummarize: messages });
		const result = prepareHalfCompaction(prep, { enabled: true, ratio: 0.0 });

		expect(result).not.toBeNull();
		expect(result!.summary).toContain("Compressed 1 message(s)");
	});

	it("should clamp ratio 1.0 to 0.9", () => {
		const messages = Array.from({ length: 10 }, (_, i) => makeUserMessage(`msg-${i}`));
		const prep = makePreparation({ messagesToSummarize: messages });
		const result = prepareHalfCompaction(prep, { enabled: true, ratio: 1.0 });

		expect(result).not.toBeNull();
		expect(result!.summary).toContain("Compressed 9 message(s)");
	});

	it("should return null when ratio is clamped to 0.1 with 4 messages producing splitIndex 0", () => {
		const messages = Array.from({ length: 4 }, (_, i) => makeUserMessage(`msg-${i}`));
		const prep = makePreparation({ messagesToSummarize: messages });
		// ratio 0.0 → clamped to 0.1; 4 * 0.1 = 0.4 → floor = 0 → splitIndex < 1 → null
		const result = prepareHalfCompaction(prep, { enabled: true, ratio: 0.0 });

		expect(result).toBeNull();
	});

	it("should preserve previousSummary in output summary", () => {
		const messages = Array.from({ length: 6 }, (_, i) => makeUserMessage(`msg-${i}`));
		const prep = makePreparation({
			messagesToSummarize: messages,
			previousSummary: "Earlier discussion about architecture",
		});
		const result = prepareHalfCompaction(prep, defaultConfig);

		expect(result).not.toBeNull();
		expect(result!.summary).toContain("[Previous summary preserved]");
	});

	it("should handle mixed message types (user, assistant, toolResult)", () => {
		const messages: AgentMessage[] = [
			makeUserMessage("what is the status?"),
			makeAssistantMessage("checking now"),
			makeToolResultMessage("bash", "all systems go"),
			makeUserMessage("show me the logs"),
			makeAssistantMessage("here are the logs"),
			makeUserMessage("thanks"),
		];
		const prep = makePreparation({ messagesToSummarize: messages });
		const result = prepareHalfCompaction(prep, defaultConfig);

		expect(result).not.toBeNull();
		expect(result!.summary).toContain("User: what is the status?");
		expect(result!.summary).toContain("Assistant: checking now");
		expect(result!.summary).toContain("Tool result: bash");
		expect(result!.summary).not.toContain("show me the logs");
	});

	it("should handle messages with array content (content blocks)", () => {
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "first block" },
					{ type: "text", text: "second block" },
				],
				timestamp: Date.now(),
			} as AgentMessage,
			makeUserMessage("msg1"),
			makeAssistantMessage("msg2"),
			makeAssistantMessage("msg3"),
		];
		const prep = makePreparation({ messagesToSummarize: messages });
		const result = prepareHalfCompaction(prep, { enabled: true, ratio: 0.5 });

		expect(result).not.toBeNull();
		expect(result!.summary).toContain("first block");
		expect(result!.summary).toContain("second block");
	});

	it("should handle messages with no extractable text and still produce result", () => {
		const messages: AgentMessage[] = [
			{ role: "assistant", content: [], timestamp: Date.now() } as AgentMessage,
			{ role: "toolResult", toolCallId: "c1", content: [], isError: false, timestamp: Date.now() } as AgentMessage,
			makeUserMessage("msg1"),
			makeUserMessage("msg2"),
		];
		const prep = makePreparation({ messagesToSummarize: messages });
		const result = prepareHalfCompaction(prep, defaultConfig);

		expect(result).not.toBeNull();
		expect(result!.summary).toContain("Half Compaction Summary");
	});

	it("should return null when ratio is negative and clamped to 0.1 with 4 messages", () => {
		const messages = Array.from({ length: 4 }, (_, i) => makeUserMessage(`msg-${i}`));
		const prep = makePreparation({ messagesToSummarize: messages });
		// ratio -100 → clamped to 0.1; same as above
		const result = prepareHalfCompaction(prep, { enabled: true, ratio: -100 });

		expect(result).toBeNull();
	});
});

describe("buildHalfSummary", () => {
	it("should include message count in summary", () => {
		const messages = [makeUserMessage("hello"), makeAssistantMessage("hi"), makeUserMessage("how are you")];
		const summary = buildHalfSummary(messages);

		expect(summary).toContain("Compressed 3 message(s)");
	});

	it("should extract text from user messages", () => {
		const messages = [makeUserMessage("what is the build status?")];
		const summary = buildHalfSummary(messages);

		expect(summary).toContain("User: what is the build status?");
	});

	it("should extract text from assistant messages", () => {
		const messages = [makeAssistantMessage("the build is passing")];
		const summary = buildHalfSummary(messages);

		expect(summary).toContain("Assistant: the build is passing");
	});

	it("should extract tool names from toolResult messages", () => {
		const messages = [makeToolResultMessage("bash", "command output")];
		const summary = buildHalfSummary(messages);

		expect(summary).toContain("Tool result: bash");
	});

	it("should include previousSummary marker when provided", () => {
		const messages = [makeUserMessage("hello")];
		const summary = buildHalfSummary(messages, "old summary text");

		expect(summary).toContain("[Previous summary preserved]");
		expect(summary).toContain("Half Compaction Summary");
	});

	it("should not include previousSummary marker when not provided", () => {
		const messages = [makeUserMessage("hello")];
		const summary = buildHalfSummary(messages);

		expect(summary).not.toContain("[Previous summary preserved]");
	});

	it("should truncate long text beyond 120 characters", () => {
		const longText = "a".repeat(200);
		const messages = [makeUserMessage(longText)];
		const summary = buildHalfSummary(messages);

		expect(summary).toContain("...");
		expect(summary!.match(/User: (.*)/)?.[1]?.length ?? 0).toBeLessThanOrEqual(123);
	});

	it("should handle empty messages array", () => {
		const summary = buildHalfSummary([]);

		expect(summary).toContain("Compressed 0 message(s)");
		expect(summary).toContain("Half Compaction Summary");
	});
});
