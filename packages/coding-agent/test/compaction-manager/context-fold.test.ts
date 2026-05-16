import { describe, expect, it } from "vitest";
import type {
	AssistantMessage,
	Message,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@dyyz1993/pi-ai";
import type { SessionEntry, SessionMessageEntry } from "@dyyz1993/pi-coding-agent";
import {
	findFoldableEntries,
	extractFoldSummary,
	estimateMessageTokens,
} from "../../extensions/compaction-manager/context-fold.js";

function makeAssistantMessage(
	overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic",
		provider: "anthropic",
		model: "claude-3",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

function makeMessageEntry(
	id: string,
	message: AssistantMessage,
): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		message,
	};
}

function makeNonMessageEntry(id: string, type: string = "fold"): SessionEntry {
	return {
		type,
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
	} as SessionEntry;
}

describe("findFoldableEntries", () => {
	const maxAgeMs = 10_000;
	const keepRecentCount = 2;

	it("returns empty when no entries", () => {
		const result = findFoldableEntries([], new Set(), maxAgeMs, keepRecentCount);
		expect(result).toEqual([]);
	});

	it("returns empty when all entries are non-assistant", () => {
		const entries: SessionEntry[] = [
			makeNonMessageEntry("1", "fold"),
			makeNonMessageEntry("2", "custom"),
			makeNonMessageEntry("3", "branch_summary"),
		];
		const result = findFoldableEntries(entries, new Set(), maxAgeMs, keepRecentCount);
		expect(result).toEqual([]);
	});

	it("returns empty when message count <= keepRecentCount", () => {
		const entries: SessionEntry[] = [
			makeMessageEntry("1", makeAssistantMessage()),
			makeMessageEntry("2", makeAssistantMessage()),
		];
		const result = findFoldableEntries(entries, new Set(), maxAgeMs, 2);
		expect(result).toEqual([]);

		const singleResult = findFoldableEntries(
			[makeMessageEntry("1", makeAssistantMessage())],
			new Set(),
			maxAgeMs,
			2,
		);
		expect(singleResult).toEqual([]);
	});

	it("returns empty when all candidates are already in foldedIds", () => {
		const oldTimestamp = Date.now() - 20_000;
		const entries: SessionEntry[] = [
			makeMessageEntry("1", makeAssistantMessage({ timestamp: oldTimestamp })),
			makeMessageEntry("2", makeAssistantMessage({ timestamp: oldTimestamp })),
			makeMessageEntry("3", makeAssistantMessage()),
			makeMessageEntry("4", makeAssistantMessage()),
		];
		const foldedIds = new Set(["1", "2"]);
		const result = findFoldableEntries(entries, foldedIds, maxAgeMs, keepRecentCount);
		expect(result).toEqual([]);
	});

	it("returns empty when all candidates are younger than maxAgeMs", () => {
		const recentTimestamp = Date.now() - 1_000;
		const entries: SessionEntry[] = [
			makeMessageEntry("1", makeAssistantMessage({ timestamp: recentTimestamp })),
			makeMessageEntry("2", makeAssistantMessage({ timestamp: recentTimestamp })),
			makeMessageEntry("3", makeAssistantMessage()),
			makeMessageEntry("4", makeAssistantMessage()),
		];
		const result = findFoldableEntries(entries, new Set(), maxAgeMs, keepRecentCount);
		expect(result).toEqual([]);
	});

	it("returns correct candidates: old enough AND not folded AND beyond keepRecentCount", () => {
		const oldTimestamp = Date.now() - 20_000;
		const entries: SessionEntry[] = [
			makeMessageEntry("1", makeAssistantMessage({ timestamp: oldTimestamp })),
			makeMessageEntry("2", makeAssistantMessage({ timestamp: oldTimestamp })),
			makeMessageEntry("3", makeAssistantMessage()),
			makeMessageEntry("4", makeAssistantMessage()),
		];
		const result = findFoldableEntries(entries, new Set(), maxAgeMs, keepRecentCount);
		expect(result).toHaveLength(2);
		expect(result[0].id).toBe("1");
		expect(result[1].id).toBe("2");
	});

	it("works correctly with mixed entry types", () => {
		const oldTimestamp = Date.now() - 20_000;
		const entries: SessionEntry[] = [
			makeMessageEntry("m1", makeAssistantMessage({ timestamp: oldTimestamp })),
			makeNonMessageEntry("f1", "fold"),
			makeMessageEntry("m2", makeAssistantMessage({ timestamp: oldTimestamp })),
			makeNonMessageEntry("c1", "custom"),
			makeMessageEntry("m3", makeAssistantMessage()),
			makeMessageEntry("m4", makeAssistantMessage()),
		];
		const result = findFoldableEntries(entries, new Set(), maxAgeMs, keepRecentCount);
		expect(result).toHaveLength(2);
		expect(result[0].id).toBe("m1");
		expect(result[1].id).toBe("m2");
	});

	it("boundary test: entry exactly at maxAgeMs age is included", () => {
		const exactTimestamp = Date.now() - maxAgeMs;
		const entries: SessionEntry[] = [
			makeMessageEntry("1", makeAssistantMessage({ timestamp: exactTimestamp })),
			makeMessageEntry("2", makeAssistantMessage()),
			makeMessageEntry("3", makeAssistantMessage()),
		];
		const result = findFoldableEntries(entries, new Set(), maxAgeMs, keepRecentCount);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("1");
	});

	it("excludes entries with non-array content", () => {
		const oldTimestamp = Date.now() - 20_000;
		const msgWithStringContent = makeAssistantMessage({
			timestamp: oldTimestamp,
		});
		(msgWithStringContent as Record<string, unknown>).content = "not an array";

		const entries: SessionEntry[] = [
			makeMessageEntry("1", msgWithStringContent),
			makeMessageEntry("2", makeAssistantMessage({ timestamp: oldTimestamp })),
			makeMessageEntry("3", makeAssistantMessage()),
			makeMessageEntry("4", makeAssistantMessage()),
		];
		const result = findFoldableEntries(entries, new Set(), maxAgeMs, keepRecentCount);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("2");
	});
});

