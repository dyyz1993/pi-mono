import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { CompactionPreparation, CompactionResult } from "@dyyz1993/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { prepareSegmentCompaction, splitIntoSegments } from "../../extensions/compaction-manager/segment-compaction.js";

function makeUserMessage(text: string): AgentMessage {
	return { role: "user", content: text } as AgentMessage;
}

function makeAssistantMessage(text: string): AgentMessage {
	return { role: "assistant", content: [{ type: "text", text }] } as AgentMessage;
}

function makeToolResultMessage(toolName: string, text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: `call-${toolName}`,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
	} as AgentMessage;
}

function makePreparation(overrides: Partial<CompactionPreparation> = {}): CompactionPreparation {
	return {
		firstKeptEntryId: "kept-1",
		messagesToSummarize: [],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 1000,
		previousSummary: undefined,
		fileOps: { reads: [], writes: [], edits: [], deletes: [] },
		settings: { enabled: true, reserveTokens: 4096, keepRecentTokens: 2000 },
		...overrides,
	};
}

function makeMessages(count: number): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (let i = 0; i < count; i++) {
		if (i % 2 === 0) {
			messages.push(makeUserMessage(`Message ${i}`));
		} else {
			messages.push(makeAssistantMessage(`Response ${i}`));
		}
	}
	return messages;
}

describe("prepareSegmentCompaction", () => {
	it("should return null when not enough messages for segments", () => {
		const preparation = makePreparation({ messagesToSummarize: makeMessages(3) });
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 3 });

		expect(result).toBeNull();
	});

	it("should return null when messages count is exactly minimum minus 1", () => {
		const preparation = makePreparation({ messagesToSummarize: makeMessages(3) });
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 2 });

		expect(result).toBeNull();
	});

	it("should split into correct number of segments", () => {
		const preparation = makePreparation({ messagesToSummarize: makeMessages(12) });
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 3 });

		expect(result).toBeDefined();
		expect(result!.details).toBeDefined();
		expect(result!.details!.segments).toHaveLength(3);
	});

	it("should produce combined summary with all segment headers", () => {
		const preparation = makePreparation({ messagesToSummarize: makeMessages(12) });
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 3 });

		expect(result).toBeDefined();
		expect(result!.summary).toContain("Segment 1/3");
		expect(result!.summary).toContain("Segment 2/3");
		expect(result!.summary).toContain("Segment 3/3");
	});

	it("should include details with strategy and segment metadata", () => {
		const preparation = makePreparation({ messagesToSummarize: makeMessages(12) });
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 3 });

		expect(result).toBeDefined();
		expect(result!.details!.strategy).toBe("segment");
		expect(result!.details!.segmentCount).toBe(3);
		expect(result!.details!.segments).toHaveLength(3);

		for (const seg of result!.details!.segments) {
			expect(seg).toHaveProperty("summary");
			expect(seg).toHaveProperty("messageCount");
			expect(seg).toHaveProperty("startIndex");
			expect(seg).toHaveProperty("endIndex");
			expect(typeof seg.summary).toBe("string");
			expect(typeof seg.messageCount).toBe("number");
			expect(typeof seg.startIndex).toBe("number");
			expect(typeof seg.endIndex).toBe("number");
		}
	});

	it("should clamp segmentCount to [2, 10]", () => {
		const messages = makeMessages(20);

		const resultLow = prepareSegmentCompaction(makePreparation({ messagesToSummarize: messages }), {
			enabled: true,
			segmentCount: 1,
		});
		expect(resultLow).toBeDefined();
		expect(resultLow!.details!.segmentCount).toBe(2);

		const resultHigh = prepareSegmentCompaction(makePreparation({ messagesToSummarize: makeMessages(40) }), {
			enabled: true,
			segmentCount: 20,
		});
		expect(resultHigh).toBeDefined();
		expect(resultHigh!.details!.segmentCount).toBe(10);
	});

	it("should preserve firstKeptEntryId and tokensBefore from preparation", () => {
		const preparation = makePreparation({
			messagesToSummarize: makeMessages(10),
			firstKeptEntryId: "kept-entry-42",
			tokensBefore: 5555,
		});
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 2 });

		expect(result).toBeDefined();
		expect(result!.firstKeptEntryId).toBe("kept-entry-42");
		expect(result!.tokensBefore).toBe(5555);
	});

	it("should include previousSummary marker when provided", () => {
		const preparation = makePreparation({
			messagesToSummarize: makeMessages(10),
			previousSummary: "Old summary here",
		});
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 2 });

		expect(result).toBeDefined();
		expect(result!.summary).toContain("[Previous summary incorporated into segments below]");
	});

	it("should handle mixed message types across segments", () => {
		const messages: AgentMessage[] = [
			makeUserMessage("hello"),
			makeAssistantMessage("hi"),
			makeToolResultMessage("bash", "output"),
			makeUserMessage("next"),
			makeAssistantMessage("response"),
			makeToolResultMessage("read", "file content"),
			makeUserMessage("more"),
			makeAssistantMessage("done"),
		];
		const preparation = makePreparation({ messagesToSummarize: messages });
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 2 });

		expect(result).toBeDefined();
		expect(result!.summary).toContain("User:");
		expect(result!.summary).toContain("Assistant:");
		expect(result!.summary).toContain("Tool:");
	});

	it("should produce correct startIndex and endIndex for each segment", () => {
		const preparation = makePreparation({ messagesToSummarize: makeMessages(12) });
		const result = prepareSegmentCompaction(preparation, { enabled: true, segmentCount: 3 });

		expect(result).toBeDefined();
		const segments = result!.details!.segments;

		expect(segments[0].startIndex).toBe(0);
		expect(segments[0].endIndex).toBe(4);

		expect(segments[1].startIndex).toBe(4);
		expect(segments[1].endIndex).toBe(8);

		expect(segments[2].startIndex).toBe(8);
		expect(segments[2].endIndex).toBe(12);
	});
});

describe("splitIntoSegments", () => {
	it("should split array into equal segments", () => {
		const result = splitIntoSegments([1, 2, 3, 4, 5, 6], 3);

		expect(result).toEqual([
			[1, 2],
			[3, 4],
			[5, 6],
		]);
	});

	it("should handle uneven splits", () => {
		const result = splitIntoSegments([1, 2, 3, 4, 5], 3);

		expect(result).toEqual([[1, 2], [3, 4], [5]]);
	});

	it("should return [items] when count <= 0", () => {
		expect(splitIntoSegments([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
		expect(splitIntoSegments([1, 2, 3], -1)).toEqual([[1, 2, 3]]);
	});

	it("should return [] when items is empty", () => {
		expect(splitIntoSegments([], 3)).toEqual([]);
	});

	it("should return single-element arrays when count equals items length", () => {
		expect(splitIntoSegments([1, 2, 3], 3)).toEqual([[1], [2], [3]]);
	});

	it("should return one segment when count is 1", () => {
		expect(splitIntoSegments([1, 2, 3], 1)).toEqual([[1, 2, 3]]);
	});
});
