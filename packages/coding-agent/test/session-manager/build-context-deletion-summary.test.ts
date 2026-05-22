import { describe, expect, it } from "vitest";
import {
	type CompactionEntry,
	type DeletionEntry,
	type FoldEntry,
	type SegmentSummaryEntry,
	type SessionEntry,
	type SessionMessageEntry,
	buildSessionContext,
} from "../../src/core/session-manager.js";

function userMsg(id: string, parentId: string | null, text: string): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: { role: "user", content: text, timestamp: 1 },
	};
}

function assistantMsg(
	id: string,
	parentId: string | null,
	text: string,
	toolCalls?: Array<{ type: "toolCall"; id: string; name: string; args: string }>,
): SessionMessageEntry {
	const content: Array<{ type: string; text?: string; id?: string; name?: string; args?: string }> = [
		{ type: "text", text },
	];
	if (toolCalls) {
		content.push(...toolCalls);
	}
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: {
			role: "assistant",
			content,
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1,
		},
	};
}

function toolResultMsg(id: string, parentId: string | null, toolCallId: string, text: string): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: {
			role: "toolResult",
			toolCallId,
			content: text,
			timestamp: 1,
		},
	};
}

function deletion(id: string, parentId: string | null, targetIds: string[]): DeletionEntry {
	return {
		type: "deletion",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		targetIds,
	};
}

function segmentSummary(
	id: string,
	parentId: string | null,
	targetIds: string[],
	summary: string,
): SegmentSummaryEntry {
	return {
		type: "segment_summary",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		targetIds,
		summary,
	};
}

function compaction(id: string, parentId: string | null, summary: string, firstKeptEntryId: string): CompactionEntry {
	return {
		type: "compaction",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		summary,
		firstKeptEntryId,
		tokensBefore: 1000,
	};
}

function fold(id: string, parentId: string | null, targetId: string, summary: string): FoldEntry {
	return {
		type: "fold",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		targetId,
		summary,
		originalTokens: 50,
	};
}

function getText(msg: { role: string; content?: unknown }): string {
	const content = (msg as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((p: { type: string }) => p.type === "text")
			.map((p: { text: string }) => p.text)
			.join("");
	}
	return "";
}

