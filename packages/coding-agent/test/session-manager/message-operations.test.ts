import { describe, expect, it } from "vitest";
import {
	buildSessionContext,
	type CompactionEntry,
	type DeletionEntry,
	type SegmentSummaryEntry,
	type SessionEntry,
	type SessionMessageEntry,
} from "../../src/core/session-manager.js";

function msg(id: string, parentId: string | null, role: "user" | "assistant", text: string): SessionMessageEntry {
	const base = { type: "message" as const, id, parentId, timestamp: "2025-01-01T00:00:00Z" };
	if (role === "user") {
		return { ...base, message: { role, content: text, timestamp: 1 } };
	}
	return {
		...base,
		message: {
			role,
			content: [{ type: "text", text }],
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

function toolCallMsg(
	id: string,
	parentId: string | null,
	text: string,
	toolCallId: string,
	toolName: string,
): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text },
				{ type: "toolCall", id: toolCallId, name: toolName, arguments: { path: "/foo" } },
			],
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
			stopReason: "toolUse",
			timestamp: 1,
		},
	};
}

function toolResultMsg(
	id: string,
	parentId: string | null,
	toolCallId: string,
	toolName: string,
	resultText: string,
): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: {
			role: "toolResult",
			toolCallId,
			toolName,
			content: [{ type: "text", text: resultText }],
			isError: false,
			timestamp: 1,
		},
	};
}

function deletion(id: string, parentId: string | null, targetIds: string[]): DeletionEntry {
	return { type: "deletion", id, parentId, timestamp: "2025-01-01T00:00:00Z", targetIds };
}

