import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage } from "@dyyz1993/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSegmentSummary } from "../../src/core/compaction/branch-summarization.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";

const { completeSimpleMock } = vi.hoisted(() => ({
	completeSimpleMock: vi.fn(),
}));

vi.mock("@dyyz1993/pi-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dyyz1993/pi-ai")>();
	return {
		...actual,
		completeSimple: completeSimpleMock,
	};
});

function makeEntry(overrides: Partial<SessionEntry> & { type: SessionEntry["type"]; id: string }): SessionEntry {
	return {
		parentId: null,
		timestamp: new Date().toISOString(),
		...overrides,
	} as SessionEntry;
}

function makeMessageEntry(id: string, role: AgentMessage["role"], content: string): SessionEntry {
	const msg: AgentMessage = {
		role,
		content: [{ type: "text" as const, text: content }],
		timestamp: Date.now(),
	} as AgentMessage;
	return makeEntry({ type: "message", id, message: msg }) as SessionEntry;
}

function makeThinkingLevelEntry(id: string): SessionEntry {
	return makeEntry({
		type: "thinking_level_change",
		id,
		thinkingLevel: "high",
	} as Partial<SessionEntry>) as SessionEntry;
}

function makeModelChangeEntry(id: string): SessionEntry {
	return makeEntry({
		type: "model_change",
		id,
		provider: "anthropic",
		modelId: "claude-3-opus",
	} as Partial<SessionEntry>) as SessionEntry;
}

function makeCustomEntry(id: string): SessionEntry {
	return makeEntry({ type: "custom", id, customType: "my-ext", data: {} } as Partial<SessionEntry>) as SessionEntry;
}

function makeLabelEntry(id: string): SessionEntry {
	return makeEntry({ type: "label", id, targetId: "t1", label: "bookmark" } as Partial<SessionEntry>) as SessionEntry;
}

function makeSessionInfoEntry(id: string): SessionEntry {
	return makeEntry({ type: "session_info", id, name: "test session" } as Partial<SessionEntry>) as SessionEntry;
}

function makeToolResultEntry(id: string): SessionEntry {
	const msg = {
		role: "toolResult" as const,
		content: [{ type: "text" as const, text: "result" }],
		timestamp: Date.now(),
		toolCallId: "tc1",
	} as unknown as AgentMessage;
	return makeEntry({ type: "message", id, message: msg }) as SessionEntry;
}

const stubModel = {
	id: "test-model",
	api: "anthropic-messages",
	provider: "test",
	contextWindow: 128000,
} as any;

const mockSummaryResponse: AssistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "A concise summary of the segment." }],
	api: "anthropic-messages",
	provider: "test",
	model: "test-model",
	usage: {
		input: 10,
		output: 10,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 20,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: Date.now(),
};

const mockAbortResponse: AssistantMessage = {
	...mockSummaryResponse,
	stopReason: "aborted",
};

const mockErrorResponse: AssistantMessage = {
	...mockSummaryResponse,
	stopReason: "error",
	errorMessage: "API request failed",
};

describe("generateSegmentSummary", () => {
	beforeEach(() => {
		completeSimpleMock.mockReset();
		completeSimpleMock.mockResolvedValue(mockSummaryResponse);
	});

	describe("empty entries", () => {
		it("returns 'No content to summarize' for empty array", async () => {
			const result = await generateSegmentSummary([], {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No content to summarize", error: undefined });
			expect(completeSimpleMock).not.toHaveBeenCalled();
		});
	});

	describe("metadata-only entries", () => {
		it("returns 'No content to summarize' for thinking_level_change entries", async () => {
			const entries = [makeThinkingLevelEntry("e1")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No content to summarize", error: undefined });
			expect(completeSimpleMock).not.toHaveBeenCalled();
		});

		it("returns 'No content to summarize' for model_change entries", async () => {
			const entries = [makeModelChangeEntry("e1")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No content to summarize", error: undefined });
			expect(completeSimpleMock).not.toHaveBeenCalled();
		});

		it("returns 'No content to summarize' for custom entries", async () => {
			const entries = [makeCustomEntry("e1")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No content to summarize", error: undefined });
			expect(completeSimpleMock).not.toHaveBeenCalled();
		});

		it("returns 'No content to summarize' for label entries", async () => {
			const entries = [makeLabelEntry("e1")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No content to summarize", error: undefined });
			expect(completeSimpleMock).not.toHaveBeenCalled();
		});

		it("returns 'No content to summarize' for session_info entries", async () => {
			const entries = [makeSessionInfoEntry("e1")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No content to summarize", error: undefined });
			expect(completeSimpleMock).not.toHaveBeenCalled();
		});

		it("returns 'No content to summarize' for a mix of metadata entries", async () => {
			const entries = [
				makeThinkingLevelEntry("e1"),
				makeModelChangeEntry("e2"),
				makeCustomEntry("e3"),
				makeLabelEntry("e4"),
				makeSessionInfoEntry("e5"),
			];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No content to summarize", error: undefined });
			expect(completeSimpleMock).not.toHaveBeenCalled();
		});
	});

	describe("getMessageFromEntry behavior", () => {
		it("skips toolResult messages (no LLM call needed)", async () => {
			const entries = [makeToolResultEntry("e1")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No content to summarize", error: undefined });
			expect(completeSimpleMock).not.toHaveBeenCalled();
		});

		it("calls LLM for user message entries and returns summary", async () => {
			const entries = [makeMessageEntry("e1", "user", "Hello world")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(completeSimpleMock).toHaveBeenCalledTimes(1);
			expect(result.summary).toBe("A concise summary of the segment.");
			expect(result.error).toBeUndefined();
		});

		it("calls LLM for assistant message entries and returns summary", async () => {
			const entries = [makeMessageEntry("e1", "assistant", "Hi there")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(completeSimpleMock).toHaveBeenCalledTimes(1);
			expect(result.summary).toBe("A concise summary of the segment.");
			expect(result.error).toBeUndefined();
		});
	});

	describe("error handling", () => {
		it("returns aborted result when LLM response is aborted", async () => {
			completeSimpleMock.mockResolvedValue(mockAbortResponse);

			const entries = [makeMessageEntry("e1", "user", "Hello")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "", error: "Summarization aborted" });
		});

		it("returns error when LLM response has stopReason 'error'", async () => {
			completeSimpleMock.mockResolvedValue(mockErrorResponse);

			const entries = [makeMessageEntry("e1", "user", "Hello")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "", error: "API request failed" });
		});

		it("returns generic error message when LLM error has no errorMessage", async () => {
			completeSimpleMock.mockResolvedValue({
				...mockSummaryResponse,
				stopReason: "error",
				errorMessage: undefined,
			});

			const entries = [makeMessageEntry("e1", "user", "Hello")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "", error: "Summarization failed" });
		});

		it("returns 'No summary generated' when LLM returns empty content", async () => {
			completeSimpleMock.mockResolvedValue({
				...mockSummaryResponse,
				content: [],
			});

			const entries = [makeMessageEntry("e1", "user", "Hello")];
			const result = await generateSegmentSummary(entries, {
				model: stubModel,
				apiKey: "test-key",
				signal: new AbortController().signal,
			});

			expect(result).toEqual({ summary: "No summary generated" });
		});
	});
});
