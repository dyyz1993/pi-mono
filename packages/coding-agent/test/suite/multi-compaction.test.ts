import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	estimateMessageTokens as contextFoldEstimateTokens,
	extractFoldSummary,
	findFoldableEntries,
} from "../../extensions/_multi-compaction/context-fold.ts";
import type { HalfCompactionConfig } from "../../extensions/_multi-compaction/half-compaction.ts";
import { buildHalfSummary, prepareHalfCompaction } from "../../extensions/_multi-compaction/half-compaction.ts";
import type { LineFoldConfig } from "../../extensions/_multi-compaction/line-fold.ts";
import { foldDuplicateLines, foldText } from "../../extensions/_multi-compaction/line-fold.ts";
import {
	cachedMicrocompact,
	microcompactMessages,
	stripThinkingBlocks,
} from "../../extensions/_multi-compaction/microcompact.ts";
import type { RecoveryConfig } from "../../extensions/_multi-compaction/post-compact-recovery.ts";
import {
	buildRecoveryMessages,
	estimateFileTokens,
	readFileContent,
} from "../../extensions/_multi-compaction/post-compact-recovery.ts";
import type { SegmentCompactionConfig } from "../../extensions/_multi-compaction/segment-compaction.ts";
import { prepareSegmentCompaction, splitIntoSegments } from "../../extensions/_multi-compaction/segment-compaction.ts";
import type { SlidingWindowConfig } from "../../extensions/_multi-compaction/sliding-window.ts";
import {
	applySlidingWindow,
	estimateMessageTokens as slidingWindowEstimateTokens,
} from "../../extensions/_multi-compaction/sliding-window.ts";
import type { SnipCompactConfig } from "../../extensions/_multi-compaction/snip-compact.ts";
import {
	adjustTailBoundary,
	findAssistantToolCallGroupEnd,
	snipCompact,
} from "../../extensions/_multi-compaction/snip-compact.ts";
import type { ToolResultBudgetConfig } from "../../extensions/_multi-compaction/tool-result-budget.ts";
import { budgetToolResults } from "../../extensions/_multi-compaction/tool-result-budget.ts";
import type { CompactionPreparation } from "../../src/core/compaction/compaction.ts";
import type { SessionEntry, SessionMessageEntry } from "../../src/core/session-manager.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createToolResult(toolName: string, content: string, timestamp?: number, isError?: boolean): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
		toolName,
		content: [{ type: "text", text: content }],
		isError: isError ?? false,
		timestamp: timestamp ?? Date.now(),
	};
}

function createAssistant(text: string, timestamp?: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai" as const,
		provider: "faux" as const,
		model: "faux-1",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: timestamp ?? Date.now(),
	};
}

function createUser(text: string, timestamp?: number): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: timestamp ?? Date.now(),
	};
}

function createAssistantWithToolCalls(
	toolCalls: Array<{ name: string; id: string }>,
	timestamp?: number,
): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text: "calling tools" },
			...toolCalls.map((tc) => ({
				type: "toolCall" as const,
				name: tc.name,
				id: tc.id,
				arguments: {} as Record<string, unknown>,
			})),
		],
		api: "openai" as const,
		provider: "faux" as const,
		model: "faux-1",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse" as const,
		timestamp: timestamp ?? Date.now(),
	};
}

function makePreparation(overrides: Partial<CompactionPreparation> = {}): CompactionPreparation {
	return {
		firstKeptEntryId: "entry-kept-1",
		messagesToSummarize: [],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 1000,
		previousSummary: undefined,
		fileOps: { read: new Set(), edited: new Set(), written: new Set() },
		settings: {
			enabled: true,
			reserveTokens: 10000,
			keepRecentTokens: 5000,
		},
		...overrides,
	};
}

