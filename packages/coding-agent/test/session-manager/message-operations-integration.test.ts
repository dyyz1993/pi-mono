import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type DeletionEntry,
	loadEntriesFromFile,
	type SegmentSummaryEntry,
	SessionManager,
} from "../../src/core/session-manager.js";
import { assistantMsg, userMsg } from "../utilities.js";

function toolCallAssistantMsg(toolCallId: string, toolName: string, text = "using tool") {
	return {
		role: "assistant" as const,
		content: [
			{ type: "text" as const, text },
			{ type: "toolCall" as const, id: toolCallId, name: toolName, arguments: { path: "/foo" } },
		],
		api: "anthropic-messages" as const,
		provider: "anthropic",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse" as const,
		timestamp: Date.now(),
	};
}

function toolResultMsg(toolCallId: string, toolName: string, resultText: string) {
	return {
		role: "toolResult" as const,
		toolCallId,
		toolName,
		content: [{ type: "text" as const, text: resultText }],
		isError: false,
		timestamp: Date.now(),
	};
}

describe("SessionManager appendDeletion", () => {
	describe("in-memory append", () => {
		it("appends deletion entry with correct parentId chain", () => {
			const session = SessionManager.inMemory();
			const _id1 = session.appendMessage(userMsg("hello"));
			const id2 = session.appendMessage(assistantMsg("hi"));
			const delId = session.appendDeletion([id2]);

			const entries = session.getEntries();
			expect(entries).toHaveLength(3);

			const delEntry = entries[2] as DeletionEntry;
			expect(delEntry.type).toBe("deletion");
			expect(delEntry.id).toBe(delId);
			expect(delEntry.parentId).toBe(id2);
			expect(delEntry.targetIds).toEqual([id2]);
		});

		it("appends deletion with multiple targetIds", () => {
			const session = SessionManager.inMemory();
			const _id1 = session.appendMessage(userMsg("a"));
			const id2 = session.appendMessage(assistantMsg("b"));
			const id3 = session.appendMessage(userMsg("c"));
			session.appendDeletion([id2, id3]);

			const delEntry = session.getEntries().find((e) => e.type === "deletion") as DeletionEntry;
			expect(delEntry).toBeDefined();
			expect(delEntry.targetIds).toEqual([id2, id3]);
			expect(delEntry.parentId).toBe(id3);
		});

		it("deletion advances leaf pointer", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("hello"));
			const delId = session.appendDeletion(["nonexistent"]);
			const _nextId = session.appendMessage(assistantMsg("after deletion"));
			const entries = session.getEntries();
			expect(entries[2].parentId).toBe(delId);
		});

		it("deletion with empty targetIds is still appended", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("hello"));
			session.appendDeletion([]);

			const delEntry = session.getEntries()[1] as DeletionEntry;
			expect(delEntry.type).toBe("deletion");
			expect(delEntry.targetIds).toEqual([]);
		});
	});

	describe("buildSessionContext integration", () => {
		it("deletion via SessionManager excludes messages from context", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("hello"));
			const asstId = session.appendMessage(assistantMsg("hi"));
			session.appendMessage(userMsg("how are you"));
			session.appendDeletion([asstId]);

			const ctx = session.buildSessionContext();
			expect(ctx.messages).toHaveLength(2);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("user");
		});

		it("deletion after branching only affects active path", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("start"));
			const id2 = session.appendMessage(assistantMsg("r1"));
			session.appendMessage(userMsg("branch A"));

			session.branch(id2);
			session.appendMessage(userMsg("branch B"));
			session.appendDeletion([id2]);

			const ctxB = session.buildSessionContext();
			expect(ctxB.messages).toHaveLength(2);
			expect(ctxB.messages[0].role).toBe("user");
			expect(ctxB.messages[1].role).toBe("user");
		});

		it("deleting toolCall and toolResult together via SessionManager", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("read foo.txt"));
			const tcId = session.appendMessage(toolCallAssistantMsg("tc-1", "read"));
			const trId = session.appendMessage(toolResultMsg("tc-1", "read", "contents"));
			session.appendMessage(assistantMsg("here is the content"));
			session.appendDeletion([tcId, trId]);

			const ctx = session.buildSessionContext();
			expect(ctx.messages).toHaveLength(2);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("assistant");
			const hasToolResult = ctx.messages.some((m) => m.role === "toolResult");
			expect(hasToolResult).toBe(false);
		});
	});
});

