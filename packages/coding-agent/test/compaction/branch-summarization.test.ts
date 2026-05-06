import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
	type BranchSummaryDetails,
	collectEntriesForBranchSummary,
	prepareBranchEntries,
} from "../../src/core/compaction/branch-summarization.js";
import type { ReadonlySessionManager, SessionEntry } from "../../src/core/session-manager.js";

function makeEntry(
	overrides: Partial<SessionEntry> & { type: SessionEntry["type"]; id: string; parentId?: string | null },
): SessionEntry {
	return {
		parentId: null,
		timestamp: new Date().toISOString(),
		...overrides,
	} as SessionEntry;
}

function makeMessageEntry(
	id: string,
	role: AgentMessage["role"],
	content: string,
	parentId?: string | null,
): SessionEntry {
	const msg: AgentMessage = {
		role,
		content: [{ type: "text" as const, text: content }],
		timestamp: Date.now(),
	} as AgentMessage;
	return makeEntry({ type: "message", id, parentId: parentId ?? null, message: msg }) as SessionEntry;
}

function makeToolResultEntry(id: string, parentId?: string | null): SessionEntry {
	const msg = {
		role: "toolResult" as const,
		content: [{ type: "text" as const, text: "result" }],
		timestamp: Date.now(),
		toolCallId: "tc1",
	} as unknown as AgentMessage;
	return makeEntry({ type: "message", id, parentId: parentId ?? null, message: msg }) as SessionEntry;
}

function makeAssistantWithToolCalls(
	id: string,
	toolCalls: Array<{ name: string; args: Record<string, string> }>,
	parentId?: string | null,
): SessionEntry {
	const msg: AgentMessage = {
		role: "assistant",
		content: [
			{ type: "text", text: "Doing work" },
			...toolCalls.map((tc) => ({
				type: "toolCall" as const,
				id: `tc-${tc.name}`,
				name: tc.name,
				arguments: tc.args,
			})),
		],
		timestamp: Date.now(),
	} as unknown as AgentMessage;
	return makeEntry({ type: "message", id, parentId: parentId ?? null, message: msg }) as SessionEntry;
}

function makeBranchSummaryEntry(
	id: string,
	summary: string,
	details?: BranchSummaryDetails,
	fromHook?: boolean,
	parentId?: string | null,
): SessionEntry {
	return makeEntry({
		type: "branch_summary",
		id,
		parentId: parentId ?? null,
		fromId: "old-leaf",
		summary,
		details,
		fromHook,
	}) as SessionEntry;
}

function makeCompactionEntry(id: string, summary: string, parentId?: string | null): SessionEntry {
	return makeEntry({
		type: "compaction",
		id,
		parentId: parentId ?? null,
		summary,
		firstKeptEntryId: "kept-1",
		tokensBefore: 1000,
	}) as SessionEntry;
}

function makeCustomEntry(id: string, parentId?: string | null): SessionEntry {
	return makeEntry({
		type: "custom",
		id,
		parentId: parentId ?? null,
		customType: "my-ext",
	}) as SessionEntry;
}

function makeLabelEntry(id: string, parentId?: string | null): SessionEntry {
	return makeEntry({
		type: "label",
		id,
		parentId: parentId ?? null,
		targetId: "some-target",
		label: "my-label",
	}) as SessionEntry;
}

function mockSession(entries: SessionEntry[]): ReadonlySessionManager {
	const entryMap = new Map(entries.map((e) => [e.id, e]));

	return {
		getCwd: () => "/test",
		getEffectiveCwd: () => "/test",
		getSessionDir: () => "/test/.pi/sessions/test",
		getSessionId: () => "test-session",
		getSessionFile: () => "/test/.pi/sessions/test/session.jsonl",
		getLeafId: () => entries[entries.length - 1]?.id ?? null,
		getLeafEntry: () => entries[entries.length - 1] ?? null,
		getEntry: (id: string) => entryMap.get(id) ?? null,
		getLabel: () => undefined,
		getBranch: (leafId: string) => {
			const branch: SessionEntry[] = [];
			let current = entryMap.get(leafId);
			while (current) {
				branch.unshift(current);
				current = current.parentId ? entryMap.get(current.parentId) : undefined;
			}
			return branch;
		},
		getHeader: () =>
			({ type: "session", id: "test-session", timestamp: new Date().toISOString(), cwd: "/test" }) as any,
		getEntries: () => entries,
		getTree: () => ({}) as any,
		getSessionName: () => undefined,
	};
}