function makeSessionEntry(message: AgentMessage, id?: string): SessionMessageEntry {
	return {
		type: "message",
		id: id ?? `entry-${Math.random().toString(36).slice(2, 8)}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		message,
	};
}

// ---------------------------------------------------------------------------
// 1. tool-result-budget
// ---------------------------------------------------------------------------

describe("tool-result-budget", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			if (existsSync(dir)) rmSync(dir, { recursive: true });
		}
		tempDirs.length = 0;
	});

	it("returns undefined when total tool result chars under budget", () => {
		const messages: AgentMessage[] = [
			createUser("hello"),
			createAssistant("hi"),
			createToolResult("read", "small content"),
		];
		const config: ToolResultBudgetConfig = {
			enabled: true,
			maxResultChars: 200_000,
			previewChars: 2000,
			minIntervalMs: 0,
		};
		expect(budgetToolResults(messages, config)).toBeUndefined();
	});

	it("persists oversized tool results and replaces with preview", () => {
		const bigContent = "x".repeat(150_000);
		const messages: AgentMessage[] = [
			createUser("hello"),
			createAssistant("hi"),
			createToolResult("read", bigContent),
			createToolResult("bash", bigContent),
		];
		const config: ToolResultBudgetConfig = {
			enabled: true,
			maxResultChars: 100_000,
			previewChars: 500,
			minIntervalMs: 0,
		};
		const result = budgetToolResults(messages, config);
		expect(result).toBeDefined();
		expect(result!.messages).toHaveLength(4);
		// The tool results should have been replaced with preview content
		const toolMsg0 = result!.messages[2] as ToolResultMessage;
		expect(toolMsg0.content[0].type).toBe("text");
		const text = (toolMsg0.content[0] as { text: string }).text;
		expect(text).toContain("[persisted-output:");
		expect(text).toContain("<preview>");
	});

	it("skips error results", () => {
		const bigContent = "x".repeat(150_000);
		const messages: AgentMessage[] = [createUser("hello"), createToolResult("bash", bigContent, Date.now(), true)];
		const config: ToolResultBudgetConfig = {
			enabled: true,
			maxResultChars: 100,
			previewChars: 50,
			minIntervalMs: 0,
		};
		// Error results are skipped, so total non-error chars = 0, under budget
		expect(budgetToolResults(messages, config)).toBeUndefined();
	});

	it("skips small results even when total is over budget", () => {
		// Many small results that together exceed budget but each is under previewChars
		const messages: AgentMessage[] = [
			createUser("hello"),
			createToolResult("read", "a".repeat(100)),
			createToolResult("read", "b".repeat(100)),
			createToolResult("read", "c".repeat(100)),
		];
		const config: ToolResultBudgetConfig = {
			enabled: true,
			maxResultChars: 150,
			previewChars: 200,
			minIntervalMs: 0,
		};
		// Total is 300 > 150, but each result is 100 < 200 previewChars, so none persisted
		expect(budgetToolResults(messages, config)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 2. snip-compact
// ---------------------------------------------------------------------------

describe("snip-compact", () => {
	const defaultConfig: SnipCompactConfig = {
		enabled: true,
		maxMessages: 10,
		keepHeadCount: 3,
		minIntervalMs: 0,
	};

	it("returns undefined when message count is under max", () => {
		const messages: AgentMessage[] = Array.from({ length: 8 }, (_, i) =>
			i % 2 === 0 ? createUser(`msg ${i}`) : createAssistant(`reply ${i}`),
		);
		expect(snipCompact(messages, defaultConfig)).toBeUndefined();
	});

	it("returns undefined when disabled", () => {
		const messages: AgentMessage[] = Array.from({ length: 20 }, (_, i) => createUser(`msg ${i}`));
		expect(snipCompact(messages, { ...defaultConfig, enabled: false })).toBeUndefined();
	});

	it("snips middle messages and inserts placeholder", () => {
		const messages: AgentMessage[] = Array.from({ length: 20 }, (_, i) => createUser(`msg ${i}`));
		const result = snipCompact(messages, defaultConfig);
		expect(result).toBeDefined();
		// head (3) + placeholder (1) + tail (maxMessages - keepHeadCount = 7) = 11
		expect(result!.messages).toHaveLength(3 + 1 + 7);
		// Placeholder is at index 3
		const placeholder = result!.messages[3];
		expect(placeholder.role).toBe("user");
		const text = (placeholder as { content: Array<{ type: string; text: string }> }).content[0].text;
		expect(text).toContain("[snipped");
	});

	it("adjusts tail boundary to not split assistant+toolResult groups", () => {
		const messages: AgentMessage[] = [
			createUser("0"),
			createUser("1"),
			createUser("2"),
			createUser("3"),
			createUser("4"),
			createUser("5"),
			createUser("6"),
			createAssistantWithToolCalls([{ name: "bash", id: "tc-1" }]),
			createToolResult("bash", "result"),
			createUser("9"),
			createUser("10"),
		];
		// maxMessages=8, keepHeadCount=3 => tailStart = 11-5 = 6
		// msg[6] is user, so no adjustment needed - actually let me check...
		// Actually with 11 messages and maxMessages=8, keepTailCount=5, tailStart=6
		// messages[6] is "6" (user) - no toolResult at boundary, no adjustment
		// Let me create a scenario where the boundary lands on a toolResult
		const messages2: AgentMessage[] = [
			createUser("0"),
			createUser("1"),
			createUser("2"),
			createUser("3"),
			createUser("4"),
			createAssistantWithToolCalls([{ name: "bash", id: "tc-1" }]),
			createToolResult("bash", "result"),
			createUser("8"),
			createUser("9"),
			createUser("10"),
		];
		// 10 messages, maxMessages=8, keepHeadCount=3 => keepTailCount=5, tailStart=5
		// messages[5] is assistant with toolCalls, messages[6] is toolResult
		// adjustTailBoundary: messages[5].role === "assistant" (not toolResult), so no adjustment
		// But if tailStart=6, messages[6].role === "toolResult", so we walk back to 5
		const config: SnipCompactConfig = { enabled: true, maxMessages: 8, keepHeadCount: 3, minIntervalMs: 0 };
		const adjusted = adjustTailBoundary(messages2, 6);
		// messages[6] is toolResult, walk back: messages[5] is assistant with toolCalls
		expect(adjusted).toBe(5);
	});

	it("handles edge case where head overlaps tail", () => {
		const messages: AgentMessage[] = Array.from({ length: 5 }, (_, i) => createUser(`msg ${i}`));
		// maxMessages=4, keepHeadCount=3 => keepTailCount=1, tailStart=4
		// tailStart=4 > keepHeadCount=3, so it should work
		const config: SnipCompactConfig = { enabled: true, maxMessages: 4, keepHeadCount: 3, minIntervalMs: 0 };
		const result = snipCompact(messages, config);
		expect(result).toBeDefined();
		// But if keepHeadCount >= tailStart, it returns undefined
		// Let's test that overlap case
		const config2: SnipCompactConfig = { enabled: true, maxMessages: 4, keepHeadCount: 10, minIntervalMs: 0 };
		expect(snipCompact(messages, config2)).toBeUndefined();
	});

	it("findAssistantToolCallGroupEnd returns correct end index", () => {
		const messages: AgentMessage[] = [
			createAssistantWithToolCalls([{ name: "bash", id: "tc-1" }]),
			createToolResult("bash", "result 1"),
			createToolResult("bash", "result 2"),
			createUser("next"),
		];
		expect(findAssistantToolCallGroupEnd(messages, 0)).toBe(3);
		expect(findAssistantToolCallGroupEnd(messages, 3)).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// 2.5. line-fold (consecutive duplicate line folding)
// ---------------------------------------------------------------------------

describe("line-fold", () => {
	const defaultConfig: LineFoldConfig = {
		enabled: true,
		minConsecutive: 3,
		toolNames: ["bash", "read", "grep"],
	};

	describe("foldText (pure function)", () => {
		it("returns original text when no consecutive duplicates", () => {
			const text = "line1\nline2\nline3";
			expect(foldText(text, 3)).toBe(text);
		});

		it("returns original text when duplicates below minConsecutive", () => {
			const text = "line1\nline1\nline2";
			expect(foldText(text, 3)).toBe(text);
		});

		it("folds 3 consecutive identical lines", () => {
			const text = "same\nsame\nsame";
			const result = foldText(text, 3);
			expect(result).toBe("same\n[... 2 identical lines folded]");
		});

		it("folds 100 consecutive identical lines", () => {
			const text = Array(100).fill("error: connection refused").join("\n");
			const result = foldText(text, 3);
			expect(result).toBe("error: connection refused\n[... 99 identical lines folded]");
		});

		it("folds multiple separate runs in same text", () => {
			const text = "lineA\nlineA\nlineA\nunique\nlineB\nlineB\nlineB";
			const result = foldText(text, 3);
			expect(result).toBe("lineA\n[... 2 identical lines folded]\nunique\nlineB\n[... 2 identical lines folded]");
		});

		it("preserves surrounding non-duplicate lines", () => {
			const text = "header\nrepeat\nrepeat\nrepeat\nfooter";
			const result = foldText(text, 3);
			expect(result).toBe("header\nrepeat\n[... 2 identical lines folded]\nfooter");
		});

		it("handles empty string", () => {
			expect(foldText("", 3)).toBe("");
		});

		it("handles single line", () => {
			expect(foldText("only line", 3)).toBe("only line");
		});

		it("folds consecutive blank lines", () => {
			const text = "content\n\n\n\nmore content";
			const result = foldText(text, 3);
			// 3 consecutive blank lines ("" === "") → keep one + fold marker
			expect(result).toBe("content\n\n[... 2 identical lines folded]\nmore content");
		});

		it("handles trailing newlines", () => {
			const text = "same\nsame\nsame\n";
			const result = foldText(text, 3);
			expect(result).toBe("same\n[... 2 identical lines folded]\n");
		});
	});

	describe("foldDuplicateLines (message-level)", () => {
		it("returns undefined when no tool results", () => {
			const messages: AgentMessage[] = [createUser("hello"), createAssistant("hi")];
			expect(foldDuplicateLines(messages, defaultConfig)).toBeUndefined();
		});

		it("returns undefined when tool not in toolNames", () => {
			const messages: AgentMessage[] = [createUser("hello"), createToolResult("webFetch", "line1\nline1\nline1")];
			expect(foldDuplicateLines(messages, defaultConfig)).toBeUndefined();
		});

		it("folds duplicate lines in matching tool results", () => {
			const content = Array(10).fill("error: timeout").join("\n");
			const messages: AgentMessage[] = [createUser("run command"), createToolResult("bash", content)];
			const result = foldDuplicateLines(messages, defaultConfig);
			expect(result).toBeDefined();
			const tr = result!.messages[1] as ToolResultMessage;
			const text = (tr.content[0] as { text: string }).text;
			expect(text).toContain("[... 9 identical lines folded]");
		});

		it("skips error results", () => {
			const content = Array(5).fill("error line").join("\n");
			const messages: AgentMessage[] = [createUser("hello"), createToolResult("bash", content, Date.now(), true)];
			expect(foldDuplicateLines(messages, defaultConfig)).toBeUndefined();
		});

		it("returns undefined when disabled", () => {
			const content = Array(5).fill("same").join("\n");
			const messages: AgentMessage[] = [createToolResult("bash", content)];
			expect(foldDuplicateLines(messages, { ...defaultConfig, enabled: false })).toBeUndefined();
		});

		it("handles multiple tool results with mixed content", () => {
			const repeatedContent = Array(5).fill("log line").join("\n");
			const normalContent = "unique line 1\nunique line 2";
			const messages: AgentMessage[] = [
				createToolResult("bash", repeatedContent),
				createToolResult("read", normalContent),
				createToolResult("grep", repeatedContent),
			];
			const result = foldDuplicateLines(messages, defaultConfig);
			expect(result).toBeDefined();
			// First and third should be folded, second unchanged
			const tr0 = result!.messages[0] as ToolResultMessage;
			expect((tr0.content[0] as { text: string }).text).toContain("folded");
			const tr1 = result!.messages[1] as ToolResultMessage;
			expect((tr1.content[0] as { text: string }).text).toBe(normalContent);
			const tr2 = result!.messages[2] as ToolResultMessage;
			expect((tr2.content[0] as { text: string }).text).toContain("folded");
		});
	});
});

// ---------------------------------------------------------------------------
// 3. microcompact (deterministic, count-based)
// ---------------------------------------------------------------------------

describe("microcompact (count-based)", () => {
	it("clears old tool results beyond keepRecentCount", () => {
		const messages: AgentMessage[] = [
			createUser("hello"),
			createAssistant("hi"),
			createToolResult("bash", "output 1 that is long enough to not look already compacted"),
			createToolResult("bash", "output 2 that is long enough to not look already compacted"),
			createToolResult("bash", "output 3 that is long enough to not look already compacted"),
			createToolResult("bash", "output 4 that is long enough to not look already compacted"),
		];
		// keepRecentCount=2: keep last 2, compact first 2
		const result = microcompactMessages(messages, ["bash"], 2);
		expect(result).toBeDefined();
		// messages[2] and [3] should be compacted
		const msg2 = result!.messages[2] as ToolResultMessage;
		expect((msg2.content[0] as { text: string }).text).toContain("[Old bash result cleared]");
		const msg3 = result!.messages[3] as ToolResultMessage;
		expect((msg3.content[0] as { text: string }).text).toContain("[Old bash result cleared]");
		// messages[4] and [5] should be kept intact
		const msg4 = result!.messages[4] as ToolResultMessage;
		expect((msg4.content[0] as { text: string }).text).toContain("output 3");
	});

	it("preserves non-clearable tool results", () => {
		const messages: AgentMessage[] = [
			createUser("hello"),
			createToolResult("read", "important content"),
			createToolResult("read", "more content"),
		];
		// "read" is not in clearableTools list
		expect(microcompactMessages(messages, ["bash"], 1)).toBeUndefined();
	});

	it("preserves error results", () => {
		const messages: AgentMessage[] = [
			createUser("hello"),
			createToolResult("bash", "error output", Date.now(), true),
			createToolResult("bash", "error output 2", Date.now(), true),
		];
		expect(microcompactMessages(messages, ["bash"], 1)).toBeUndefined();
	});

	it("returns undefined when within keepRecentCount", () => {
		const messages: AgentMessage[] = [createUser("hello"), createToolResult("bash", "output 1")];
		// keepRecentCount=5: only 1 result, within limit
		expect(microcompactMessages(messages, ["bash"], 5)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 4. cached microcompact
// ---------------------------------------------------------------------------

describe("cached microcompact", () => {
	it("returns undefined when few enough cached results", () => {
		const messages: AgentMessage[] = [
			createUser("hello"),
			createToolResult("bash", "output 1"),
			createToolResult("bash", "output 2"),
		];
		expect(cachedMicrocompact(messages, ["bash"], 5)).toBeUndefined();
	});

	it("compacts older results beyond maxCachedResults, keeps recent", () => {
		const messages: AgentMessage[] = [
			createUser("hello"),
			createToolResult("bash", "a".repeat(200)), // index 1 - should be compacted
			createToolResult("bash", "b".repeat(200)), // index 2 - should be compacted
			createToolResult("bash", "c".repeat(200)), // index 3 - kept
			createToolResult("bash", "d".repeat(200)), // index 4 - kept
		];
		const result = cachedMicrocompact(messages, ["bash"], 2);
		expect(result).toBeDefined();
		// First two tool results should be compacted
		const msg1 = result!.messages[1] as ToolResultMessage;
		const msg2 = result!.messages[2] as ToolResultMessage;
		expect((msg1.content[0] as { text: string }).text).toContain("[Earlier tool result compacted");
		expect((msg2.content[0] as { text: string }).text).toContain("[Earlier tool result compacted");
		// Last two should be unchanged
		const msg3 = result!.messages[3] as ToolResultMessage;
		expect((msg3.content[0] as { text: string }).text).toBe("c".repeat(200));
	});

	it("skips already-compacted results", () => {
		const messages: AgentMessage[] = [
			createUser("hello"),
			// Already compacted (short content)
			createToolResult("bash", "[Earlier tool result compacted. Re-run if needed.]"),
			createToolResult("bash", `real output ${"x".repeat(200)}`),
		];
		// Only 1 clearable result with substantial content, maxCachedResults=5
		expect(cachedMicrocompact(messages, ["bash"], 5)).toBeUndefined();
	});

	it("skips error results", () => {
		const messages: AgentMessage[] = [
			createUser("hello"),
			createToolResult("bash", "a".repeat(200), Date.now(), true),
			createToolResult("bash", "b".repeat(200), Date.now(), true),
		];
		// Error results are skipped, so 0 clearable non-error results
		expect(cachedMicrocompact(messages, ["bash"], 1)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 5. context-fold
// ---------------------------------------------------------------------------

describe("context-fold", () => {
	it("findFoldableEntries returns empty for recent-only conversations", () => {
		const now = Date.now();
		const entries: SessionEntry[] = [
			makeSessionEntry(createAssistant("recent 1", now)),
			makeSessionEntry(createAssistant("recent 2", now)),
		];
		const result = findFoldableEntries(entries, new Set(), 1000, 5);
		expect(result).toHaveLength(0);
	});

	it("findFoldableEntries returns old assistant messages exceeding keepRecentCount", () => {
		const now = Date.now();
		const oldTimestamp = now - 100_000;
		const entries: SessionEntry[] = [
			makeSessionEntry(createAssistant("old 1", oldTimestamp)),
			makeSessionEntry(createAssistant("old 2", oldTimestamp)),
			makeSessionEntry(createAssistant("old 3", oldTimestamp)),
			makeSessionEntry(createAssistant("recent 1", now)),
			makeSessionEntry(createAssistant("recent 2", now)),
		];
		const result = findFoldableEntries(entries, new Set(), 10_000, 2);
		// 5 total, keepRecentCount=2 => candidates = first 3
		// All 3 are old enough (age >= 10000ms)
		expect(result).toHaveLength(3);
	});

	it("findFoldableEntries excludes already-folded entries", () => {
		const now = Date.now();
		const oldTimestamp = now - 100_000;
		const entry1 = makeSessionEntry(createAssistant("old 1", oldTimestamp));
		const foldedIds = new Set([entry1.id]);
		const entries: SessionEntry[] = [
			entry1,
			makeSessionEntry(createAssistant("old 2", oldTimestamp)),
			makeSessionEntry(createAssistant("recent 1", now)),
		];
		const result = findFoldableEntries(entries, foldedIds, 10_000, 1);
		expect(result).toHaveLength(1);
		expect((result[0] as SessionMessageEntry).id).not.toBe(entry1.id);
	});

	it("extractFoldSummary truncates long content", () => {
		const msg = createAssistant("a".repeat(500));
		const summary = extractFoldSummary(msg, 100);
		expect(summary.length).toBeLessThanOrEqual(104); // 100 + "..." length
		expect(summary.endsWith("...")).toBe(true);
	});

	it("extractFoldSummary handles tool calls and thinking", () => {
		const msg: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "deep thought" },
				{ type: "toolCall", name: "bash", id: "tc-1", arguments: {} as Record<string, unknown> },
				{ type: "text", text: "result" },
			],
			api: "openai" as const,
			provider: "faux" as const,
			model: "faux-1",
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
		};
		const summary = extractFoldSummary(msg, 1000);
		expect(summary).toContain("[thinking]");
		expect(summary).toContain("[called bash]");
		expect(summary).toContain("result");
	});

	it("extractFoldSummary handles empty content", () => {
		const msg = createAssistant("");
		const summary = extractFoldSummary(msg, 100);
		expect(summary).toBe("[folded empty message]");
	});
});

// ---------------------------------------------------------------------------
// 6. half-compaction
// ---------------------------------------------------------------------------

describe("half-compaction", () => {
	it("returns null for fewer than 4 messages", () => {
		const prep = makePreparation({
			messagesToSummarize: [createUser("hello"), createAssistant("hi")],
		});
		const config: HalfCompactionConfig = { enabled: true, ratio: 0.5 };
		expect(prepareHalfCompaction(prep, config)).toBeNull();
	});

	it("splits messages at configured ratio", () => {
		const messages: AgentMessage[] = Array.from({ length: 10 }, (_, i) =>
			i % 2 === 0 ? createUser(`user ${i}`) : createAssistant(`reply ${i}`),
		);
		const prep = makePreparation({ messagesToSummarize: messages });
		const config: HalfCompactionConfig = { enabled: true, ratio: 0.5 };
		const result = prepareHalfCompaction(prep, config);
		expect(result).not.toBeNull();
		expect(result!.summary).toContain("Half Compaction Summary");
		expect(result!.summary).toContain("Compressed 5 message(s)");
	});

	it("preserves previous summary in output", () => {
		const messages: AgentMessage[] = Array.from({ length: 6 }, (_, i) => createUser(`msg ${i}`));
		const prep = makePreparation({
			messagesToSummarize: messages,
			previousSummary: "Previous conversation summary here",
		});
		const config: HalfCompactionConfig = { enabled: true, ratio: 0.5 };
		const result = prepareHalfCompaction(prep, config);
		expect(result).not.toBeNull();
		expect(result!.summary).toContain("[Previous summary preserved]");
	});

	it("buildHalfSummary includes user and assistant messages", () => {
		const messages: AgentMessage[] = [
			createUser("hello there"),
			createAssistant("hi back"),
			createToolResult("bash", "some output"),
		];
		const summary = buildHalfSummary(messages);
		expect(summary).toContain("User: hello there");
		expect(summary).toContain("Assistant: hi back");
		expect(summary).toContain("Tool result: bash");
	});
});

// ---------------------------------------------------------------------------
// 7. segment-compaction
// ---------------------------------------------------------------------------

describe("segment-compaction", () => {
	it("returns null for too few messages", () => {
		const prep = makePreparation({
			messagesToSummarize: [createUser("hello"), createAssistant("hi")],
		});
		const config: SegmentCompactionConfig = { enabled: true, segmentCount: 3 };
		// segmentCount * 2 = 6, but we only have 2 messages
		expect(prepareSegmentCompaction(prep, config)).toBeNull();
	});

	it("splits into configured number of segments", () => {
		const messages: AgentMessage[] = Array.from({ length: 12 }, (_, i) =>
			i % 2 === 0 ? createUser(`user ${i}`) : createAssistant(`reply ${i}`),
		);
		const prep = makePreparation({ messagesToSummarize: messages });
		const config: SegmentCompactionConfig = { enabled: true, segmentCount: 3 };
		const result = prepareSegmentCompaction(prep, config);
		expect(result).not.toBeNull();
		expect(result!.summary).toContain("Segment Compaction Summary");
		expect(result!.summary).toContain("Segment 1/3");
		expect(result!.summary).toContain("Segment 2/3");
		expect(result!.summary).toContain("Segment 3/3");
	});

	it("combines segment summaries", () => {
		const messages: AgentMessage[] = Array.from({ length: 12 }, (_, i) => createUser(`msg ${i}`));
		const prep = makePreparation({
			messagesToSummarize: messages,
			previousSummary: "Old summary",
		});
		const config: SegmentCompactionConfig = { enabled: true, segmentCount: 3 };
		const result = prepareSegmentCompaction(prep, config);
		expect(result!.summary).toContain("[Previous summary incorporated");
		expect(result!.details).toBeDefined();
		const details = result!.details as { segmentCount: number; segments: Array<{ messageCount: number }> };
		expect(details.segmentCount).toBe(3);
		expect(details.segments).toHaveLength(3);
	});

	it("splitIntoSegments handles edge cases", () => {
		expect(splitIntoSegments([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
		expect(splitIntoSegments([], 3)).toEqual([]);
		expect(splitIntoSegments([1, 2], 5)).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// 8. sliding-window
// ---------------------------------------------------------------------------

describe("sliding-window", () => {
	const defaultConfig: SlidingWindowConfig = {
		enabled: true,
		windowTokens: 100,
		truncationNotice: true,
	};

	it("returns undefined when all messages fit", () => {
		// 5 chars / 4 = ~2 tokens each, total ~6 tokens < 100
		const messages: AgentMessage[] = [createUser("hello"), createAssistant("hi"), createUser("test")];
		expect(applySlidingWindow(messages, defaultConfig)).toBeUndefined();
	});

	it("truncates old messages beyond window", () => {
		// Each message: 100 chars => 25 tokens. 10 messages = 250 tokens total
		// windowTokens=100 => should truncate some
		const messages: AgentMessage[] = Array.from({ length: 10 }, () => createUser("a".repeat(100)));
		const result = applySlidingWindow(messages, defaultConfig);
		expect(result).toBeDefined();
		// Should have fewer messages than original
		expect(result!.messages.length).toBeLessThan(10);
	});

	it("keeps system message", () => {
		// First message is user-role, treated as system-like
		const messages: AgentMessage[] = [
			createUser("system prompt"),
			...Array.from({ length: 10 }, () => createUser("a".repeat(100))),
		];
		const result = applySlidingWindow(messages, defaultConfig);
		expect(result).toBeDefined();
		// First message should be the system message
		const first = result!.messages[0];
		expect(first.role).toBe("user");
		const text = (first as { content: Array<{ type: string; text: string }> }).content[0].text;
		expect(text).toBe("system prompt");
	});

	it("adds truncation notice when enabled", () => {
		const messages: AgentMessage[] = Array.from({ length: 10 }, () => createUser("a".repeat(100)));
		const result = applySlidingWindow(messages, { ...defaultConfig, truncationNotice: true });
		expect(result).toBeDefined();
		// Should contain a notice message
		const noticeMsg = result!.messages.find((m: AgentMessage) => {
			if (m.role !== "user") return false;
			const content = (m as { content: Array<{ type: string; text: string }> }).content;
			return content.some((b) => b.text.includes("Sliding window"));
		});
		expect(noticeMsg).toBeDefined();
	});

	it("does not add truncation notice when disabled", () => {
		const messages: AgentMessage[] = Array.from({ length: 10 }, () => createUser("a".repeat(100)));
		const result = applySlidingWindow(messages, { ...defaultConfig, truncationNotice: false });
		expect(result).toBeDefined();
		const hasNotice = result!.messages.some((m: AgentMessage) => {
			if (m.role !== "user") return false;
			const content = (m as { content: Array<{ type: string; text: string }> }).content;
			return content.some((b) => b.text.includes("Sliding window"));
		});
		expect(hasNotice).toBe(false);
	});

	it("estimateMessageTokens handles string content", () => {
		const msg: AgentMessage = { role: "user", content: "hello world", timestamp: Date.now() };
		expect(slidingWindowEstimateTokens(msg)).toBe(Math.ceil("hello world".length / 4));
	});
});

// ---------------------------------------------------------------------------
// 9. strip-thinking-blocks
// ---------------------------------------------------------------------------

describe("strip-thinking-blocks", () => {
	it("removes thinking blocks from assistant messages", () => {
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "deep thought" },
					{ type: "text", text: "hello" },
				],
				api: "openai" as const,
				provider: "faux" as const,
				model: "faux-1",
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
			} as AssistantMessage,
		];
		const result = stripThinkingBlocks(messages);
		expect(result).toBeDefined();
		const assistant = result!.messages[0] as AssistantMessage;
		expect(assistant.content).toHaveLength(1);
		expect((assistant.content[0] as { type: string }).type).toBe("text");
	});

	it("preserves non-thinking content", () => {
		const messages: AgentMessage[] = [createUser("hello"), createAssistant("world")];
		expect(stripThinkingBlocks(messages)).toBeUndefined();
	});

	it("returns undefined when no thinking blocks present", () => {
		const messages: AgentMessage[] = [createUser("hello"), createAssistant("no thinking here")];
		expect(stripThinkingBlocks(messages)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 10. post-compact-recovery
// ---------------------------------------------------------------------------

describe("post-compact-recovery", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			if (existsSync(dir)) rmSync(dir, { recursive: true });
		}
		tempDirs.length = 0;
	});

	it("returns empty array when no file ops", () => {
		const result = buildRecoveryMessages({ read: new Set(), edited: new Set() }, "/tmp");
		expect(result).toEqual([]);
	});

	it("returns empty array when disabled", () => {
		const config: RecoveryConfig = {
			enabled: false,
			maxFilesToRestore: 5,
			maxTokensPerFile: 5000,
			totalTokenBudget: 50000,
		};
		const result = buildRecoveryMessages({ read: new Set(["/tmp/test.txt"]), edited: new Set() }, "/tmp", config);
		expect(result).toEqual([]);
	});

	it("prioritizes edited files over read-only", () => {
		const tempDir = join("/tmp", `recovery-test-${Date.now()}`);
		tempDirs.push(tempDir);
		mkdirSync(tempDir, { recursive: true });

		const editedFile = join(tempDir, "edited.txt");
		const readFile = join(tempDir, "read.txt");
		writeFileSync(editedFile, "edited content", "utf-8");
		writeFileSync(readFile, "read content", "utf-8");

		const config: RecoveryConfig = {
			enabled: true,
			maxFilesToRestore: 1,
			maxTokensPerFile: 5000,
			totalTokenBudget: 50000,
		};
		const result = buildRecoveryMessages(
			{ read: new Set([readFile]), edited: new Set([editedFile]) },
			tempDir,
			config,
		);
		expect(result).toHaveLength(1);
		const text = (result[0] as { content: string }).content as string;
		expect(text).toContain("edited.txt");
	});

	it("respects per-file token limit", () => {
		const tempDir = join("/tmp", `recovery-tokens-${Date.now()}`);
		tempDirs.push(tempDir);
		mkdirSync(tempDir, { recursive: true });

		// Create a file that exceeds maxTokensPerFile
		const bigFile = join(tempDir, "big.txt");
		writeFileSync(bigFile, "x".repeat(100_000), "utf-8");

		const config: RecoveryConfig = {
			enabled: true,
			maxFilesToRestore: 5,
			maxTokensPerFile: 100, // ~400 chars max
			totalTokenBudget: 50000,
		};
		const result = buildRecoveryMessages({ read: new Set([bigFile]), edited: new Set() }, tempDir, config);
		expect(result).toHaveLength(0);
	});

	it("respects total token budget", () => {
		const tempDir = join("/tmp", `recovery-budget-${Date.now()}`);
		tempDirs.push(tempDir);
		mkdirSync(tempDir, { recursive: true });

		const file1 = join(tempDir, "file1.txt");
		const file2 = join(tempDir, "file2.txt");
		writeFileSync(file1, "a".repeat(400), "utf-8"); // ~100 tokens
		writeFileSync(file2, "b".repeat(400), "utf-8"); // ~100 tokens

		const config: RecoveryConfig = {
			enabled: true,
			maxFilesToRestore: 5,
			maxTokensPerFile: 5000,
			totalTokenBudget: 120, // Only fits first file (~100 tokens)
		};
		const result = buildRecoveryMessages({ read: new Set([file1, file2]), edited: new Set() }, tempDir, config);
		expect(result).toHaveLength(1);
	});

	it("respects max files limit", () => {
		const tempDir = join("/tmp", `recovery-maxfiles-${Date.now()}`);
		tempDirs.push(tempDir);
		mkdirSync(tempDir, { recursive: true });

		const files: string[] = [];
		for (let i = 0; i < 5; i++) {
			const f = join(tempDir, `file${i}.txt`);
			writeFileSync(f, `content ${i}`, "utf-8");
			files.push(f);
		}

		const config: RecoveryConfig = {
			enabled: true,
			maxFilesToRestore: 2,
			maxTokensPerFile: 5000,
			totalTokenBudget: 50000,
		};
		const result = buildRecoveryMessages({ read: new Set(files), edited: new Set() }, tempDir, config);
		expect(result).toHaveLength(2);
	});

	it("skips binary files (contains null bytes)", () => {
		const tempDir = join("/tmp", `recovery-binary-${Date.now()}`);
		tempDirs.push(tempDir);
		mkdirSync(tempDir, { recursive: true });

		const binFile = join(tempDir, "binary.bin");
		writeFileSync(binFile, Buffer.from([0x00, 0x01, 0x02, 0x03]));

		const config: RecoveryConfig = {
			enabled: true,
			maxFilesToRestore: 5,
			maxTokensPerFile: 5000,
			totalTokenBudget: 50000,
		};
		const result = buildRecoveryMessages({ read: new Set([binFile]), edited: new Set() }, tempDir, config);
		expect(result).toHaveLength(0);
	});

	it("skips non-existent files", () => {
		const config: RecoveryConfig = {
			enabled: true,
			maxFilesToRestore: 5,
			maxTokensPerFile: 5000,
			totalTokenBudget: 50000,
		};
		const result = buildRecoveryMessages(
			{ read: new Set(["/nonexistent/path/file.txt"]), edited: new Set() },
			"/tmp",
			config,
		);
		expect(result).toHaveLength(0);
	});

	it("estimateFileTokens uses chars/4 heuristic", () => {
		expect(estimateFileTokens("")).toBe(0);
		expect(estimateFileTokens("a")).toBe(1);
		expect(estimateFileTokens("abcd")).toBe(1);
		expect(estimateFileTokens("abcde")).toBe(2);
	});

	it("readFileContent returns undefined for non-existent files", () => {
		expect(readFileContent("/nonexistent/file.txt")).toBeUndefined();
	});

	it("readFileContent returns undefined for binary files", () => {
		const tempDir = join("/tmp", `readfile-binary-${Date.now()}`);
		tempDirs.push(tempDir);
		mkdirSync(tempDir, { recursive: true });

		const binFile = join(tempDir, "test.bin");
		writeFileSync(binFile, Buffer.from([0x00, 0x01, 0x02]));
		expect(readFileContent(binFile)).toBeUndefined();
	});
});