describe("SessionManager appendSegmentSummary", () => {
	describe("in-memory append", () => {
		it("appends segment_summary entry with correct fields", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("hello"));
			const id2 = session.appendMessage(assistantMsg("hi"));
			const id3 = session.appendMessage(userMsg("how are you"));
			const segId = session.appendSegmentSummary([id2, id3], "Summary of greeting exchange");

			const entries = session.getEntries();
			expect(entries).toHaveLength(4);

			const segEntry = entries[3] as SegmentSummaryEntry;
			expect(segEntry.type).toBe("segment_summary");
			expect(segEntry.id).toBe(segId);
			expect(segEntry.parentId).toBe(id3);
			expect(segEntry.targetIds).toEqual([id2, id3]);
			expect(segEntry.summary).toBe("Summary of greeting exchange");
		});

		it("segment summary advances leaf pointer", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("hello"));
			const segId = session.appendSegmentSummary(["some-id"], "summary");
			session.appendMessage(assistantMsg("after summary"));
			const entries = session.getEntries();
			expect(entries[2].parentId).toBe(segId);
		});
	});

	describe("buildSessionContext integration", () => {
		it("segment summary via SessionManager replaces target messages", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("hello"));
			const id2 = session.appendMessage(assistantMsg("hi"));
			const id3 = session.appendMessage(userMsg("how are you"));
			session.appendMessage(assistantMsg("great"));
			session.appendSegmentSummary([id2, id3], "User greeted and asked how assistant was");
			session.appendMessage(userMsg("next question"));

			const ctx = session.buildSessionContext();
			expect(ctx.messages).toHaveLength(4);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("segmentSummary");
			expect(ctx.messages[2].role).toBe("assistant");
			expect(ctx.messages[3].role).toBe("user");
		});

		it("segment summary with toolCall+toolResult as a complete unit", () => {
			const session = SessionManager.inMemory();
			session.appendMessage(userMsg("read foo.txt"));
			const id2 = session.appendMessage(toolCallAssistantMsg("tc-1", "read"));
			const id3 = session.appendMessage(toolResultMsg("tc-1", "read", "contents"));
			const id4 = session.appendMessage(assistantMsg("here is the content"));
			session.appendSegmentSummary([id2, id3, id4], "Read and summarized foo.txt");
			session.appendMessage(userMsg("next"));

			const ctx = session.buildSessionContext();
			expect(ctx.messages).toHaveLength(3);
			expect(ctx.messages[0].role).toBe("user");
			expect(ctx.messages[1].role).toBe("segmentSummary");
			expect(ctx.messages[2].role).toBe("user");
		});
	});
});