describe("collectEntriesForBranchSummary", () => {
	it("returns empty when oldLeafId is null", () => {
		const session = mockSession([]);
		const result = collectEntriesForBranchSummary(session, null, "target-1");
		expect(result.entries).toEqual([]);
		expect(result.commonAncestorId).toBeNull();
	});

	it("collects entries from old leaf back to common ancestor", () => {
		const root = makeEntry({ type: "message", id: "root", parentId: null });
		const mid = makeMessageEntry("mid", "user", "hello", "root");
		const oldLeaf = makeMessageEntry("old-leaf", "user", "goodbye", "mid");
		const newLeaf = makeMessageEntry("new-leaf", "user", "alternate", "mid");

		const session = mockSession([root, mid, oldLeaf, newLeaf]);
		const result = collectEntriesForBranchSummary(session, "old-leaf", "new-leaf");

		expect(result.commonAncestorId).toBe("mid");
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].id).toBe("old-leaf");
	});

	it("returns entries in chronological order", () => {
		const root = makeEntry({ type: "message", id: "root", parentId: null });
		const e1 = makeMessageEntry("e1", "user", "first", "root");
		const e2 = makeMessageEntry("e2", "user", "second", "e1");
		const e3 = makeMessageEntry("e3", "user", "third", "e2");
		const target = makeMessageEntry("target", "user", "target", "root");

		const session = mockSession([root, e1, e2, e3, target]);
		const result = collectEntriesForBranchSummary(session, "e3", "target");

		expect(result.commonAncestorId).toBe("root");
		expect(result.entries.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
	});

	it("returns all entries when target is root (no common ancestor except root)", () => {
		const root = makeEntry({ type: "message", id: "root", parentId: null });
		const e1 = makeMessageEntry("e1", "user", "hello", "root");
		const e2 = makeMessageEntry("e2", "user", "world", "e1");
		const target = makeEntry({ type: "message", id: "target", parentId: null });

		const session = mockSession([root, e1, e2, target]);
		const result = collectEntriesForBranchSummary(session, "e2", "target");

		expect(result.commonAncestorId).toBeNull();
		expect(result.entries).toHaveLength(3);
	});

	it("handles old leaf being the same as target (no branch)", () => {
		const root = makeEntry({ type: "message", id: "root", parentId: null });
		const leaf = makeMessageEntry("leaf", "user", "hello", "root");

		const session = mockSession([root, leaf]);
		const result = collectEntriesForBranchSummary(session, "leaf", "leaf");

		expect(result.commonAncestorId).toBe("leaf");
		expect(result.entries).toHaveLength(0);
	});

	it("returns empty when old leaf does not exist in session", () => {
		const session = mockSession([]);
		const result = collectEntriesForBranchSummary(session, "nonexistent", "target");
		expect(result.entries).toHaveLength(0);
	});
});

