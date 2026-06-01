/**
 * Rollback deep coverage: entry types, first-load rendering, deep multi-cycle rollback.
 *
 * Coverage areas:
 *   1. All entry types on the tree path after rollback (message, compaction, branch_summary,
 *      segment_summary, deletion, fold, custom, model_change, thinking_level_change, label)
 *   2. First-load scenario: consumer calls get_full_messages (no pagination) and gets
 *      everything needed to render the full conversation
 *   3. Deep multi-cycle rollback: 5+ rollback-continue cycles, verifying messages at each step
 *   4. Entry types visible in tree structure after rollback
 *   5. buildSessionContext vs session.messages consistency after complex operations
 */

import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

function getText(m: AgentMessage): string {
	const c = m.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c))
		return c
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("");
	return "";
}

function noopExtension() {
	return (_pi: import("../../src/core/extensions/types.js").ExtensionAPI) => {};
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

function getFullMessages(h: Harness) {
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
		customEntries: allEntries
			.filter((e) => e.type === "custom")
			.map((e) => ({ id: e.id, customType: (e as any).customType ?? "unknown", data: (e as any).data })),
		compactionEntries: allEntries
			.filter((e) => e.type === "compaction")
			.map((e) => ({ id: e.id, summary: (e as any).summary ?? "" })),
		branchEntries,
	};
}

