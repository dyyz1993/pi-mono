import type { AssistantMessage, ToolResultMessage } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import {
	buildToolResultLookup,
	extractFoldSummary,
	formatFoldSummaryForLlm,
	type ToolResultLookup,
} from "../extensions/_multi-compaction/context-fold.ts";

function makeAssistant(toolCalls: Array<{ id: string; name: string }>): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "let me work" },
			...toolCalls.map((tc) => ({ type: "toolCall" as const, id: tc.id, name: tc.name, arguments: {} })),
			{ type: "text", text: "working on it" },
		],
		api: "test",
		provider: "test",
		model: "test",
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
}

describe("extractFoldSummary with tool result status", () => {
	it("annotates tool calls with success status", () => {
		const msg = makeAssistant([{ id: "tc-1", name: "read" }]);
		const lookup: ToolResultLookup = () => ({ isError: false, snippet: "" });
		const summary = extractFoldSummary(msg, 500, lookup);
		expect(summary).toContain("[called read → OK]");
	});

	it("annotates tool calls with failure status and snippet", () => {
		const msg = makeAssistant([{ id: "tc-1", name: "edit" }]);
		const lookup: ToolResultLookup = () => ({ isError: true, snippet: "Could not find the exact text" });
		const summary = extractFoldSummary(msg, 500, lookup);
		expect(summary).toContain("[called edit → FAILED: Could not find the exact text]");
	});

	it("falls back to no-status when lookup returns undefined", () => {
		const msg = makeAssistant([{ id: "tc-1", name: "read" }]);
		const lookup: ToolResultLookup = () => undefined;
		const summary = extractFoldSummary(msg, 500, lookup);
		expect(summary).toContain("[called read]");
		expect(summary).not.toContain("OK");
		expect(summary).not.toContain("FAILED");
	});

	it("handles mixed success/failure in same message", () => {
		const msg = makeAssistant([
			{ id: "tc-1", name: "read" },
			{ id: "tc-2", name: "edit" },
		]);
		const lookup: ToolResultLookup = (id: string) => {
			if (id === "tc-1") return { isError: false, snippet: "" };
			return { isError: true, snippet: "Validation failed" };
		};
		const summary = extractFoldSummary(msg, 500, lookup);
		expect(summary).toContain("[called read → OK]");
		expect(summary).toContain("[called edit → FAILED: Validation failed]");
	});

	it("truncates long error snippets to fit maxLength", () => {
		const msg = makeAssistant([{ id: "tc-1", name: "bash" }]);
		const longError = "x".repeat(300);
		const lookup: ToolResultLookup = () => ({ isError: true, snippet: longError });
		const summary = extractFoldSummary(msg, 100, lookup);
		expect(summary.length).toBeLessThanOrEqual(103); // 100 + "..."
		expect(summary.endsWith("...")).toBe(true);
	});
});

describe("buildToolResultLookup", () => {
	it("builds lookup from session entries", () => {
		const entries = [
			{
				type: "message" as const,
				id: "entry-1",
				parentId: null,
				timestamp: "2024-01-01T00:00:00Z",
				message: {
					role: "toolResult" as const,
					toolCallId: "tc-1",
					toolName: "edit",
					content: [{ type: "text" as const, text: "Could not find the exact text" }],
					isError: true,
					timestamp: Date.now(),
				},
			},
			{
				type: "message" as const,
				id: "entry-2",
				parentId: "entry-1",
				timestamp: "2024-01-01T00:00:01Z",
				message: {
					role: "toolResult" as const,
					toolCallId: "tc-2",
					toolName: "read",
					content: [{ type: "text" as const, text: "file contents here" }],
					isError: false,
					timestamp: Date.now(),
				},
			},
		];

		const lookup = buildToolResultLookup(entries);
		const r1 = lookup("tc-1");
		expect(r1?.isError).toBe(true);
		expect(r1?.snippet).toBe("Could not find the exact text");

		const r2 = lookup("tc-2");
		expect(r2?.isError).toBe(false);

		const r3 = lookup("tc-999");
		expect(r3).toBeUndefined();
	});
});

describe("formatFoldSummaryForLlm", () => {
	it("formats a clear summary block for LLM consumption", () => {
		const folds = [
			{ id: "1", summary: "[thinking] let me work [called edit → FAILED: exact text not found]" },
			{ id: "2", summary: "[called read → OK]" },
		];
		const text = formatFoldSummaryForLlm(folds);
		expect(text).toContain("Context fold");
		expect(text).toContain("2 previous assistant message");
		expect(text).toContain("FAILED");
	});
});
