import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { CompactionSummaryMessage, FoldSummaryMessage, SegmentSummaryMessage } from "../src/core/messages.js";
import {
	COMPACTION_SUMMARY_PREFIX,
	COMPACTION_SUMMARY_SUFFIX,
	convertToLlm,
	FOLD_SUMMARY_PREFIX,
	FOLD_SUMMARY_SUFFIX,
	SEGMENT_SUMMARY_PREFIX,
	SEGMENT_SUMMARY_SUFFIX,
} from "../src/core/messages.js";

function makeSegmentSummary(summary: string, timestamp = 1_700_000_000_000): SegmentSummaryMessage {
	return { role: "segmentSummary", summary, timestamp };
}

describe("convertToLlm: segmentSummary", () => {
	it("converts segmentSummary to user role with <summary> wrapper", () => {
		const msg = makeSegmentSummary("The user asked about file renaming.");
		const result = convertToLlm([msg]);

		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
	});

	it("wraps text with SEGMENT_SUMMARY_PREFIX and SEGMENT_SUMMARY_SUFFIX", () => {
		const msg = makeSegmentSummary("Some summary content");
		const result = convertToLlm([msg]);

		const text = (result[0].content as Array<{ type: string; text: string }>)[0].text;
		expect(text).toBe(SEGMENT_SUMMARY_PREFIX + "Some summary content" + SEGMENT_SUMMARY_SUFFIX);
	});

	it("prefix starts with descriptive header and contains <summary> open tag", () => {
		expect(SEGMENT_SUMMARY_PREFIX).toContain("A segment of the conversation was compressed into this summary:");
		expect(SEGMENT_SUMMARY_PREFIX.trimEnd().endsWith("<summary>")).toBe(true);
	});

	it("suffix ends with </summary>", () => {
		expect(SEGMENT_SUMMARY_SUFFIX.trim()).toBe("</summary>");
	});

	it("preserves timestamp from SegmentSummaryMessage", () => {
		const ts = 1_700_000_123_456;
		const msg = makeSegmentSummary("summary", ts);
		const result = convertToLlm([msg]);

		expect(result[0].timestamp).toBe(ts);
	});

	it("handles empty summary text", () => {
		const msg = makeSegmentSummary("");
		const result = convertToLlm([msg]);

		const text = (result[0].content as Array<{ type: string; text: string }>)[0].text;
		expect(text).toBe(SEGMENT_SUMMARY_PREFIX + "" + SEGMENT_SUMMARY_SUFFIX);
		expect(text).toContain("<summary>");
		expect(text).toContain("</summary>");
	});

	it("handles multi-line summary text", () => {
		const summary = "Line one\nLine two\nLine three";
		const msg = makeSegmentSummary(summary);
		const result = convertToLlm([msg]);

		const text = (result[0].content as Array<{ type: string; text: string }>)[0].text;
		expect(text).toContain(summary);
	});
});

describe("convertToLlm: mixed message types", () => {
	it("converts a batch of mixed message types correctly", () => {
		const ts = 1_700_000_000_000;
		const messages: AgentMessage[] = [
			{ role: "user", content: [{ type: "text", text: "Hello" }], timestamp: ts },
			{ role: "assistant", content: [{ type: "text", text: "Hi there" }], timestamp: ts + 1 },
			makeSegmentSummary("Segment was summarized", ts + 2) as AgentMessage,
			{
				role: "foldSummary",
				summary: "Folded content",
				originalTokens: 100,
				timestamp: ts + 3,
			} as FoldSummaryMessage as AgentMessage,
			{
				role: "compactionSummary",
				summary: "Compacted content",
				tokensBefore: 500,
				timestamp: ts + 4,
			} as CompactionSummaryMessage as AgentMessage,
		];

		const result = convertToLlm(messages);

		expect(result).toHaveLength(5);

		expect(result[0].role).toBe("user");
		expect((result[0].content as Array<{ type: string; text: string }>)[0].text).toBe("Hello");

		expect(result[1].role).toBe("assistant");

		expect(result[2].role).toBe("user");
		const segText = (result[2].content as Array<{ type: string; text: string }>)[0].text;
		expect(segText).toBe(SEGMENT_SUMMARY_PREFIX + "Segment was summarized" + SEGMENT_SUMMARY_SUFFIX);

		expect(result[3].role).toBe("user");
		const foldText = (result[3].content as Array<{ type: string; text: string }>)[0].text;
		expect(foldText).toBe(FOLD_SUMMARY_PREFIX + "Folded content" + FOLD_SUMMARY_SUFFIX);

		expect(result[4].role).toBe("user");
		const compactText = (result[4].content as Array<{ type: string; text: string }>)[0].text;
		expect(compactText).toBe(COMPACTION_SUMMARY_PREFIX + "Compacted content" + COMPACTION_SUMMARY_SUFFIX);
	});

	it("each converted message preserves its original timestamp", () => {
		const ts = 1_700_000_000_000;
		const messages: AgentMessage[] = [
			{ role: "user", content: [{ type: "text", text: "msg" }], timestamp: ts },
			makeSegmentSummary("seg", ts + 100) as AgentMessage,
			{
				role: "compactionSummary",
				summary: "compact",
				tokensBefore: 50,
				timestamp: ts + 200,
			} as CompactionSummaryMessage as AgentMessage,
		];

		const result = convertToLlm(messages);

		expect(result[0].timestamp).toBe(ts);
		expect(result[1].timestamp).toBe(ts + 100);
		expect(result[2].timestamp).toBe(ts + 200);
	});
});

describe("convertToLlm: segmentSummary round-trip simulation", () => {
	it("produces valid LLM messages after simulated append + build cycle", () => {
		const ts = Date.now();
		const segmentMsg = makeSegmentSummary(
			"User discussed refactoring the auth module. Assistant proposed using JWT.",
			ts,
		);

		const contextMessages: AgentMessage[] = [
			{ role: "user", content: [{ type: "text", text: "What about auth?" }], timestamp: ts - 2000 },
			{ role: "assistant", content: [{ type: "text", text: "Let's use JWT." }], timestamp: ts - 1000 },
			segmentMsg as AgentMessage,
			{ role: "user", content: [{ type: "text", text: "Sounds good." }], timestamp: ts + 1000 },
		];

		const llmMessages = convertToLlm(contextMessages);

		expect(llmMessages).toHaveLength(4);
		for (const msg of llmMessages) {
			expect(msg).toHaveProperty("role");
			expect(msg).toHaveProperty("content");
			expect(msg).toHaveProperty("timestamp");
			expect(["user", "assistant"]).toContain(msg.role);
		}

		const segConverted = llmMessages[2];
		expect(segConverted.role).toBe("user");
		const segText = (segConverted.content as Array<{ type: string; text: string }>)[0].text;
		expect(segText).toContain("<summary>");
		expect(segText).toContain("refactoring the auth module");
		expect(segText).toContain("</summary>");
	});
});