describe("prepareBranchEntries", () => {
	it("returns empty messages for empty entries", () => {
		const result = prepareBranchEntries([]);
		expect(result.messages).toEqual([]);
		expect(result.fileOps.read.size).toBe(0);
		expect(result.fileOps.edited.size).toBe(0);
		expect(result.fileOps.written.size).toBe(0);
		expect(result.totalTokens).toBe(0);
	});

	it("extracts messages from message entries", () => {
		const e1 = makeMessageEntry("e1", "user", "hello");
		const result = prepareBranchEntries([e1]);
		expect(result.messages).toHaveLength(1);
		expect(result.totalTokens).toBeGreaterThan(0);
	});

	it("skips tool result messages", () => {
		const toolResult = makeToolResultEntry("tr1");
		const result = prepareBranchEntries([toolResult]);
		expect(result.messages).toHaveLength(0);
	});

	it("skips non-conversation entries (label, custom)", () => {
		const label = makeLabelEntry("l1");
		const custom = makeCustomEntry("c1");
		const result = prepareBranchEntries([label, custom]);
		expect(result.messages).toHaveLength(0);
	});

	it("includes compaction entries as messages", () => {
		const compaction = makeCompactionEntry("comp1", "Summary of earlier conversation");
		const result = prepareBranchEntries([compaction]);
		expect(result.messages).toHaveLength(1);
	});

	it("includes branch summary entries as messages", () => {
		const branch = makeBranchSummaryEntry("bs1", "Summary of another branch");
		const result = prepareBranchEntries([branch]);
		expect(result.messages).toHaveLength(1);
	});

	it("extracts file ops from assistant tool calls", () => {
		const assistant = makeAssistantWithToolCalls("a1", [
			{ name: "read", args: { path: "/src/foo.ts" } },
			{ name: "edit", args: { path: "/src/bar.ts" } },
			{ name: "write", args: { path: "/src/baz.ts" } },
		]);
		const result = prepareBranchEntries([assistant]);
		expect(result.fileOps.read.has("/src/foo.ts")).toBe(true);
		expect(result.fileOps.edited.has("/src/bar.ts")).toBe(true);
		expect(result.fileOps.written.has("/src/baz.ts")).toBe(true);
	});

	it("collects file ops from branch_summary entries (non-hook)", () => {
		const bs = makeBranchSummaryEntry(
			"bs1",
			"summary",
			{
				readFiles: ["/a.ts", "/b.ts"],
				modifiedFiles: ["/c.ts"],
			},
			false,
		);
		const result = prepareBranchEntries([bs]);
		expect(result.fileOps.read.has("/a.ts")).toBe(true);
		expect(result.fileOps.read.has("/b.ts")).toBe(true);
		expect(result.fileOps.edited.has("/c.ts")).toBe(true);
	});

	it("skips file ops from hook-generated branch_summary entries", () => {
		const bs = makeBranchSummaryEntry(
			"bs1",
			"summary",
			{
				readFiles: ["/a.ts"],
				modifiedFiles: ["/c.ts"],
			},
			true,
		);
		const result = prepareBranchEntries([bs]);
		expect(result.fileOps.read.size).toBe(0);
		expect(result.fileOps.edited.size).toBe(0);
	});

	it("respects token budget when nonzero", () => {
		const longContent = "x".repeat(1000);
		const e1 = makeMessageEntry("e1", "user", longContent);
		const e2 = makeMessageEntry("e2", "user", longContent);
		const e3 = makeMessageEntry("e3", "user", longContent);

		const budget = 200;
		const result = prepareBranchEntries([e1, e2, e3], budget);

		expect(result.totalTokens).toBeLessThanOrEqual(budget + 250);
		expect(result.messages.length).toBeLessThan(3);
	});

	it("with budget 0 includes all messages", () => {
		const entries = Array.from({ length: 20 }, (_, i) => makeMessageEntry(`e${i}`, "user", `message ${i}`));
		const result = prepareBranchEntries(entries, 0);
		expect(result.messages).toHaveLength(20);
	});

	it("prefers newest messages when truncating due to budget", () => {
		const longContent = "y".repeat(800);
		const old = makeMessageEntry("old", "user", longContent);
		const recent = makeMessageEntry("recent", "user", "short");

		const budget = 300;
		const result = prepareBranchEntries([old, recent], budget);

		const hasRecent = result.messages.some((m) => {
			const content = (m as any).content;
			if (Array.isArray(content)) {
				return content.some((c: any) => c.text === "short");
			}
			return false;
		});
		expect(hasRecent).toBe(true);
	});

	it("cumulative file ops from branch_summary are collected even beyond budget", () => {
		const longContent = "z".repeat(2000);
		const bs = makeBranchSummaryEntry(
			"bs1",
			"summary",
			{
				readFiles: ["/deep-file.ts"],
				modifiedFiles: [],
			},
			false,
		);
		const e1 = makeMessageEntry("e1", "user", longContent);
		const e2 = makeMessageEntry("e2", "user", longContent);

		const result = prepareBranchEntries([bs, e1, e2], 100);
		expect(result.fileOps.read.has("/deep-file.ts")).toBe(true);
	});

	it("handles entries with invalid/malformed details gracefully", () => {
		const bs = makeBranchSummaryEntry("bs1", "summary", {} as any, false);
		const result = prepareBranchEntries([bs]);
		expect(result.fileOps.read.size).toBe(0);
	});
});