function segmentSummary(
	id: string,
	parentId: string | null,
	targetIds: string[],
	summary: string,
): SegmentSummaryEntry {
	return { type: "segment_summary", id, parentId, timestamp: "2025-01-01T00:00:00Z", targetIds, summary };
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

describe("DeletionEntry", () => {
	describe("basic deletion", () => {
		it("deletes a single message from context", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "hello"),
				msg("2", "1", "assistant", "hi"),
				msg("3", "2", "user", "how are you"),
				deletion("4", "3", ["2"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			expect(ctx.messages[0].role).toBe("user");
			expect((ctx.messages[0] as any).content).toBe("hello");
			expect(ctx.messages[1].role).toBe("user");
			expect((ctx.messages[1] as any).content).toBe("how are you");
		});

		it("deletes multiple messages at once", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "hello"),
				msg("2", "1", "assistant", "hi"),
				msg("3", "2", "user", "how are you"),
				msg("4", "3", "assistant", "great"),
				deletion("5", "4", ["2", "3"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			expect(ctx.messages[0].role).toBe("user");
			expect((ctx.messages[0] as any).content).toBe("hello");
			expect(ctx.messages[1].role).toBe("assistant");
		});

		it("deleting non-existent targetId has no effect", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "hello"),
				msg("2", "1", "assistant", "hi"),
				deletion("3", "2", ["nonexistent"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
		});

		it("multiple deletion entries are cumulative", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "a"),
				msg("2", "1", "assistant", "b"),
				msg("3", "2", "user", "c"),
				msg("4", "3", "assistant", "d"),
				deletion("5", "4", ["2"]),
				msg("6", "5", "user", "e"),
				deletion("7", "6", ["4"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect((ctx.messages[0] as any).content).toBe("a");
			expect((ctx.messages[1] as any).content).toBe("c");
			expect((ctx.messages[2] as any).content).toBe("e");
		});

		it("deleting all messages results in empty context", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "hello"),
				msg("2", "1", "assistant", "hi"),
				deletion("3", "2", ["1", "2"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(0);
		});
	});

	describe("toolCall/toolResult cascading", () => {
		it("deleting assistant with toolCall must also delete matching toolResult", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "let me read that", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "file contents here"),
				msg("4", "3", "assistant", "here is the file"),
				deletion("5", "4", ["2", "3"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("assistant");
		});

		it("deleting assistant with toolCall cascades to delete matching toolResult (no orphan)", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "let me read that", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "file contents here"),
				msg("4", "3", "assistant", "here is the file"),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(4);

			const ctxAfterDelete = buildSessionContext([...entries, deletion("5", "4", ["2"])]);
			const toolResults = ctxAfterDelete.messages.filter((m) => m.role === "toolResult");
			expect(toolResults).toHaveLength(0);
			expect(ctxAfterDelete.messages).toHaveLength(2);
			expect(ctxAfterDelete.messages[0].role).toBe("user");
			expect(ctxAfterDelete.messages[1].role).toBe("assistant");
		});

		it("deleting toolResult only is valid (assistant without response is fine)", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "let me read that", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "file contents here"),
				msg("4", "3", "assistant", "here is the file"),
				deletion("5", "4", ["3"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("assistant");
		});

		it("deleting one toolCall from assistant with multiple toolCalls", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read both files"),
				{
					type: "message",
					id: "2",
					parentId: "1",
					timestamp: "2025-01-01T00:00:00Z",
					message: {
						role: "assistant",
						content: [
							{ type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/a" } },
							{ type: "toolCall", id: "tc-2", name: "read", arguments: { path: "/b" } },
						],
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
						stopReason: "toolUse",
						timestamp: 1,
					},
				} as SessionMessageEntry,
				toolResultMsg("3", "2", "tc-1", "read", "contents of a"),
				toolResultMsg("4", "3", "tc-2", "read", "contents of b"),
				deletion("5", "4", ["4"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("assistant");
			expect(ctx.messages[2].role).toBe("toolResult");
		});
	});

	describe("deletion not on active path is ignored", () => {
		it("deletion on a different branch does not affect current path", () => {
			// Tree: 1 -> 2 -> 3 (branch A)
			//            \-> 4 -> 5(deletion of 2) (branch B)
			// Path A = 1 -> 2 -> 3: no deletion, all 3 messages
			// Path B = 1 -> 2 -> 4 -> 5: deletion removes 2, leaving 1, 4
			const entries: SessionEntry[] = [
				msg("1", null, "user", "start"),
				msg("2", "1", "assistant", "r1"),
				msg("3", "2", "user", "branch A"),
				msg("4", "2", "user", "branch B"),
				deletion("5", "4", ["2"]),
			];
			const ctxA = buildSessionContext(entries, "3");
			expect(ctxA.messages).toHaveLength(3);
			expect(ctxA.messages[1].role).toBe("assistant");

			const ctxB = buildSessionContext(entries, "5");
			expect(ctxB.messages).toHaveLength(2);
			expect(ctxB.messages[0].role).toBe("user");
			expect((ctxB.messages[0] as any).content).toBe("start");
			expect(ctxB.messages[1].role).toBe("user");
			expect((ctxB.messages[1] as any).content).toBe("branch B");
		});
	});
});

describe("SegmentSummaryEntry", () => {
	describe("basic segment compression", () => {
		it("replaces targetIds with a single summary message", () => {
			// Path: 1(user) -> 2(assistant) -> 3(user) -> 4(assistant) -> 5(segSummary[2,3]) -> 6(user)
			// After filtering: 1(user), summary(replacing 2,3), 4(assistant), 6(user) = 4 messages
			const entries: SessionEntry[] = [
				msg("1", null, "user", "hello"),
				msg("2", "1", "assistant", "hi"),
				msg("3", "2", "user", "how are you"),
				msg("4", "3", "assistant", "great"),
				segmentSummary("5", "4", ["2", "3"], "User greeted and asked how assistant was"),
				msg("6", "5", "user", "next question"),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(4);
			expect(ctx.messages[0].role).toBe("user");
			expect((ctx.messages[0] as any).content).toBe("hello");
			expect(ctx.messages[1].role).toBe("segmentSummary");
			expect((ctx.messages[1] as any).summary).toBe("User greeted and asked how assistant was");
			expect(ctx.messages[2].role).toBe("assistant");
			expect(ctx.messages[3].role).toBe("user");
			expect((ctx.messages[3] as any).content).toBe("next question");
		});

		it("summary message replaces at the position of the first targetId", () => {
			// Path: 1 -> 2 -> 3 -> 4 -> 5(segSummary[2,3])
			// After: 1, summary(at position of 2), 4 = 3 messages
			const entries: SessionEntry[] = [
				msg("1", null, "user", "hello"),
				msg("2", "1", "assistant", "hi"),
				msg("3", "2", "user", "question"),
				msg("4", "3", "assistant", "answer"),
				segmentSummary("5", "4", ["2", "3"], "Summary of Q&A"),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("user");
			expect((ctx.messages[0] as any).content).toBe("hello");
			expect(ctx.messages[1].role).toBe("segmentSummary");
			const summaryMsg = ctx.messages[1] as any;
			expect(summaryMsg.summary).toContain("Summary of Q&A");
			expect(ctx.messages[2].role).toBe("assistant");
		});

		it("multiple segment summaries compress different segments independently", () => {
			// Path: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7(seg[2,3]) -> 8(seg[4,5])
			// After: 1, summary1(at 2), summary2(at 4), 6 = 4 messages
			const entries: SessionEntry[] = [
				msg("1", null, "user", "q1"),
				msg("2", "1", "assistant", "a1"),
				msg("3", "2", "user", "q2"),
				msg("4", "3", "assistant", "a2"),
				msg("5", "4", "user", "q3"),
				msg("6", "5", "assistant", "a3"),
				segmentSummary("7", "6", ["2", "3"], "Summary of turn 1-2"),
				segmentSummary("8", "7", ["4", "5"], "Summary of turn 3-4"),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(4);
			expect(ctx.messages[0].role).toBe("user");
			expect((ctx.messages[0] as any).content).toBe("q1");
			expect(ctx.messages[1].role).toBe("segmentSummary");
			expect(ctx.messages[2].role).toBe("segmentSummary");
			expect(ctx.messages[3].role).toBe("assistant");
		});

		it("segment summary with toolCall and toolResult replaced as a unit", () => {
			// Path: 1(user) -> 2(toolCall) -> 3(toolResult) -> 4(assistant) -> 5(seg[2,3,4]) -> 6(user)
			// After: 1(user), summary(replacing 2,3,4), 6(user) = 3 messages
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "reading", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "contents"),
				msg("4", "3", "assistant", "here is the content"),
				segmentSummary("5", "4", ["2", "3", "4"], "Read foo.txt and summarized"),
				msg("6", "5", "user", "next"),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("user");
			expect((ctx.messages[0] as any).content).toBe("read foo.txt");
			expect(ctx.messages[1].role).toBe("segmentSummary");
			const noToolResults = ctx.messages.every((m) => m.role !== "toolResult");
			expect(noToolResults).toBe(true);
			expect(ctx.messages[2].role).toBe("user");
			expect((ctx.messages[2] as any).content).toBe("next");
		});
	});

	describe("segment not on active path is ignored", () => {
		it("segment summary on a different branch does not affect current path", () => {
			// Tree: 1 -> 2 -> 3 -> 4(seg[2]) -> 5 (branch A, has segment)
			//            \-> 6 (branch B, no segment)
			// Path A = 1 -> 2 -> 3 -> 4 -> 5: segment replaces 2 with summary
			// Path B = 1 -> 2 -> 6: no segment, all 3 messages intact
			const entries: SessionEntry[] = [
				msg("1", null, "user", "start"),
				msg("2", "1", "assistant", "r1"),
				msg("3", "2", "user", "branch A"),
				segmentSummary("4", "3", ["2"], "Compressed r1"),
				msg("5", "4", "user", "branch A continues"),
				msg("6", "2", "user", "branch B"),
			];
			const ctxA = buildSessionContext(entries, "5");
			// 1(user) + summary(replacing 2) + 3(user) + 5(user) = 4 messages
			expect(ctxA.messages).toHaveLength(4);

			const ctxB = buildSessionContext(entries, "6");
			expect(ctxB.messages).toHaveLength(3);
			expect(ctxB.messages[1].role).toBe("assistant");
		});
	});
});

describe("Deletion + Compaction interaction", () => {
	it("deletion within compacted range is harmless (already skipped)", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "first"),
			msg("2", "1", "assistant", "r1"),
			msg("3", "2", "user", "second"),
			msg("4", "3", "assistant", "r2"),
			compaction("5", "4", "Summary", "3"),
			deletion("6", "5", ["1", "2"]),
			msg("7", "6", "user", "third"),
		];
		const ctx = buildSessionContext(entries);
		expect(ctx.messages).toHaveLength(4);
	});

	it("deletion within kept range after compaction removes messages", () => {
		// compaction keeps from "3", then deletion removes "3"
		// Path: 1 -> 2 -> 3 -> 4 -> 5(compaction keep from 3) -> 6(deletion[3]) -> 7
		// Compaction: summary + kept(3,4) + after(6,7)
		// Deletion removes 3 from kept: summary + kept(4) + after(6,7)
		const entries: SessionEntry[] = [
			msg("1", null, "user", "first"),
			msg("2", "1", "assistant", "r1"),
			msg("3", "2", "user", "second"),
			msg("4", "3", "assistant", "r2"),
			compaction("5", "4", "Summary", "3"),
			deletion("6", "5", ["3"]),
			msg("7", "6", "user", "third"),
		];
		const ctx = buildSessionContext(entries);
		// summary + 4(assistant) + 6(deletion, no message) + 7(user) = 3 messages
		expect(ctx.messages).toHaveLength(3);
		const userMsgs = ctx.messages.filter((m) => m.role === "user");
		const assistantMsgs = ctx.messages.filter((m) => m.role === "assistant");
		expect(userMsgs).toHaveLength(1);
		expect(assistantMsgs).toHaveLength(1);
	});

	it("deletion after compaction removes post-compaction messages", () => {
		// compaction keeps from "1", so summary + 1(user) + 2(assistant)
		// then deletion removes 4,5
		// Path: 1 -> 2 -> 3(compaction keep from 1) -> 4 -> 5 -> 6(deletion[4,5])
		const entries: SessionEntry[] = [
			msg("1", null, "user", "first"),
			msg("2", "1", "assistant", "r1"),
			compaction("3", "2", "Summary", "1"),
			msg("4", "3", "user", "second"),
			msg("5", "4", "assistant", "r2"),
			deletion("6", "5", ["4", "5"]),
		];
		const ctx = buildSessionContext(entries);
		// summary + kept(1,2) - after compaction: 4,5 deleted, 6(deletion, no message)
		// = summary + 1(user) + 2(assistant) = 3 messages
		expect(ctx.messages).toHaveLength(3);
		expect((ctx.messages[0] as any).summary).toContain("Summary");
		expect(ctx.messages[1].role).toBe("user");
	});
});