describe("SessionManager jsonl persistence", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-ops-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("deletion entry persists to jsonl and reloads correctly", () => {
		const session = SessionManager.create(tempDir, tempDir);
		const _id1 = session.appendMessage(userMsg("hello"));
		const id2 = session.appendMessage(assistantMsg("hi"));
		session.appendDeletion([id2]);

		const sessionFile = session.getSessionFile()!;
		const rawContent = readFileSync(sessionFile, "utf-8");
		const lines = rawContent.trim().split("\n");
		expect(lines).toHaveLength(4);

		const delLine = JSON.parse(lines[3]);
		expect(delLine.type).toBe("deletion");
		expect(delLine.targetIds).toEqual([id2]);

		const loaded = loadEntriesFromFile(sessionFile);
		const delEntry = loaded.find((e) => e.type === "deletion") as DeletionEntry;
		expect(delEntry).toBeDefined();
		expect(delEntry.targetIds).toEqual([id2]);
	});

	it("segment_summary entry persists to jsonl and reloads correctly", () => {
		const session = SessionManager.create(tempDir, tempDir);
		const _id1 = session.appendMessage(userMsg("hello"));
		const id2 = session.appendMessage(assistantMsg("hi"));
		session.appendSegmentSummary([id2], "Summary of hi");

		const sessionFile = session.getSessionFile()!;
		const rawContent = readFileSync(sessionFile, "utf-8");
		const lines = rawContent.trim().split("\n");
		expect(lines).toHaveLength(4);

		const segLine = JSON.parse(lines[3]);
		expect(segLine.type).toBe("segment_summary");
		expect(segLine.targetIds).toEqual([id2]);
		expect(segLine.summary).toBe("Summary of hi");

		const loaded = loadEntriesFromFile(sessionFile);
		const segEntry = loaded.find((e) => e.type === "segment_summary") as SegmentSummaryEntry;
		expect(segEntry).toBeDefined();
		expect(segEntry.targetIds).toEqual([id2]);
		expect(segEntry.summary).toBe("Summary of hi");
	});

	it("full reload: session with deletion produces same context", () => {
		const session1 = SessionManager.create(tempDir, tempDir);
		const _id1 = session1.appendMessage(userMsg("hello"));
		const id2 = session1.appendMessage(assistantMsg("hi"));
		session1.appendMessage(userMsg("how are you"));
		session1.appendDeletion([id2]);

		const ctxOriginal = session1.buildSessionContext();
		const sessionFile = session1.getSessionFile()!;

		const session2 = SessionManager.open(sessionFile, tempDir);
		const ctxReloaded = session2.buildSessionContext();
		expect(ctxReloaded.messages).toHaveLength(ctxOriginal.messages.length);
		expect(ctxReloaded.messages[0].role).toBe("user");
		expect(ctxReloaded.messages[1].role).toBe("user");
	});

	it("full reload: session with segment_summary produces same context", () => {
		const session1 = SessionManager.create(tempDir, tempDir);
		session1.appendMessage(userMsg("hello"));
		const id2 = session1.appendMessage(assistantMsg("hi"));
		const id3 = session1.appendMessage(userMsg("how are you"));
		session1.appendMessage(assistantMsg("great"));
		session1.appendSegmentSummary([id2, id3], "Greeting exchange");
		session1.appendMessage(userMsg("next"));

		const ctxOriginal = session1.buildSessionContext();
		const sessionFile = session1.getSessionFile()!;

		const session2 = SessionManager.open(sessionFile, tempDir);
		const ctxReloaded = session2.buildSessionContext();
		expect(ctxReloaded.messages).toHaveLength(ctxOriginal.messages.length);
		expect(ctxReloaded.messages[1].role).toBe("segmentSummary");
	});

	it("full reload: session with deletion + segment_summary + compaction", () => {
		const session1 = SessionManager.create(tempDir, tempDir);
		session1.appendMessage(userMsg("q1"));
		const id2 = session1.appendMessage(assistantMsg("a1"));
		session1.appendMessage(userMsg("q2"));
		const id4 = session1.appendMessage(assistantMsg("a2"));
		session1.appendSegmentSummary([id2], "Summary of a1");
		session1.appendMessage(userMsg("q3"));
		session1.appendMessage(assistantMsg("a3"));
		session1.appendDeletion([id4]);
		session1.appendMessage(userMsg("q4"));

		const ctxOriginal = session1.buildSessionContext();
		const sessionFile = session1.getSessionFile()!;

		const session2 = SessionManager.open(sessionFile, tempDir);
		const ctxReloaded = session2.buildSessionContext();
		expect(ctxReloaded.messages).toHaveLength(ctxOriginal.messages.length);
	});
});