describe("extractFoldSummary", () => {
	it('returns "[folded empty message]" for non-array content', () => {
		const msg = makeAssistantMessage();
		(msg as Record<string, unknown>).content = "not an array";
		const result = extractFoldSummary(msg as AssistantMessage, 100);
		expect(result).toBe("[folded empty message]");
	});

	it('returns "[folded empty message]" for empty content array', () => {
		const msg = makeAssistantMessage({ content: [] });
		const result = extractFoldSummary(msg, 100);
		expect(result).toBe("[folded empty message]");
	});

	it("returns full text when within maxLength", () => {
		const msg = makeAssistantMessage({
			content: [{ type: "text", text: "Hello world" }],
		});
		const result = extractFoldSummary(msg, 100);
		expect(result).toBe("Hello world");
	});

	it('truncates with "..." when exceeding maxLength', () => {
		const msg = makeAssistantMessage({
			content: [{ type: "text", text: "A very long message that should be truncated" }],
		});
		const result = extractFoldSummary(msg, 10);
		expect(result).toBe("A very lon...");
	});

	it("handles text blocks", () => {
		const msg = makeAssistantMessage({
			content: [{ type: "text", text: "Hello" }],
		});
		expect(extractFoldSummary(msg, 100)).toBe("Hello");
	});

	it("handles toolCall blocks", () => {
		const msg = makeAssistantMessage({
			content: [
				{
					type: "toolCall",
					id: "tc1",
					name: "read_file",
					arguments: {},
				} satisfies ToolCall,
			],
		});
		expect(extractFoldSummary(msg, 100)).toBe("[called read_file]");
	});

	it("handles thinking blocks", () => {
		const msg = makeAssistantMessage({
			content: [{ type: "thinking", thinking: "deep thoughts" } satisfies ThinkingContent],
		});
		expect(extractFoldSummary(msg, 100)).toBe("[thinking]");
	});

	it("handles mixed content blocks", () => {
		const msg = makeAssistantMessage({
			content: [
				{ type: "text", text: "Hello" } satisfies TextContent,
				{
					type: "toolCall",
					id: "tc1",
					name: "bash",
					arguments: {},
				} satisfies ToolCall,
				{ type: "thinking", thinking: "hmm" } satisfies ThinkingContent,
			],
		});
		expect(extractFoldSummary(msg, 100)).toBe("Hello [called bash] [thinking]");
	});

	it("skips unknown block types", () => {
		const msg = makeAssistantMessage({
			content: [
				{ type: "text", text: "before" } satisfies TextContent,
				{ type: "image", data: "abc", mimeType: "image/png" },
				{ type: "text", text: "after" } satisfies TextContent,
			],
		});
		expect(extractFoldSummary(msg, 100)).toBe("before after");
	});
});

describe("estimateMessageTokens", () => {
	it("returns 0 for non-array content", () => {
		const msg: Message = {
			role: "user",
			content: "just a string",
			timestamp: Date.now(),
		};
		expect(estimateMessageTokens(msg)).toBe(0);
	});

	it("counts text blocks: ceil(length / 4)", () => {
		const msg: Message = makeAssistantMessage({
			content: [{ type: "text", text: "12345678" } satisfies TextContent],
		});
		expect(estimateMessageTokens(msg)).toBe(Math.ceil(8 / 4));
	});

	it("counts text blocks with uneven length", () => {
		const msg: Message = makeAssistantMessage({
			content: [{ type: "text", text: "12345" } satisfies TextContent],
		});
		expect(estimateMessageTokens(msg)).toBe(Math.ceil(5 / 4));
	});

	it("counts thinking blocks: ceil(length / 4)", () => {
		const msg: Message = makeAssistantMessage({
			content: [{ type: "thinking", thinking: "12345678" } satisfies ThinkingContent],
		});
		expect(estimateMessageTokens(msg)).toBe(Math.ceil(8 / 4));
	});

	it("counts thinking blocks with uneven length", () => {
		const msg: Message = makeAssistantMessage({
			content: [{ type: "thinking", thinking: "123" } satisfies ThinkingContent],
		});
		expect(estimateMessageTokens(msg)).toBe(Math.ceil(3 / 4));
	});

	it("returns 50 for other block types", () => {
		const msg: Message = makeAssistantMessage({
			content: [
				{
					type: "toolCall",
					id: "tc1",
					name: "bash",
					arguments: {},
				} satisfies ToolCall,
			],
		});
		expect(estimateMessageTokens(msg)).toBe(50);
	});

	it("works with mixed content blocks", () => {
		const msg: Message = makeAssistantMessage({
			content: [
				{ type: "text", text: "1234" } satisfies TextContent,
				{ type: "thinking", thinking: "12" } satisfies ThinkingContent,
				{
					type: "toolCall",
					id: "tc1",
					name: "bash",
					arguments: {},
				} satisfies ToolCall,
			],
		});
		const expected = Math.ceil(4 / 4) + Math.ceil(2 / 4) + 50;
		expect(estimateMessageTokens(msg)).toBe(expected);
	});
});