describe("buildSessionContext - deletion and segment_summary", () => {
	describe("deletion preserves message order", () => {
		it("after deleting the middle message of 3, the remaining 2 appear in correct order", () => {
			const entries: SessionEntry[] = [
				userMsg("u1", null, "first"),
				userMsg("u2", "u1", "second"),
				userMsg("u3", "u2", "third"),
				deletion("d1", "u3", ["u2"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			expect(getText(ctx.messages[0])).toBe("first");
			expect(getText(ctx.messages[1])).toBe("third");
		});
	});

	describe("deletion cascading - assistant with multiple tool calls", () => {
		it("deleting assistant excludes all its toolResults", () => {
			const entries: SessionEntry[] = [
				userMsg("u1", null, "do stuff"),
				assistantMsg("a1", "u1", "running tools", [
					{ type: "toolCall", id: "tc_a", name: "read", args: "{}" },
					{ type: "toolCall", id: "tc_b", name: "write", args: "{}" },
				]),
				toolResultMsg("tr1", "a1", "tc_a", "result A"),
				toolResultMsg("tr2", "tr1", "tc_b", "result B"),
				userMsg("u2", "tr2", "next"),
				deletion("d1", "u2", ["a1"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			expect(ctx.messages[0].role).toBe("user");
			expect(getText(ctx.messages[0])).toBe("do stuff");
			expect(ctx.messages[1].role).toBe("user");
			expect(getText(ctx.messages[1])).toBe("next");
		});
	});

	describe("deletion cascading - assistant with mixed tool calls", () => {
		it("deleting one toolResult strips its toolCall from assistant but preserves the other", () => {
			const entries: SessionEntry[] = [
				userMsg("u1", null, "do stuff"),
				assistantMsg("a1", "u1", "running tools", [
					{ type: "toolCall", id: "tc_a", name: "read", args: "{}" },
					{ type: "toolCall", id: "tc_b", name: "write", args: "{}" },
				]),
				toolResultMsg("tr1", "a1", "tc_a", "result A"),
				toolResultMsg("tr2", "tr1", "tc_b", "result B"),
				deletion("d1", "tr2", ["tr1"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("user");
			expect(getText(ctx.messages[0])).toBe("do stuff");

			const assistant = ctx.messages[1];
			expect(assistant.role).toBe("assistant");
			const content = (assistant as { content: Array<{ type: string; id?: string }> }).content;
			const toolCalls = content.filter((p) => p.type === "toolCall");
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0].id).toBe("tc_b");

			expect(ctx.messages[2].role).toBe("toolResult");
		});
	});

	describe("segment summary placement", () => {
		it("summary appears at position of first target, remaining targets are replaced", () => {
			const entries: SessionEntry[] = [
				userMsg("a", null, "message A"),
				userMsg("b", "a", "message B"),
				userMsg("c", "b", "message C"),
				segmentSummary("ss1", "c", ["a", "b"], "Summary of A and B"),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			expect(ctx.messages[0].role).toBe("segmentSummary");
			expect((ctx.messages[0] as { summary: string }).summary).toBe("Summary of A and B");
			expect(ctx.messages[1].role).toBe("user");
			expect(getText(ctx.messages[1])).toBe("message C");
		});
	});

	describe("multiple segment summaries in one session", () => {
		it("two separate segment summaries appear in correct positions", () => {
			const entries: SessionEntry[] = [
				userMsg("a", null, "message A"),
				userMsg("b", "a", "message B"),
				userMsg("c", "b", "message C"),
				userMsg("d", "c", "message D"),
				userMsg("e", "d", "message E"),
				userMsg("f", "e", "message F"),
				segmentSummary("ss1", "f", ["a", "b"], "Summary of A and B"),
				segmentSummary("ss2", "ss1", ["d", "e"], "Summary of D and E"),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(4);
			expect(ctx.messages[0].role).toBe("segmentSummary");
			expect((ctx.messages[0] as { summary: string }).summary).toBe("Summary of A and B");
			expect(getText(ctx.messages[1])).toBe("message C");
			expect(ctx.messages[2].role).toBe("segmentSummary");
			expect((ctx.messages[2] as { summary: string }).summary).toBe("Summary of D and E");
			expect(getText(ctx.messages[3])).toBe("message F");
		});
	});

	describe("fold + deletion interaction", () => {
		it("message that is both folded and deleted does not crash", () => {
			const entries: SessionEntry[] = [
				userMsg("u1", null, "first"),
				userMsg("u2", "u1", "second"),
				userMsg("u3", "u2", "third"),
				fold("f1", "u3", "u2", "Folded second"),
				deletion("d1", "f1", ["u2"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			expect(getText(ctx.messages[0])).toBe("first");
			expect(getText(ctx.messages[1])).toBe("third");
		});
	});

	describe("compaction + deletion coexistence", () => {
		it("compaction entry and new deletion entry coexist correctly", () => {
			const entries: SessionEntry[] = [
				userMsg("u1", null, "first"),
				userMsg("u2", "u1", "second"),
				userMsg("u3", "u2", "third"),
				userMsg("u4", "u3", "fourth"),
				compaction("c1", "u4", "Compacted early messages", "u4"),
				userMsg("u5", "c1", "fifth"),
				userMsg("u6", "u5", "sixth"),
				deletion("d1", "u6", ["u5"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("compactionSummary");
			expect((ctx.messages[0] as { summary: string }).summary).toBe("Compacted early messages");
			expect(getText(ctx.messages[1])).toBe("fourth");
			expect(getText(ctx.messages[2])).toBe("sixth");
		});
	});

	describe("deletion after branch", () => {
		it("deletion on new branch only affects entries on that branch", () => {
			const entries: SessionEntry[] = [
				userMsg("u1", null, "root"),
				userMsg("u2", "u1", "shared"),
				userMsg("u3", "u2", "branch A message"),
				userMsg("u4", "u2", "branch B message"),
				deletion("d1", "u4", ["u4"]),
				userMsg("u5", "d1", "after deletion on B"),
			];
			const ctxBranchA = buildSessionContext(entries, "u3");
			expect(ctxBranchA.messages).toHaveLength(3);
			expect(getText(ctxBranchA.messages[0])).toBe("root");
			expect(getText(ctxBranchA.messages[1])).toBe("shared");
			expect(getText(ctxBranchA.messages[2])).toBe("branch A message");

			const ctxBranchB = buildSessionContext(entries, "u5");
			expect(ctxBranchB.messages).toHaveLength(3);
			expect(getText(ctxBranchB.messages[0])).toBe("root");
			expect(getText(ctxBranchB.messages[1])).toBe("shared");
			expect(getText(ctxBranchB.messages[2])).toBe("after deletion on B");
		});
	});
});