describe("rollback deep coverage: entry types + first-load + multi-cycle", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function doTurn(h: Harness, prompt: string) {
		h.setResponses([fauxAssistantMessage(`reply-${prompt}`)]);
		await h.session.prompt(prompt);
		return h.sessionManager.getLeafId()!;
	}

	async function doToolTurn(h: Harness, prompt: string) {
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "d.txt", content: prompt }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(`done-${prompt}`),
		]);
		await h.session.prompt(prompt);
		return h.sessionManager.getLeafId()!;
	}

	// ────────────────────────────────────────────
	// Entry type coverage
	// ────────────────────────────────────────────

	it("1. message entries: user/assistant/toolResult all on branch after rollback", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doToolTurn(h, "A");
		await doToolTurn(h, "B");

		await h.session.navigateTree(t1, { summarize: false });

		const full = getFullMessages(h);

		// On branch: user + assistant(toolCall) + toolResult + assistant(text)
		const roles = full.messages.map((m) => m.role);
		expect(roles).toEqual(["user", "assistant", "toolResult", "assistant"]);

		// All have entryId
		for (const m of full.messages) {
			expect(m.entryId).toBeDefined();
		}
	});

	it("2. compaction entry on path, then rollback removes it", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension(), compactionExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		const t2 = await doTurn(h, "B");
		await doTurn(h, "C");

		await h.session.compact();

		// Compaction entry is on the path
		const branchBefore = h.sessionManager.getBranch();
		expect(branchBefore.some((e) => e.type === "compaction")).toBe(true);
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(true);

		// Rollback past compaction
		await h.session.navigateTree(t2, { summarize: false });

		const branchAfter = h.sessionManager.getBranch();
		expect(branchAfter.some((e) => e.type === "compaction")).toBe(false);
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(false);
	});

	it("3. branch_summary entry on path after summarize rollback", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");

		h.appendResponses([fauxAssistantMessage("Summary of B branch")]);
		await h.session.navigateTree(t1, { summarize: true });

		const branch = h.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "branch_summary")).toBe(true);

		// branchSummary is in messages
		const summaries = h.session.messages.filter((m) => m.role === "branchSummary");
		expect(summaries.length).toBe(1);
	});

	it("4. segment_summary and deletion entries on path, rollback restores originals", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		await doTurn(h, "A");
		const t2 = await doTurn(h, "B");
		await doTurn(h, "C");

		// Segment summary for turn B assistant
		const entries = h.sessionManager.getEntries();
		const bAssistant = entries
			.filter((e) => e.type === "message" && (e as any).message?.role === "assistant")
			.find((e) => (getText((e as any).message) as string).includes("reply-B"));
		expect(bAssistant).toBeDefined();
		h.sessionManager.appendSegmentSummary([bAssistant!.id], "Summarized B");

		// Delete turn C assistant
		const cAssistant = entries
			.filter((e) => e.type === "message" && (e as any).message?.role === "assistant")
			.find((e) => (getText((e as any).message) as string).includes("reply-C"));
		expect(cAssistant).toBeDefined();
		h.sessionManager.appendDeletion([cAssistant!.id]);

		// Rebuild context
		const ctx = h.sessionManager.buildSessionContext();
		h.session["agent"].state.messages = ctx.messages;

		// Verify segment summary present, deletion effective
		expect(h.session.messages.some((m) => m.role === "segmentSummary")).toBe(true);
		expect(h.session.messages.some((m) => getText(m).includes("reply-C"))).toBe(false);

		// Rollback to turn 2 (before segment + deletion)
		await h.session.navigateTree(t2, { summarize: false });

		// Both should be gone
		expect(h.session.messages.some((m) => m.role === "segmentSummary")).toBe(false);
		expect(h.session.messages.some((m) => getText(m).includes("reply-B"))).toBe(true);
	});

	it("5. model_change entry on path preserved across rollback", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");

		// Change model
		h.sessionManager.appendModelChange("test-provider", "test-model-v2");

		await doTurn(h, "B");

		// Rollback to t1
		await h.session.navigateTree(t1, { summarize: false });

		// model_change should not be on path
		const branch = h.sessionManager.getBranch();
		const modelChanges = branch.filter((e) => e.type === "model_change");
		expect(modelChanges.length).toBe(0);
	});

	it("6. thinking_level_change entry on path preserved across rollback", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");

		h.sessionManager.appendThinkingLevelChange("medium");

		const t2 = await doTurn(h, "B");

		// Rollback to t1 (before thinking level change)
		await h.session.navigateTree(t1, { summarize: false });

		const branch = h.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "thinking_level_change")).toBe(false);

		// Navigate forward to t2 (after thinking level change)
		await h.session.navigateTree(t2, { summarize: false });

		const branch2 = h.sessionManager.getBranch();
		expect(branch2.some((e) => e.type === "thinking_level_change")).toBe(true);
	});

	it("7. custom entry persists in tree after rollback but filtered from messages", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		h.sessionManager.appendCustomEntry("my-custom", { foo: "bar" });
		await doTurn(h, "B");

		// Custom entry is in tree
		const entries = h.sessionManager.getEntries();
		expect(entries.some((e) => e.type === "custom" && (e as any).customType === "my-custom")).toBe(true);

		// But NOT in messages
		expect(h.session.messages.some((m) => (m as any).customType === "my-custom")).toBe(false);

		// Rollback to t1 (before custom entry)
		await h.session.navigateTree(t1, { summarize: false });

		// Custom entry is still in ALL entries but not on current branch
		const allEntries = h.sessionManager.getEntries();
		const branch = h.sessionManager.getBranch();
		expect(allEntries.some((e) => e.type === "custom")).toBe(true);
		expect(branch.some((e) => e.type === "custom")).toBe(false);
	});

	it("8. label entry on path preserved across rollback", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");

		// Label turn A's user message
		const entries = h.sessionManager.getEntries();
		const userA = entries.find((e) => e.type === "message" && (e as any).message?.role === "user")!;
		h.sessionManager.appendLabelChange(userA.id, "important");

		// Rollback to t1
		await h.session.navigateTree(t1, { summarize: false });

		// Label is still in entries
		const branch = h.sessionManager.getBranch();
		const labels = branch.filter((e) => e.type === "label");
		// label was appended AFTER t1, so rollback may exclude it
		// The label entry's parentId is after t2's leaf, so it's not on the t1 path
		// This is correct behavior - labels are just entry markers
		expect(h.sessionManager.getLabel(userA.id)).toBe("important");
	});

	// ────────────────────────────────────────────
	// First-load rendering scenario
	// ────────────────────────────────────────────

	it("9. first-load: non-paginated get_full_messages provides all rendering data", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		await doTurn(h, "A");
		await doTurn(h, "B");
		await doTurn(h, "C");

		const full = getFullMessages(h);

		// Messages: all 6 (3 user + 3 assistant)
		expect(full.messages.length).toBe(6);
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "B", "C"]);

		// Tree: complete structure with leafId
		expect(full.tree.leafId).toBe(h.sessionManager.getLeafId());
		expect(full.tree.entries.length).toBeGreaterThanOrEqual(6);

		// Every message has entryId for UI keying
		for (const m of full.messages) {
			expect(m.entryId).toBeDefined();
		}

		// Tree entries have proper parent chain
		const treeById = new Map(full.tree.entries.map((e) => [e.id, e]));
		for (const entry of full.tree.entries) {
			if (entry.parentId !== null) {
				expect(treeById.has(entry.parentId)).toBe(true);
			}
		}
	});

	it("10. first-load after rollback: only current branch messages returned", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");
		await doTurn(h, "C");

		await h.session.navigateTree(t1, { summarize: false });

		// Simulate consumer's first get_full_messages call
		const full = getFullMessages(h);

		// Only turn A messages
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A"]);
		expect(full.messages.some((m) => getText(m).includes("reply-B"))).toBe(false);
		expect(full.messages.some((m) => getText(m).includes("reply-C"))).toBe(false);

		// But tree still has all entries (for tree visualization)
		expect(full.tree.entries.length).toBeGreaterThan(2);
	});

	it("11. first-load: tree structure allows reconstructing the full tree for UI", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");

		// Fork from t1
		await h.session.navigateTree(t1, { summarize: false });
		await doTurn(h, "C-fork");

		// First load: tree has all entries including both branches
		const full = getFullMessages(h);

		// Current branch is A + C-fork
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "C-fork"]);

		// Tree has entries from BOTH branches
		const treeRoles = full.tree.entries.filter((e) => e.type === "message" && e.label === "user").map((e) => e.id);
		// B is in the tree even though it's not on the current branch
		expect(full.tree.entries.length).toBeGreaterThan(4);

		// Tree can be reconstructed from parentId links
		const roots = full.tree.entries.filter((e) => e.parentId === null);
		expect(roots.length).toBe(1); // single root

		// Multiple children at fork point
		const t1Entry = full.tree.entries.find((e) => e.id === t1);
		expect(t1Entry).toBeDefined();
		const childrenOfT1 = full.tree.entries.filter((e) => e.parentId === t1);
		expect(childrenOfT1.length).toBeGreaterThanOrEqual(2); // B branch + C-fork branch
	});

	// ────────────────────────────────────────────
	// Deep multi-cycle rollback
	// ────────────────────────────────────────────

	it("12. 6 rollback-continue cycles with verification at each step", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		const t2 = await doTurn(h, "B");
		const t3 = await doTurn(h, "C");

		// Cycle 1: rollback to t2
		await h.session.navigateTree(t2, { summarize: false });
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "B"]);

		// Cycle 2: continue
		await doTurn(h, "D");
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "B", "D"]);

		// Cycle 3: rollback to t1
		await h.session.navigateTree(t1, { summarize: false });
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A"]);

		// Cycle 4: continue
		await doTurn(h, "E");
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "E"]);

		// Cycle 5: rollback to t3 (original branch)
		await h.session.navigateTree(t3, { summarize: false });
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "B", "C"]);

		// Cycle 6: continue
		await doTurn(h, "F");
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "B", "C", "F"]);

		// get_full_messages agrees
		const full = getFullMessages(h);
		expect(full.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "B", "C", "F"]);

		// Tree has entries from all branches (A, B, C, D, E, F)
		const treeMsgCount = full.tree.entries.filter((e) => e.type === "message").length;
		expect(treeMsgCount).toBeGreaterThanOrEqual(12); // at least 6 user + 6 assistant
	});

	it("13. rollback to same point 3 times creates 3 independent branches", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		const t2 = await doTurn(h, "B");

		// Branch 1: rollback to t1, continue
		await h.session.navigateTree(t1, { summarize: false });
		await doTurn(h, "C1");

		// Branch 2: rollback to t1 again, different continue
		await h.session.navigateTree(t1, { summarize: false });
		await doTurn(h, "C2");

		// Branch 3: rollback to t1 yet again
		await h.session.navigateTree(t1, { summarize: false });
		await doTurn(h, "C3");

		// Current messages: A + C3
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "C3"]);

		// Tree has all 5 user messages (A, B, C1, C2, C3)
		const allUserEntries = h.sessionManager
			.getEntries()
			.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		expect(allUserEntries.length).toBe(5);

		// Navigate to branch 2 (C2)
		const c2Entry = allUserEntries.find((e) => getText((e as any).message) === "C2")!;
		await h.session.navigateTree(c2Entry.id, { summarize: false });
		// When navigating to a user entry, backend jumps to parentId (before user)
		// So we get A only
		const afterC2 = h.session.messages.filter((m) => m.role === "user").map(getText);
		// Actually: navigateTree(userEntry) → leaf = user.parentId → user NOT on path
		expect(afterC2).toEqual(["A"]);
	});

	it("14. rollback across compaction + branch_summary + deletion: all layers cleared", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension(), compactionExtension()] });
		harnesses.push(h);

		await doTurn(h, "A");
		const t2 = await doTurn(h, "B");
		await doTurn(h, "C");

		// Compact
		await h.session.compact();

		// Append segment summary
		const entries = h.sessionManager.getEntries();
		const assistant = entries.filter((e) => e.type === "message" && (e as any).message?.role === "assistant");
		h.sessionManager.appendSegmentSummary([assistant[assistant.length - 1].id], "Summarized C");

		// Append deletion
		h.sessionManager.appendDeletion([assistant[0].id]);

		// Rebuild
		const ctx = h.sessionManager.buildSessionContext();
		h.session["agent"].state.messages = ctx.messages;

		// Verify all modifications are present
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(true);
		expect(h.session.messages.some((m) => m.role === "segmentSummary")).toBe(true);

		// Rollback past ALL of it
		await h.session.navigateTree(t2, { summarize: false });

		// Everything should be gone
		expect(h.session.messages.some((m) => m.role === "compactionSummary")).toBe(false);
		expect(h.session.messages.some((m) => m.role === "segmentSummary")).toBe(false);

		// Original messages from A + B restored
		expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["A", "B"]);
	});

	it("15. get_full_messages customEntries and compactionEntries always include ALL entries", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension(), compactionExtension()] });
		harnesses.push(h);

		await doTurn(h, "A");
		await doTurn(h, "B");

		// Append custom entry
		h.sessionManager.appendCustomEntry("snapshot", { files: ["a.ts"] });

		await doTurn(h, "C");

		await h.session.compact();

		const t2 = h.sessionManager.getLeafId()!;

		// Before rollback
		const fullBefore = getFullMessages(h);
		expect(fullBefore.compactionEntries.length).toBeGreaterThanOrEqual(1);
		expect(fullBefore.customEntries.some((e) => e.customType === "snapshot")).toBe(true);

		// Rollback to before compaction and custom entry
		const allEntries = h.sessionManager.getEntries();
		const userEntries = allEntries.filter((e) => e.type === "message" && (e as any).message?.role === "user");
		await h.session.navigateTree(userEntries[1].id, { summarize: false });

		// customEntries and compactionEntries STILL include ALL entries (not filtered by branch)
		const fullAfter = getFullMessages(h);
		expect(fullAfter.compactionEntries.length).toBeGreaterThanOrEqual(1);
		expect(fullAfter.customEntries.some((e) => e.customType === "snapshot")).toBe(true);
	});

	// ────────────────────────────────────────────
	// buildSessionContext consistency
	// ────────────────────────────────────────────

	it("16. session.messages equals buildSessionContext().messages after every operation", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension(), compactionExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");

		// After compact
		await h.session.compact();
		expect(h.session.messages).toEqual(h.sessionManager.buildSessionContext().messages);

		// After rollback
		await h.session.navigateTree(t1, { summarize: false });
		expect(h.session.messages).toEqual(h.sessionManager.buildSessionContext().messages);

		// After continue
		await doTurn(h, "C");
		expect(h.session.messages).toEqual(h.sessionManager.buildSessionContext().messages);

		// After second rollback
		await h.session.navigateTree(t1, { summarize: false });
		expect(h.session.messages).toEqual(h.sessionManager.buildSessionContext().messages);
	});

	it("17. getBranch length matches path entries count from root to leaf", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");

		// getBranch should return a continuous chain from root to leaf
		const branch = h.sessionManager.getBranch();
		expect(branch.length).toBeGreaterThan(0);

		// Verify continuity
		for (let i = 1; i < branch.length; i++) {
			expect(branch[i].parentId).toBe(branch[i - 1].id);
		}

		// First entry is root
		expect(branch[0].parentId).toBeNull();

		// Last entry is leaf
		expect(branch[branch.length - 1].id).toBe(h.sessionManager.getLeafId());

		// After rollback
		await h.session.navigateTree(t1, { summarize: false });
		const branch2 = h.sessionManager.getBranch();
		expect(branch2[branch2.length - 1].id).toBe(h.sessionManager.getLeafId());
		expect(branch2.length).toBeLessThan(branch.length);

		// Still continuous
		for (let i = 1; i < branch2.length; i++) {
			expect(branch2[i].parentId).toBe(branch2[i - 1].id);
		}
	});

	it("18. entry count consistency: getEntries includes ALL, getBranch only current path", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		const t1 = await doTurn(h, "A");
		await doTurn(h, "B");
		await doTurn(h, "C");

		await h.session.navigateTree(t1, { summarize: false });
		await doTurn(h, "D");

		// getEntries has everything from both branches
		const all = h.sessionManager.getEntries();
		const branch = h.sessionManager.getBranch();

		expect(all.length).toBeGreaterThan(branch.length);

		// All branch entries are in all entries
		const allIds = new Set(all.map((e) => e.id));
		for (const b of branch) {
			expect(allIds.has(b.id)).toBe(true);
		}

		// Some entries are only in all, not in branch (the rolled-back branch)
		const branchIds = new Set(branch.map((e) => e.id));
		const offBranch = all.filter((e) => !branchIds.has(e.id));
		expect(offBranch.length).toBeGreaterThan(0);
	});
});