describe("_buildIndex compatibility", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-index-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("_buildIndex handles deletion entries without crashing", () => {
		const session1 = SessionManager.create(tempDir, tempDir);
		session1.appendMessage(userMsg("hello"));
		session1.appendDeletion(["some-id"]);
		session1.appendMessage(assistantMsg("response"));
		const sessionFile = session1.getSessionFile()!;

		const session2 = SessionManager.open(sessionFile, tempDir);
		const entries = session2.getEntries();
		expect(entries.filter((e) => e.type === "message")).toHaveLength(2);
		expect(entries.filter((e) => e.type === "deletion")).toHaveLength(1);
		expect(session2.getLeafId()).toBeDefined();
	});

	it("_buildIndex handles segment_summary entries without crashing", () => {
		const session1 = SessionManager.create(tempDir, tempDir);
		session1.appendMessage(userMsg("hello"));
		session1.appendSegmentSummary(["some-id"], "summary text");
		session1.appendMessage(assistantMsg("response"));
		const sessionFile = session1.getSessionFile()!;

		const session2 = SessionManager.open(sessionFile, tempDir);
		const entries = session2.getEntries();
		expect(entries.filter((e) => e.type === "segment_summary")).toHaveLength(1);
	});

	it("_buildIndex handles raw jsonl with only deletion entry (no messages)", () => {
		const sessionFile = join(tempDir, "raw.jsonl");
		writeFileSync(
			sessionFile,
			'{"type":"session","id":"test1","version":3,"timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				'{"type":"deletion","id":"d1","parentId":null,"timestamp":"2025-01-01T00:00:00Z","targetIds":["nonexistent"]}\n',
		);

		const session = SessionManager.open(sessionFile, tempDir);
		const entries = session.getEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe("deletion");
		expect(session.getLeafId()).toBe("d1");
	});

	it("_buildIndex handles raw jsonl with only segment_summary entry (no messages)", () => {
		const sessionFile = join(tempDir, "raw2.jsonl");
		writeFileSync(
			sessionFile,
			'{"type":"session","id":"test1","version":3,"timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				'{"type":"segment_summary","id":"s1","parentId":null,"timestamp":"2025-01-01T00:00:00Z","targetIds":[],"summary":"empty"}\n',
		);

		const session = SessionManager.open(sessionFile, tempDir);
		const entries = session.getEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe("segment_summary");
		expect(session.getLeafId()).toBe("s1");
	});

	it("_buildIndex handles mixed v3 session with all entry types", () => {
		const session1 = SessionManager.create(tempDir, tempDir);
		session1.appendMessage(userMsg("msg1"));
		session1.appendThinkingLevelChange("high");
		session1.appendMessage(assistantMsg("msg2"));
		session1.appendModelChange("anthropic", "claude-4");
		session1.appendDeletion(["some-id"]);
		session1.appendSegmentSummary(["some-other-id"], "summary");
		session1.appendMessage(userMsg("msg3"));
		const sessionFile = session1.getSessionFile()!;

		const session2 = SessionManager.open(sessionFile, tempDir);
		const entries = session2.getEntries();
		expect(entries.filter((e) => e.type === "message")).toHaveLength(3);
		expect(entries.filter((e) => e.type === "deletion")).toHaveLength(1);
		expect(entries.filter((e) => e.type === "segment_summary")).toHaveLength(1);
		expect(entries.filter((e) => e.type === "thinking_level_change")).toHaveLength(1);
		expect(entries.filter((e) => e.type === "model_change")).toHaveLength(1);

		const ctx = session2.buildSessionContext();
		expect(ctx.thinkingLevel).toBe("high");
	});
});

describe("Compaction interaction with deletion/segment_summary entries", () => {
	it("buildSessionContext with compaction + deletion in kept range", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMsg("first"));
		session.appendMessage(assistantMsg("r1"));
		const id3 = session.appendMessage(userMsg("second"));
		session.appendMessage(assistantMsg("r2"));

		session.appendCompaction("Compacted early history", id3, 1000);

		session.appendDeletion([id3]);

		const ctx = session.buildSessionContext();
		expect(ctx.messages).toHaveLength(2);
		const summaries = ctx.messages.filter((m: any) => m.role === "compactionSummary");
		expect(summaries).toHaveLength(1);
	});

	it("buildSessionContext with compaction + segment_summary in kept range", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMsg("first"));
		const _id2 = session.appendMessage(assistantMsg("r1"));
		const id3 = session.appendMessage(userMsg("second"));
		session.appendMessage(assistantMsg("r2"));

		session.appendCompaction("Compacted early history", id3, 1000);

		session.appendSegmentSummary([id3], "Summarized second question");

		session.appendMessage(userMsg("third"));

		const ctx = session.buildSessionContext();
		const segSummaries = ctx.messages.filter((m: any) => m.role === "segmentSummary");
		expect(segSummaries).toHaveLength(1);
	});
});

