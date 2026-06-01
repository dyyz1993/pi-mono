/**
 * Rollback message rendering tests.
 *
 * These tests validate that the data consumed by get_messages / get_full_messages
 * (which power the frontend rendering) is correct after rollback operations.
 *
 * The harness doesn't have an RPC process, but we can replicate the same logic
 * that rpc-mode.ts uses:
 *   - get_messages: session.messages (live in-memory)
 *   - get_full_messages: getBranch() to filter current path, then extract messages
 *
 * Tested combinations:
 *   1. Basic rollback → messages filtered to path
 *   2. Rollback → continue chat → messages include new branch only
 *   3. Compaction → rollback past it → original messages restored
 *   4. Fork → get_full_messages reflects current branch only
 *   5. branch_summary appears in messages after rollback with summarize
 *   6. segment_summary + deletion correctly reflected after rollback
 *   7. Multiple rollback-continue cycles → message sequence correct at each step
 *   8. get_full_messages tree.leafId matches sessionManager.getLeafId()
 */

import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

/**
 * Simulates get_full_messages logic from rpc-mode.ts:
 * - Uses getBranch() to only return messages on the current leaf-to-root path.
 * - Returns messages with entryId.
 */
function getFullMessagesFromHarness(h: Harness) {
	const allEntries = h.sessionManager.getEntries();
	const branchEntries = h.sessionManager.getBranch();
	const branchIds = new Set(branchEntries.map((e) => e.id));
	const messageEntries = allEntries.filter((e) => e.type === "message" && branchIds.has(e.id));
	const persistedMessages: (AgentMessage & { entryId: string })[] = messageEntries.map((e) => ({
		...(e as { message: AgentMessage }).message,
		entryId: e.id,
	}));
	const persistedSet = new Set(messageEntries.map((e) => (e as { message: AgentMessage }).message));

	const memoryMessages = h.session.messages;
	const unPersisted: (AgentMessage & { entryId?: string })[] = [];
	for (let i = memoryMessages.length - 1; i >= 0; i--) {
		const msg = memoryMessages[i];
		if (persistedSet.has(msg)) break;
		if (msg.role === "compactionSummary") continue;
		unPersisted.unshift(msg);
	}

	const allMessages: (AgentMessage & { entryId?: string })[] = [...persistedMessages, ...unPersisted];

	return {
		messages: allMessages,
		tree: {
			entries: allEntries.map((e) => ({
				id: e.id,
				parentId: e.parentId,
				type: e.type,
				label:
					e.type === "message"
						? (e as any).message?.role
						: e.type === "custom"
							? (e as any).customType
							: undefined,
			})),
			leafId: h.sessionManager.getLeafId(),
		},
	};
}

function getText(m: AgentMessage): string {
	const c = m.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c)) {
		return c
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("");
	}
	return "";
}

function createSnapshotAndRestoreExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("tool_result", async (event, _ctx) => {
			if (event.toolName === "write" || event.toolName === "edit") {
				const path = event.input?.path as string | undefined;
				if (path) {
					try {
						pi.appendEntry("file-snapshot", {
							path,
							content: "",
						});
					} catch {
						// ignore
					}
				}
			}
		});
		pi.on("session_tree", async () => {
			// no-op for message-only tests
		});
	};
}

function compactionExtension() {
	return (pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: `Compacted up to ${event.preparation.firstKeptEntryId}`,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {},
			},
		}));
	};
}

