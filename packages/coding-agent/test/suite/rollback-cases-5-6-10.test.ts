import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

function readFile(tempDir: string, relativePath: string): string {
	const absolute = join(tempDir, relativePath);
	return existsSync(absolute) ? readFileSync(absolute, "utf-8") : "";
}

function writeFile(tempDir: string, relativePath: string, content: string): void {
	const absolute = join(tempDir, relativePath);
	mkdirSync(join(absolute, ".."), { recursive: true });
	writeFileSync(absolute, content, "utf-8");
}

function deleteFile(tempDir: string, relativePath: string): void {
	const absolute = join(tempDir, relativePath);
	if (existsSync(absolute)) {
		rmSync(absolute);
	}
}

function fileExists(tempDir: string, relativePath: string): boolean {
	return existsSync(join(tempDir, relativePath));
}

function isOnPathTo(
	entries: Array<{ id: string; parentId: string | null }>,
	startId: string | null,
	targetId: string,
): boolean {
	if (!startId) return false;
	const byId = new Map(entries.map((e) => [e.id, e]));
	let current: string | null = startId;
	while (current !== null) {
		if (current === targetId) return true;
		const entry = byId.get(current);
		if (!entry) break;
		current = entry.parentId;
	}
	return false;
}

function findSnapshotsOnPath(
	entries: Array<{ id: string; parentId: string | null; type: string; customType?: string; data?: unknown }>,
	leafId: string | null,
): Map<string, string> {
	const result = new Map<string, string>();
	if (!leafId) return result;

	const snapEntries = entries.filter(
		(e) => e.type === "custom" && e.customType === "file-snapshot" && isOnPathTo(entries, leafId, e.id),
	);

	for (const entry of snapEntries) {
		if (entry.type !== "custom") continue;
		const data = entry.data as { path?: string; content?: string };
		if (data?.path && data.content !== undefined) {
			result.set(data.path, data.content);
		}
	}
	return result;
}

function createSnapshotAndRestoreExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("tool_result", async (event, ctx) => {
			if (event.toolName === "write" || event.toolName === "edit") {
				const path = event.input?.path as string | undefined;
				if (path) {
					try {
						pi.appendEntry("file-snapshot", {
							path,
							content: readFileSync(join(ctx.cwd, path), "utf-8"),
						});
					} catch {
						// ignore
					}
				}
			}
		});

		pi.on("session_tree", async (event, ctx) => {
			if (event.skipFiles) return;

			const targetId = event.newLeafId;
			if (!targetId) return;

			const entries = ctx.sessionManager.getEntries();
			const targetFiles = findSnapshotsOnPath(entries, targetId);
			const currentFiles = findSnapshotsOnPath(entries, event.oldLeafId);
			const filesToRestore = new Map<string, string | undefined>();
			for (const [path, content] of targetFiles) {
				filesToRestore.set(path, content);
			}
			for (const path of currentFiles.keys()) {
				if (!targetFiles.has(path)) {
					filesToRestore.set(path, undefined);
				}
			}

			if (filesToRestore.size === 0) return;

			for (const [path, content] of filesToRestore) {
				if (content === undefined) {
					deleteFile(ctx.cwd, path);
				} else {
					writeFile(ctx.cwd, path, content);
				}
			}
		});
	};
}

function compactionExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: `compacted: ${event.preparation.firstKeptEntryId}`,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {},
			},
		}));
	};
}

function findAssistantEntriesForTurn(
	entries: Array<{ id: string; parentId: string | null; type: string; message?: { role: string } }>,
	turnLeafId: string,
): Array<{ id: string }> {
	const result: Array<{ id: string }> = [];
	const byId = new Map(entries.map((e) => [e.id, e]));
	let current: string | null = turnLeafId;
	while (current !== null) {
		const entry = byId.get(current);
		if (!entry) break;
		if (entry.type === "message" && entry.message?.role === "user") {
			break;
		}
		if (entry.type === "message" && entry.message?.role === "assistant") {
			result.unshift({ id: entry.id });
		}
		current = entry.parentId;
	}
	return result;
}

function findToolResultEntriesForTurn(
	entries: Array<{
		id: string;
		parentId: string | null;
		type: string;
		message?: { role: string; toolCallId?: string };
	}>,
	turnLeafId: string,
): Array<{ id: string }> {
	const result: Array<{ id: string }> = [];
	const byId = new Map(entries.map((e) => [e.id, e]));
	let current: string | null = turnLeafId;
	while (current !== null) {
		const entry = byId.get(current);
		if (!entry) break;
		if (entry.type === "message" && entry.message?.role === "user") {
			break;
		}
		if (entry.type === "message" && entry.message?.role === "toolResult") {
			result.unshift({ id: entry.id });
		}
		current = entry.parentId;
	}
	return result;
}