describe("convertToLlm for SegmentSummaryMessage", () => {
	it("segmentSummary message converts to user message with summary tags", async () => {
		const { convertToLlm } = await import("../../src/core/messages.js");
		const messages = [
			{ role: "user" as const, content: "hello", timestamp: 1 },
			{ role: "segmentSummary" as const, summary: "This is a test summary", timestamp: 2 },
			{ role: "user" as const, content: "next question", timestamp: 3 },
		];

		const converted = convertToLlm(messages as any);
		expect(converted).toHaveLength(3);
		expect(converted[0].role).toBe("user");
		expect(converted[1].role).toBe("user");
		expect(converted[2].role).toBe("user");

		const summaryContent = (converted[1].content as any)[0].text;
		expect(summaryContent).toContain("<summary>");
		expect(summaryContent).toContain("This is a test summary");
		expect(summaryContent).toContain("</summary>");
	});

	it("segmentSummary with empty summary still produces valid message", async () => {
		const { convertToLlm } = await import("../../src/core/messages.js");
		const messages = [{ role: "segmentSummary" as const, summary: "", timestamp: 1 }];

		const converted = convertToLlm(messages as any);
		expect(converted).toHaveLength(1);
		expect(converted[0].role).toBe("user");
		expect((converted[0].content as any)[0].text).toContain("<summary>");
	});

	it("segmentSummary produces message prefixed with explanation text", async () => {
		const { convertToLlm } = await import("../../src/core/messages.js");
		const messages = [{ role: "segmentSummary" as const, summary: "compressed context", timestamp: 1 }];

		const converted = convertToLlm(messages as any);
		const text = (converted[0].content as any)[0].text;
		expect(text).toContain("compressed into this summary");
		expect(text).toContain("compressed context");
	});
});

describe("Branching with deletion/segment_summary", () => {
	it("branching after deletion preserves deletion on the original branch", () => {
		const session = SessionManager.inMemory();
		const _id1 = session.appendMessage(userMsg("start"));
		const id2 = session.appendMessage(assistantMsg("r1"));
		session.appendMessage(userMsg("after r1"));
		session.appendDeletion([id2]);

		const ctxBeforeBranch = session.buildSessionContext();
		expect(ctxBeforeBranch.messages).toHaveLength(2);

		session.branch(id2);
		session.appendMessage(userMsg("branched from r1"));

		const ctxAfterBranch = session.buildSessionContext();
		expect(ctxAfterBranch.messages).toHaveLength(3);
		expect(ctxAfterBranch.messages[0].role).toBe("user");
		expect(ctxAfterBranch.messages[1].role).toBe("assistant");
		expect(ctxAfterBranch.messages[2].role).toBe("user");
	});

	it("branching around segment_summary preserves it on original path only", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMsg("start"));
		const id2 = session.appendMessage(assistantMsg("r1"));
		session.appendMessage(userMsg("q2"));
		session.appendSegmentSummary([id2], "Summary of r1");
		const id5 = session.getLeafId()!;

		session.branch(id2);
		session.appendMessage(userMsg("took different path"));

		const ctxBranch = session.buildSessionContext();
		expect(ctxBranch.messages).toHaveLength(3);
		expect(ctxBranch.messages[1].role).toBe("assistant");

		session.branch(id5);
		const ctxOriginal = session.buildSessionContext();
		expect(ctxOriginal.messages.some((m: any) => m.role === "segmentSummary")).toBe(true);
	});

	it("deletion on branch B does not affect branch A when navigated back", () => {
		// Path A: 1 -> 2 -> 3
		// Path B: 1 -> 2 -> 4 -> del[2]
		// ctxA should be intact (3 messages)
		// ctxB should have 2 deleted (1 message: only msg "4")
		// Wait, path B is 1 -> 2 -> 4 -> del[2], deletion deletes 2
		// so ctxB = [msg1, msg4] = 2 messages
		const session = SessionManager.inMemory();
		session.appendMessage(userMsg("start"));
		const id2 = session.appendMessage(assistantMsg("r1"));
		const branchPoint = session.appendMessage(userMsg("path A"));

		session.branch(id2);
		session.appendMessage(userMsg("path B"));
		session.appendDeletion([id2]);

		const ctxB = session.buildSessionContext();
		expect(ctxB.messages).toHaveLength(2);
		expect(ctxB.messages[0].role).toBe("user");
		expect(ctxB.messages[1].role).toBe("user");

		session.branch(branchPoint);
		const ctxA = session.buildSessionContext();
		expect(ctxA.messages).toHaveLength(3);
		expect(ctxA.messages[1].role).toBe("assistant");
	});
});