describe("SegmentSummary + Compaction interaction", () => {
	it("segment summary within compacted range is harmless", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "first"),
			msg("2", "1", "assistant", "r1"),
			msg("3", "2", "user", "second"),
			msg("4", "3", "assistant", "r2"),
			compaction("5", "4", "Compaction summary", "3"),
			segmentSummary("6", "5", ["2"], "Segment summary"),
			msg("7", "6", "user", "third"),
		];
		const ctx = buildSessionContext(entries);
		expect(ctx.messages).toHaveLength(4);
		expect((ctx.messages[0] as any).summary).toContain("Compaction summary");
	});

	it("segment summary and deletion can coexist", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "a"),
			msg("2", "1", "assistant", "b"),
			msg("3", "2", "user", "c"),
			msg("4", "3", "assistant", "d"),
			msg("5", "4", "user", "e"),
			segmentSummary("6", "5", ["2", "3"], "Summary of b,c"),
			deletion("7", "6", ["4"]),
		];
		// Path: 1 -> 2 -> 3 -> 4 -> 5 -> 6(seg[2,3]) -> 7(del[4])
		// After: 1(user), summary(replacing 2,3), 5(user) = 3 messages
		const ctx = buildSessionContext(entries);
		expect(ctx.messages).toHaveLength(3);
		expect(ctx.messages[0].role).toBe("user");
		expect((ctx.messages[0] as any).content).toBe("a");
		expect(ctx.messages[1].role).toBe("segmentSummary");
		expect(ctx.messages[2].role).toBe("user");
		expect((ctx.messages[2] as any).content).toBe("e");
	});
});