describe("rollback cases 5, 6, 10", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("Case 5: segment summary + deletion + rollback", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		// Turn 1: create file A
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file A"),
		]);
		await harness.session.prompt("create file A");
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		// Turn 2: create file B
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file B"),
		]);
		await harness.session.prompt("create file B");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");
		const afterTurn2 = harness.sessionManager.getLeafId()!;

		// Turn 3: create file C
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.ts", content: "C-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file C"),
		]);
		await harness.session.prompt("create file C");
		expect(readFile(harness.tempDir, "fileC.ts")).toBe("C-v1");
		const afterTurn3 = harness.sessionManager.getLeafId()!;

		// Turn 4: modify files
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified file A"),
		]);
		await harness.session.prompt("modify file A");
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v2");
		const afterTurn4 = harness.sessionManager.getLeafId()!;

		// Record original message count before modifications
		const originalUserMsgCount = harness.session.messages.filter((m) => m.role === "user").length;
		expect(originalUserMsgCount).toBe(4);

		// Summarize turn 2 (assistant + tool result) into segment summary
		const entries = harness.sessionManager.getEntries();
		const turn2Assistant = findAssistantEntriesForTurn(entries, afterTurn2);
		const turn2ToolResults = findToolResultEntriesForTurn(entries, afterTurn2);
		const turn2TargetIds = [...turn2Assistant.map((e) => e.id), ...turn2ToolResults.map((e) => e.id)];
		harness.sessionManager.appendSegmentSummary(turn2TargetIds, "Created file B");

		// Delete turn 4's assistant message
		const turn4Assistant = findAssistantEntriesForTurn(entries, afterTurn4);
		harness.sessionManager.appendDeletion(turn4Assistant.map((e) => e.id));

		// Rebuild context to reflect changes
		const ctx = harness.sessionManager.buildSessionContext();
		harness.session["agent"].state.messages = ctx.messages;

		// Verify: segment summary replaces turn 2 original messages
		const messagesAfterOps = harness.session.messages;
		const segmentSummaries = messagesAfterOps.filter((m) => m.role === "segmentSummary");
		expect(segmentSummaries.length).toBe(1);
		expect((segmentSummaries[0] as { summary: string }).summary).toBe("Created file B");

		// Verify: turn 4's assistant is excluded from context
		const assistantTexts = messagesAfterOps
			.filter((m) => m.role === "assistant")
			.map((m) => {
				const c = m.content;
				if (typeof c === "string") return c;
				return (c as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("");
			});
		expect(assistantTexts.some((t) => t.includes("Modified file A"))).toBe(false);

		// Rollback to turn 3 (before segment summary and deletion were appended)
		await harness.session.navigateTree(afterTurn3, { summarize: false });

		// Verify: all original messages restored (turn 2 and turn 4 back)
		const messagesAfterRollback = harness.session.messages;
		const userMsgs = messagesAfterRollback.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(3);

		// No segment summaries remaining
		const segAfterRollback = messagesAfterRollback.filter((m) => m.role === "segmentSummary");
		expect(segAfterRollback.length).toBe(0);

		// Files restored to turn 3 state: A=v1, B=v1, C=v1
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");
		expect(readFile(harness.tempDir, "fileC.ts")).toBe("C-v1");
	});

	it("Case 6: delete message then rollback restores it", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension()],
		});
		harnesses.push(harness);

		// Turn 1: create file A
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file A"),
		]);
		await harness.session.prompt("create file A");
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");

		// Turn 2: create file B
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file B"),
		]);
		await harness.session.prompt("create file B");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");
		const afterTurn2 = harness.sessionManager.getLeafId()!;

		// Turn 3: modify file A
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v2" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Modified file A"),
		]);
		await harness.session.prompt("modify file A");
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v2");

		// Delete turn 2's assistant message
		const entries = harness.sessionManager.getEntries();
		const turn2Assistant = findAssistantEntriesForTurn(entries, afterTurn2);
		harness.sessionManager.appendDeletion(turn2Assistant.map((e) => e.id));

		// Rebuild context
		const ctx = harness.sessionManager.buildSessionContext();
		harness.session["agent"].state.messages = ctx.messages;

		// Verify: turn 2 assistant excluded from context
		const messagesBeforeRollback = harness.session.messages;
		const assistantTexts = messagesBeforeRollback
			.filter((m) => m.role === "assistant")
			.map((m) => {
				const c = m.content;
				if (typeof c === "string") return c;
				return (c as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("");
			});
		expect(assistantTexts.some((t) => t.includes("Created file B"))).toBe(false);

		// Files unchanged by deletion
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v2");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");

		// Rollback to turn 2 (before deletion, skipFiles=true to keep files unchanged)
		await harness.session.navigateTree(afterTurn2, { summarize: false, skipFiles: true });

		// Verify: turn 2 assistant message is back in context
		const messagesAfterRollback = harness.session.messages;
		const assistantTextsAfterRollback = messagesAfterRollback
			.filter((m) => m.role === "assistant")
			.map((m) => {
				const c = m.content;
				if (typeof c === "string") return c;
				return (c as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("");
			});
		expect(assistantTextsAfterRollback.some((t) => t.includes("Created file B"))).toBe(true);

		// Verify: files unchanged (skipFiles=true)
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v2");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");
	});

	it("Case 10: deletion + segment summary + compaction coexist, rollback through all", async () => {
		const harness = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
		});
		harnesses.push(harness);

		// Turn 1: create file A
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileA.ts", content: "A-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file A"),
		]);
		await harness.session.prompt("create file A");
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");
		const afterTurn1 = harness.sessionManager.getLeafId()!;

		// Turn 2: create file B
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileB.ts", content: "B-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file B"),
		]);
		await harness.session.prompt("create file B");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");
		const afterTurn2 = harness.sessionManager.getLeafId()!;

		// Turn 3: create file C
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "fileC.ts", content: "C-v1" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Created file C"),
		]);
		await harness.session.prompt("create file C");
		expect(readFile(harness.tempDir, "fileC.ts")).toBe("C-v1");

		// Find turn 1 entries for segment summary
		const entriesBeforeOps = harness.sessionManager.getEntries();
		const turn1Assistant = findAssistantEntriesForTurn(entriesBeforeOps, afterTurn1);
		const turn1ToolResults = findToolResultEntriesForTurn(entriesBeforeOps, afterTurn1);

		// Find turn 2 assistant for deletion
		const turn2Assistant = findAssistantEntriesForTurn(entriesBeforeOps, afterTurn2);

		// Delete turn 2's assistant
		harness.sessionManager.appendDeletion(turn2Assistant.map((e) => e.id));

		// Summarize turn 1 (assistant + tool result) into segment summary
		const turn1TargetIds = [...turn1Assistant.map((e) => e.id), ...turn1ToolResults.map((e) => e.id)];
		harness.sessionManager.appendSegmentSummary(turn1TargetIds, "Created file A");

		// Verify: deletion and segment summary entries exist before compaction
		const entriesAfterOps = harness.sessionManager.getEntries();
		expect(entriesAfterOps.some((e) => e.type === "deletion")).toBe(true);
		expect(entriesAfterOps.some((e) => e.type === "segment_summary")).toBe(true);

		// Verify context: segment summary replaces turn 1, deletion removes turn 2 assistant
		const ctxBeforeCompact = harness.sessionManager.buildSessionContext();
		const msgsBeforeCompact = ctxBeforeCompact.messages;
		expect(msgsBeforeCompact.some((m) => m.role === "segmentSummary")).toBe(true);
		const assistantTextsBeforeCompact = msgsBeforeCompact
			.filter((m) => m.role === "assistant")
			.map((m) => {
				const c = m.content;
				if (typeof c === "string") return c;
				return (c as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("");
			});
		expect(assistantTextsBeforeCompact.some((t) => t.includes("Created file B"))).toBe(false);

		// Compact turns 1-3
		await harness.session.compact();

		// Verify: compaction happened
		const compactionEntries = harness.sessionManager.getEntries().filter((e) => e.type === "compaction");
		expect(compactionEntries.length).toBeGreaterThanOrEqual(1);

		// Compaction summary present in messages
		const messagesAfterOps = harness.session.messages;
		const compactionInMessages = messagesAfterOps.filter((m) => m.role === "compactionSummary");
		expect(compactionInMessages.length).toBeGreaterThanOrEqual(1);

		// Rollback to turn 2 (before all three operations)
		await harness.session.navigateTree(afterTurn2, { summarize: false });

		// Verify: ALL original messages restored
		const messagesAfterRollback = harness.session.messages;

		// Segment summary gone
		const segAfterRollback = messagesAfterRollback.filter((m) => m.role === "segmentSummary");
		expect(segAfterRollback.length).toBe(0);

		// Compaction gone
		const compactionAfterRollback = messagesAfterRollback.filter((m) => m.role === "compactionSummary");
		expect(compactionAfterRollback.length).toBe(0);

		// Turn 1 original messages back
		const assistantTextsAfterRollback = messagesAfterRollback
			.filter((m) => m.role === "assistant")
			.map((m) => {
				const c = m.content;
				if (typeof c === "string") return c;
				return (c as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text ?? "")
					.join("");
			});
		expect(assistantTextsAfterRollback.some((t) => t.includes("Created file A"))).toBe(true);

		// Turn 2 assistant back (deletion gone)
		expect(assistantTextsAfterRollback.some((t) => t.includes("Created file B"))).toBe(true);

		// Turn 3 messages should not be present (rolled back to turn 2)
		expect(assistantTextsAfterRollback.some((t) => t.includes("Created file C"))).toBe(false);

		// Verify: user messages are turns 1-2 only
		const userMsgs = messagesAfterRollback.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(2);

		// Files restored to turn 2 state: A=v1, B=v1, C should be deleted
		expect(readFile(harness.tempDir, "fileA.ts")).toBe("A-v1");
		expect(readFile(harness.tempDir, "fileB.ts")).toBe("B-v1");
		expect(fileExists(harness.tempDir, "fileC.ts")).toBe(false);
	});
});