describe("rollback message rendering (get_messages / get_full_messages simulation)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function doSimpleTurn(h: Harness, prompt: string) {
		h.setResponses([fauxAssistantMessage(`response to ${prompt}`)]);
		await h.session.prompt(prompt);
		return h.sessionManager.getLeafId()!;
	}

	it("1. basic rollback: get_messages and get_full_messages agree on visible messages", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");
		await doSimpleTurn(h, "turn3");

		// Before rollback: 6 messages (3 user + 3 assistant)
		expect(h.session.messages.length).toBe(6);
		const fullBefore = getFullMessagesFromHarness(h);
		expect(fullBefore.messages.length).toBe(6);

		await h.session.navigateTree(t1, { summarize: false });

		// After rollback: session.messages should have 2 (1 user + 1 assistant)
		const msgs = h.session.messages;
		expect(msgs.filter((m) => m.role === "user").length).toBe(1);
		expect(msgs.filter((m) => m.role === "assistant").length).toBe(1);

		// get_full_messages should also have 2
		const fullAfter = getFullMessagesFromHarness(h);
		expect(fullAfter.messages.length).toBe(2);
		expect(fullAfter.messages.filter((m) => m.role === "user").length).toBe(1);

		// tree.leafId should match
		expect(fullAfter.tree.leafId).toBe(h.sessionManager.getLeafId());
	});

	it("2. rollback then continue: new branch messages correct in both APIs", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");
		await doSimpleTurn(h, "turn3");

		await h.session.navigateTree(t1, { summarize: false });

		// Continue from rolled-back state
		await doSimpleTurn(h, "turn4-new-branch");

		// session.messages: turn1 + turn4-new-branch = 4 messages
		const msgs = h.session.messages;
		const userTexts = msgs.filter((m) => m.role === "user").map(getText);
		expect(userTexts).toEqual(["turn1", "turn4-new-branch"]);

		// get_full_messages should match
		const full = getFullMessagesFromHarness(h);
		const fullUserTexts = full.messages.filter((m) => m.role === "user").map(getText);
		expect(fullUserTexts).toEqual(["turn1", "turn4-new-branch"]);

		// tree should contain the original turn2/turn3 entries (they're still persisted)
		// but they should NOT be on the current path
		const treeEntryIds = new Set(full.tree.entries.map((e) => e.id));
		const branchIds = new Set(h.sessionManager.getBranch().map((e) => e.id));
		// tree contains ALL entries, branch only current path
		expect(treeEntryIds.size).toBeGreaterThan(branchIds.size);
	});

	it("3. compaction then rollback: get_messages restores original messages", async () => {
		const h = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
		});
		harnesses.push(h);

		const t1 = await doSimpleTurn(h, "turn1");
		const t2 = await doSimpleTurn(h, "turn2");
		await doSimpleTurn(h, "turn3");

		await h.session.compact();
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(true);

		// Rollback past compaction to turn 2
		await h.session.navigateTree(t2, { summarize: false });

		// compactionSummary should be gone
		const msgs = h.session.messages;
		expect(msgs.some((m) => m.role === "compactionSummary")).toBe(false);

		// Original turn1 and turn2 messages should be visible
		const userTexts = msgs.filter((m) => m.role === "user").map(getText);
		expect(userTexts).toEqual(["turn1", "turn2"]);

		// get_full_messages should also show no compaction
		const full = getFullMessagesFromHarness(h);
		expect(full.messages.some((m) => m.role === "compactionSummary")).toBe(false);
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1", "turn2"]);

		// LeafId matches
		expect(full.tree.leafId).toBe(h.sessionManager.getLeafId());
	});

	it("4. fork: get_full_messages reflects current branch only", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doSimpleTurn(h, "turn1");
		const t2 = await doSimpleTurn(h, "turn2");

		// Fork from t1 using navigateTree (which rebuilds messages)
		await h.session.navigateTree(t1, { summarize: false });
		await doSimpleTurn(h, "fork-A");

		// get_full_messages should show turn1 + fork-A
		const full = getFullMessagesFromHarness(h);
		const userTexts = full.messages.filter((m) => m.role === "user").map(getText);
		expect(userTexts).toEqual(["turn1", "fork-A"]);

		// Switch back to t2 branch (navigateTree rebuilds session.messages)
		await h.session.navigateTree(t2, { summarize: false });
		const full2 = getFullMessagesFromHarness(h);
		const userTexts2 = full2.messages.filter((m) => m.role === "user").map(getText);
		expect(userTexts2).toEqual(["turn1", "turn2"]);
	});

	it("5. branch_summary appears in messages after rollback with summarize", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		h.appendResponses([fauxAssistantMessage("Summary of abandoned branch")]);
		await h.session.navigateTree(t1, { summarize: true });

		// session.messages should contain branchSummary
		const msgs = h.session.messages;
		const branchSummaries = msgs.filter((m) => m.role === "branchSummary");
		expect(branchSummaries.length).toBe(1);
		expect((branchSummaries[0] as any).summary).toContain("abandoned branch");

		// get_full_messages should also have it
		const full = getFullMessagesFromHarness(h);
		const fullSummaries = full.messages.filter((m) => m.role === "branchSummary");
		expect(fullSummaries.length).toBe(1);

		// Only 1 user message on this path
		expect(msgs.filter((m) => m.role === "user").length).toBe(1);
	});

	it("6. segment_summary correctly reflected after rollback", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		const t2 = await doSimpleTurn(h, "turn2");
		await doSimpleTurn(h, "turn3");

		// Create a segment summary for turn2's assistant
		const entries = h.sessionManager.getEntries();
		const assistantEntries = entries.filter((e) => e.type === "message" && (e as any).message?.role === "assistant");
		// Turn2 assistant is the second one
		const turn2Assistant = assistantEntries[1];
		h.sessionManager.appendSegmentSummary([turn2Assistant.id], "Summarized turn 2");

		// Rebuild context
		const ctx = h.sessionManager.buildSessionContext();
		h.session["agent"].state.messages = ctx.messages;

		// Verify segmentSummary is present
		const msgsBefore = h.session.messages;
		expect(msgsBefore.some((m) => m.role === "segmentSummary")).toBe(true);

		// Rollback to before the segment summary
		await h.session.navigateTree(t2, { summarize: false });

		// segmentSummary should be gone
		const msgsAfter = h.session.messages;
		expect(msgsAfter.some((m) => m.role === "segmentSummary")).toBe(false);

		// Turn 2's assistant text should be back
		const assistantTexts = msgsAfter.filter((m) => m.role === "assistant").map(getText);
		expect(assistantTexts.some((t) => t.includes("turn2"))).toBe(true);
	});

	it("7. multiple rollback-continue cycles: message sequence correct at each step", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doSimpleTurn(h, "turn1");
		const t2 = await doSimpleTurn(h, "turn2");
		const t3 = await doSimpleTurn(h, "turn3");

		// Step 1: rollback to t2
		await h.session.navigateTree(t2, { summarize: false });
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1", "turn2"]);

		// Step 2: continue
		await doSimpleTurn(h, "turn4");
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1", "turn2", "turn4"]);

		// Step 3: rollback to t1
		await h.session.navigateTree(t1, { summarize: false });
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1"]);

		// Step 4: continue with new turn
		await doSimpleTurn(h, "turn5");
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1", "turn5"]);

		// Step 5: rollback to t3 (which is on a different branch now)
		await h.session.navigateTree(t3, { summarize: false });
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1", "turn2", "turn3"]);

		// Verify get_full_messages agrees at every step
		const full = getFullMessagesFromHarness(h);
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1", "turn2", "turn3"]);
	});

	it("8. tree.leafId always matches sessionManager.getLeafId()", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		const t1 = await doSimpleTurn(h, "turn1");
		const t2 = await doSimpleTurn(h, "turn2");
		await doSimpleTurn(h, "turn3");

		// Before rollback
		let full = getFullMessagesFromHarness(h);
		expect(full.tree.leafId).toBe(h.sessionManager.getLeafId());

		// After rollback to t1
		await h.session.navigateTree(t1, { summarize: false });
		full = getFullMessagesFromHarness(h);
		expect(full.tree.leafId).toBe(h.sessionManager.getLeafId());
		expect(full.tree.leafId).toBe(t1);

		// After continue
		await doSimpleTurn(h, "turn4");
		full = getFullMessagesFromHarness(h);
		expect(full.tree.leafId).toBe(h.sessionManager.getLeafId());

		// After navigating to t2 (different branch)
		await h.session.navigateTree(t2, { summarize: false });
		full = getFullMessagesFromHarness(h);
		expect(full.tree.leafId).toBe(h.sessionManager.getLeafId());
		expect(full.tree.leafId).toBe(t2);
	});

	it("9. compaction + rollback + continue + second compaction: messages correct throughout", async () => {
		const h = await createHarness({
			extensionFactories: [createSnapshotAndRestoreExtension(), compactionExtension()],
		});
		harnesses.push(h);

		const t1 = await doSimpleTurn(h, "turn1");
		const t2 = await doSimpleTurn(h, "turn2");
		await doSimpleTurn(h, "turn3");

		// First compaction
		await h.session.compact();
		expect(h.session.messages.filter((m) => m.role === "compactionSummary").length).toBeGreaterThanOrEqual(1);

		// Rollback to t2 (past compaction)
		await h.session.navigateTree(t2, { summarize: false });
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(false);
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1", "turn2"]);

		// Continue
		await doSimpleTurn(h, "turn4");

		// Second compaction
		await h.session.compact();
		expect(h.session.messages.filter((m) => m.role === "compactionSummary").length).toBeGreaterThanOrEqual(1);

		// Rollback to t1 (past both compactions)
		await h.session.navigateTree(t1, { summarize: false });
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(false);
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["turn1"]);

		// get_full_messages confirms no compaction
		const full = getFullMessagesFromHarness(h);
		expect(full.messages.some((m) => m.role === "compactionSummary")).toBe(false);
	});

	it("10. rollback with tool calls: toolResult messages filtered correctly", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		// Turn 1: with tool call
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "a1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done-1"),
		]);
		await h.session.prompt("turn1-with-tool");
		const t1 = h.sessionManager.getLeafId()!;

		// Turn 2: with tool call
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "b.ts", content: "b1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done-2"),
		]);
		await h.session.prompt("turn2-with-tool");

		// Before rollback: should have user, assistant(toolCall), toolResult, assistant for each turn = 8
		const msgsBefore = h.session.messages;
		expect(msgsBefore.filter((m) => m.role === "user").length).toBe(2);
		expect(msgsBefore.filter((m) => m.role === "assistant").length).toBe(4); // 2 per turn (toolCall + text)
		expect(msgsBefore.filter((m) => m.role === "toolResult").length).toBe(2);

		// Rollback to turn 1
		await h.session.navigateTree(t1, { summarize: false });

		// After rollback: only turn 1 messages
		const msgsAfter = h.session.messages;
		expect(msgsAfter.filter((m) => m.role === "user").length).toBe(1);
		expect(msgsAfter.filter((m) => m.role === "assistant").length).toBe(2);
		expect(msgsAfter.filter((m) => m.role === "toolResult").length).toBe(1);

		// get_full_messages agrees
		const full = getFullMessagesFromHarness(h);
		expect(full.messages.filter((m) => m.role === "user").length).toBe(1);
		expect(full.messages.filter((m) => m.role === "toolResult").length).toBe(1);
	});

	it("11. get_full_messages returns entryId for persisted messages", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const full = getFullMessagesFromHarness(h);

		// All messages should have entryId (they're all persisted)
		for (const msg of full.messages) {
			expect(msg.entryId).toBeDefined();
			expect(typeof msg.entryId).toBe("string");
		}
	});

	it("12. get_full_messages tree structure is complete with all entry types", async () => {
		const h = await createHarness({ extensionFactories: [createSnapshotAndRestoreExtension()] });
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const full = getFullMessagesFromHarness(h);

		// Tree should contain entries of various types
		const types = new Set(full.tree.entries.map((e) => e.type));
		expect(types.has("message")).toBe(true);

		// Every tree entry should have id and parentId
		for (const entry of full.tree.entries) {
			expect(entry.id).toBeDefined();
			// parentId can be null (root) or a string
			if (entry.parentId !== null) {
				expect(typeof entry.parentId).toBe("string");
			}
		}

		// Tree should have leafId
		expect(full.tree.leafId).toBeDefined();
	});
});