describe("Edge cases", () => {
	it("deleting entry that is on another branch does not affect current branch", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "shared"),
			msg("2", "1", "assistant", "r1"),
			msg("3", "2", "user", "A only"),
			msg("4", "2", "user", "B only"),
			deletion("5", "4", ["2"]),
		];
		const ctxA = buildSessionContext(entries, "3");
		expect(ctxA.messages).toHaveLength(3);
		expect(ctxA.messages[1].role).toBe("assistant");
	});

	it("deletion entry with empty targetIds has no effect", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "hello"),
			msg("2", "1", "assistant", "hi"),
			deletion("3", "2", []),
		];
		const ctx = buildSessionContext(entries);
		expect(ctx.messages).toHaveLength(2);
	});

	it("segment summary with empty targetIds produces only a summary message", () => {
		// Empty targetIds: summary is inserted but nothing removed
		// Path: 1 -> 2 -> 3(seg[]) -> no more entries
		// Actually seg entry "3" has no targetIds to replace, so nothing is replaced
		// and no summary is generated (because first targetId check fails)
		// Result: 1(user), 2(assistant) = 2 messages
		const entries: SessionEntry[] = [
			msg("1", null, "user", "hello"),
			msg("2", "1", "assistant", "hi"),
			segmentSummary("3", "2", [], "Extra context injected"),
		];
		const ctx = buildSessionContext(entries);
		expect(ctx.messages).toHaveLength(2);
	});

	it("order of operations: deletion before segment summary on same target", () => {
		const entries: SessionEntry[] = [
			msg("1", null, "user", "a"),
			msg("2", "1", "assistant", "b"),
			msg("3", "2", "user", "c"),
			segmentSummary("4", "3", ["2"], "Summary of b"),
			deletion("5", "4", ["2"]),
		];
		// Path: 1 -> 2 -> 3 -> 4(seg[2]) -> 5(del[2])
		// seg[2] replaces 2 with summary, then del[2] also marks 2 as deleted
		// Since 2 is in segmentReplaceTargets, summary is emitted at position of 2
		// deletedIds check comes first in appendMessage, but 2 is not in deletedIds wait...
		// Actually 2 IS in deletedIds. But it's also in segmentReplaceTargets.
		// appendMessage checks deletedIds first, so 2 would be skipped entirely.
		// But segmentReplaceTargets also catches 2. Since deletedIds check is first, 2 is skipped.
		// No summary emitted. Result: 1(user), 3(user) = 2 messages
		const ctx = buildSessionContext(entries);
		expect(ctx.messages).toHaveLength(2);
		expect(ctx.messages[0].role).toBe("user");
		expect((ctx.messages[0] as any).content).toBe("a");
	});
});

describe("toolResult cascade protection", () => {
	describe("auto-cascade: deleting toolResult auto-cascades to remove matching toolCall from assistant", () => {
		it("deleting only toolResult removes the orphaned toolCall from assistant content", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "reading", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "file contents"),
				msg("4", "3", "user", "next question"),
				deletion("5", "4", ["3"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("assistant");
			expect(ctx.messages[2].role).toBe("user");

			const assistant = ctx.messages[1] as any;
			const toolCalls = assistant.content?.filter?.((c: any) => c.type === "toolCall") ?? [];
			expect(toolCalls).toHaveLength(0);

			const hasOrphanedToolResult = ctx.messages.some((m) => m.role === "toolResult");
			expect(hasOrphanedToolResult).toBe(false);
		});

		it("deleting only toolResult when assistant has text + toolCall keeps the text", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "let me read that file", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "file contents"),
				msg("4", "3", "user", "next question"),
				deletion("5", "4", ["3"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			const assistant = ctx.messages[1] as any;
			const textParts = assistant.content?.filter?.((c: any) => c.type === "text") ?? [];
			const toolCalls = assistant.content?.filter?.((c: any) => c.type === "toolCall") ?? [];
			expect(textParts.length).toBeGreaterThan(0);
			expect(toolCalls).toHaveLength(0);
		});

		it("deleting one toolResult when assistant has multiple toolCalls removes only that toolCall", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read both files"),
				{
					type: "message",
					id: "2",
					parentId: "1",
					timestamp: "2025-01-01T00:00:00Z",
					message: {
						role: "assistant",
						content: [
							{ type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/a" } },
							{ type: "toolCall", id: "tc-2", name: "read", arguments: { path: "/b" } },
						],
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
						stopReason: "toolUse",
						timestamp: 1,
					},
				} as SessionMessageEntry,
				toolResultMsg("3", "2", "tc-1", "read", "contents of a"),
				toolResultMsg("4", "3", "tc-2", "read", "contents of b"),
				deletion("5", "4", ["4"]),
			];
			const ctx = buildSessionContext(entries);

			const toolResults = ctx.messages.filter((m) => m.role === "toolResult");
			expect(toolResults).toHaveLength(1);
			expect((toolResults[0] as any).toolCallId).toBe("tc-1");

			const assistant = ctx.messages.find((m) => m.role === "assistant") as any;
			const toolCalls = assistant.content?.filter?.((c: any) => c.type === "toolCall") ?? [];
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0].id).toBe("tc-1");
		});

		it("deleting assistant(toolCall) also cascades to delete matching toolResult", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "reading", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "file contents"),
				msg("4", "3", "user", "next question"),
				deletion("5", "4", ["2"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("user");

			const hasOrphanedToolResult = ctx.messages.some((m) => m.role === "toolResult");
			expect(hasOrphanedToolResult).toBe(false);
		});

		it("deleting both assistant and toolResult explicitly works correctly", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "reading", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "file contents"),
				msg("4", "3", "user", "next question"),
				deletion("5", "4", ["2", "3"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
			const hasOrphanedToolResult = ctx.messages.some((m) => m.role === "toolResult");
			expect(hasOrphanedToolResult).toBe(false);
		});

		it("deleting user message does not cascade", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "read foo.txt"),
				toolCallMsg("2", "1", "reading", "tc-1", "read"),
				toolResultMsg("3", "2", "tc-1", "read", "file contents"),
				msg("4", "3", "user", "next question"),
				deletion("5", "4", ["1"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("assistant");
			expect(ctx.messages[1].role).toBe("toolResult");
			expect(ctx.messages[2].role).toBe("user");
		});

		it("deleting plain assistant (no toolCall) does not cascade", () => {
			const entries: SessionEntry[] = [
				msg("1", null, "user", "hello"),
				msg("2", "1", "assistant", "hi"),
				msg("3", "2", "user", "how are you"),
				deletion("4", "3", ["2"]),
			];
			const ctx = buildSessionContext(entries);
			expect(ctx.messages).toHaveLength(2);
		});
	});
});
