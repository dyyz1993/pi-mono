/**
 * Regression tests for get_full_messages data correctness.
 *
 * Tests that the rpc-mode.ts get_full_messages logic correctly handles
 * deletion, fold, segment_summary, compaction, and rollback filtering
 * to match the behavior of buildSessionContext (session.messages).
 *
 * Merged from:
 * - diagnostic-duplication.test.ts
 * - diagnostic-user-perspective.test.ts
 * - rollback-identity-duplication.test.ts
 */
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { FoldEntry, DeletionEntry, SegmentSummaryEntry } from "../../src/core/session-manager.js";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

function getText(m: AgentMessage): string {
	const c = m.content;
	if (typeof c === "string") return c;
	if (Array.isArray(c))
		return c.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("");
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

/**
 * Simulates the FIXED rpc-mode.ts get_full_messages logic.
 * Includes deletion, segment_summary, and fold filtering
 * matching buildSessionContext behavior.
 */
function simulateGetFullMessages(h: Harness) {
	const allEntries = h.sessionManager.getEntries();
	const branchEntries = h.sessionManager.getBranch();
	const branchIds = new Set(branchEntries.map((e) => e.id));
	const messageEntries = allEntries.filter((e) => e.type === "message" && branchIds.has(e.id));

	// 1. Collect folds
	const folds = new Map<string, { targetId: string; summary: string; originalTokens: number; timestamp: string }>();
	for (const entry of branchEntries) {
		if (entry.type === "fold") {
			const fe = entry as FoldEntry;
			folds.set(fe.targetId, { targetId: fe.targetId, summary: fe.summary, originalTokens: fe.originalTokens, timestamp: entry.timestamp });
		}
	}

	// 2. Collect deleted IDs
	const deletedIds = new Set<string>();
	for (const entry of branchEntries) {
		if (entry.type === "deletion") {
			for (const targetId of (entry as DeletionEntry).targetIds) {
				deletedIds.add(targetId);
			}
		}
	}
	const deletedToolCallIds = new Set<string>();
	for (const entry of messageEntries) {
		if (deletedIds.has(entry.id)) {
			const msg = (entry as { message: AgentMessage }).message;
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const part of msg.content as Array<{ type: string; id?: string }>) {
					if (part.type === "toolCall" && part.id) {
						deletedToolCallIds.add(part.id);
					}
				}
			}
		}
	}
	for (const entry of messageEntries) {
		const msg = (entry as { message: AgentMessage }).message;
		if (msg.role === "toolResult" && deletedToolCallIds.has(msg.toolCallId)) {
			deletedIds.add(entry.id);
		}
	}

	// 3. Collect segment summaries
	const segmentTargets = new Map<string, { summary: string; isFirst: boolean; timestamp: string }>();
	for (const entry of branchEntries) {
		if (entry.type === "segment_summary") {
			const seg = entry as SegmentSummaryEntry;
			if (seg.targetIds.length === 0) continue;
			for (let i = 0; i < seg.targetIds.length; i++) {
				const targetId = seg.targetIds[i];
				if (deletedIds.has(targetId)) continue;
				if (segmentTargets.has(targetId)) continue;
				segmentTargets.set(targetId, {
					summary: seg.summary,
					isFirst: i === 0,
					timestamp: entry.timestamp,
				});
			}
		}
	}

	// 4. Build persisted messages with filtering applied
	const persistedMessages: (AgentMessage & { entryId?: string })[] = [];
	for (const entry of messageEntries) {
		if (deletedIds.has(entry.id)) continue;

		const segInfo = segmentTargets.get(entry.id);
		if (segInfo) {
			if (segInfo.isFirst) {
				persistedMessages.push({
					role: "segmentSummary" as const,
					summary: segInfo.summary,
					timestamp: new Date(segInfo.timestamp).getTime(),
					entryId: entry.id,
				} as AgentMessage & { entryId: string });
			}
			continue;
		}

		const fold = folds.get(entry.id);
		if (fold) {
			persistedMessages.push({
				role: "foldSummary" as const,
				summary: fold.summary,
				originalTokens: fold.originalTokens,
				timestamp: new Date(fold.timestamp).getTime(),
				entryId: entry.id,
			} as AgentMessage & { entryId: string });
		} else {
			let msg = (entry as { message: AgentMessage }).message;
			if (msg.role === "assistant" && Array.isArray(msg.content) && deletedToolCallIds.size > 0) {
				const content = msg.content;
				const needsStrip = content.some(
					(part: { type: string; id?: string }) =>
						part.type === "toolCall" && part.id !== undefined && deletedToolCallIds.has(part.id),
				);
				if (needsStrip) {
					const filteredContent = content.filter(
						(part: { type: string; id?: string }) =>
							!(part.type === "toolCall" && part.id !== undefined && deletedToolCallIds.has(part.id)),
					);
					msg = { ...msg, content: filteredContent as typeof msg.content };
				}
			}
			persistedMessages.push({ ...msg, entryId: entry.id });
		}
	}

	const persistedMsgObjects = new Set<AgentMessage>();
	const persistedKeys = new Set<string>();
	for (const entry of messageEntries) {
		if (deletedIds.has(entry.id)) continue;
		if (segmentTargets.has(entry.id)) {
			const segInfo = segmentTargets.get(entry.id);
			if (segInfo?.isFirst) {
				persistedKeys.add(`segmentSummary:${segInfo.summary}`);
			}
			continue;
		}
		if (folds.has(entry.id)) {
			const f = folds.get(entry.id)!;
			persistedKeys.add(`foldSummary:${f.summary}:${f.originalTokens}`);
			continue;
		}
		persistedMsgObjects.add((entry as { message: AgentMessage }).message);
	}

	const memoryMessages = h.session.messages;
	const unPersisted: (AgentMessage & { entryId?: string })[] = [];
	for (let i = memoryMessages.length - 1; i >= 0; i--) {
		const msg = memoryMessages[i];
		if (persistedMsgObjects.has(msg)) break;
		if (msg.role === "foldSummary") {
			const key = `foldSummary:${(msg as any).summary}:${(msg as any).originalTokens}`;
			if (persistedKeys.has(key)) break;
		}
		if (msg.role === "segmentSummary") {
			const key = `segmentSummary:${(msg as any).summary}`;
			if (persistedKeys.has(key)) break;
		}
		if (msg.role === "compactionSummary") continue;
		unPersisted.unshift(msg);
	}

	return {
		allMessages: [...persistedMessages, ...unPersisted] as (AgentMessage & { entryId?: string })[],
		persistedCount: persistedMessages.length,
		unPersistedCount: unPersisted.length,
		totalCount: persistedMessages.length + unPersisted.length,
		memoryCount: memoryMessages.length,
	};
}

describe("get_full_messages filtering", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function doTurn(h: Harness, prompt: string) {
		h.setResponses([fauxAssistantMessage(`reply-${prompt}`)]);
		await h.session.prompt(prompt);
		return h.sessionManager.getLeafId()!;
	}

	// ────────────────────────────────────────────
	// Deletion filtering
	// ────────────────────────────────────────────

	describe("deletion filtering", () => {
		it("deletion + context rebuild: no duplication in get_full_messages", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension()] });
			harnesses.push(h);

			// Turn 1: simple text
			h.setResponses([fauxAssistantMessage("text-only-response")]);
			await h.session.prompt("turn1");

			// Turn 2: with tool call
			h.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("tool-done"),
			]);
			await h.session.prompt("turn2");

			// Turn 3: simple text
			h.setResponses([fauxAssistantMessage("turn3-response")]);
			await h.session.prompt("turn3");

			// === BEFORE DELETION ===
			console.log("\n=== BEFORE DELETION ===");
			const memBefore = h.session.messages;
			console.log("session.messages count:", memBefore.length);
			for (const m of memBefore) {
				console.log(
					"  ",
					m.role,
					m.role === "assistant" && Array.isArray(m.content)
						? m.content.map((p: any) => p.type).join("+")
						: "",
				);
			}

			const entriesBefore = h.sessionManager.getEntries();
			const msgEntriesBefore = entriesBefore.filter((e) => e.type === "message");
			console.log("message entries count:", msgEntriesBefore.length);

			// Find turn2's toolCall assistant
			const entries = h.sessionManager.getEntries();
			const messageEntries = entries.filter(
				(e) => e.type === "message" && (e as any).message?.role === "assistant",
			);
			const toolCallAssistant = messageEntries.find((e) => {
				const msg = (e as any).message;
				return (
					msg.role === "assistant" &&
					Array.isArray(msg.content) &&
					msg.content.some((p: any) => p.type === "toolCall")
				);
			});
			expect(toolCallAssistant).toBeDefined();
			console.log("Deleting entry:", toolCallAssistant!.id, "role:", "assistant(toolCall)");

			// Delete it
			h.sessionManager.appendDeletion([toolCallAssistant!.id]);

			// === AFTER DELETION, BEFORE REBUILD ===
			console.log("\n=== AFTER DELETION, BEFORE REBUILD ===");
			console.log("session.messages count:", h.session.messages.length);

			// Rebuild context
			const ctx = h.sessionManager.buildSessionContext();
			h.session["agent"].state.messages = ctx.messages;

			// === AFTER REBUILD ===
			console.log("\n=== AFTER REBUILD ===");
			const memAfter = h.session.messages;
			console.log("session.messages count:", memAfter.length);
			for (const m of memAfter) {
				console.log(
					"  ",
					m.role,
					m.role === "assistant" && Array.isArray(m.content)
						? m.content.map((p: any) => p.type).join("+")
						: "",
				);
			}

			// Verify the toolCall message is gone from session.messages
			expect(
				memAfter.some(
					(m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((p: any) => p.type === "toolCall"),
				),
			).toBe(false);

			// Simulate get_full_messages
			const full = simulateGetFullMessages(h);

			console.log("\n=== get_full_messages SIMULATION ===");
			console.log("persistedCount:", full.persistedCount);
			console.log("unPersistedCount:", full.unPersistedCount);
			console.log("totalCount:", full.totalCount);
			console.log("session.messages.length:", memAfter.length);

			expect(full.totalCount).toBe(memAfter.length);
		});
	});

	// ────────────────────────────────────────────
	// Fold filtering
	// ────────────────────────────────────────────

	describe("fold filtering", () => {
		it("fold: get_full_messages shows foldSummary instead of original message", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension()] });
			harnesses.push(h);

			await doTurn(h, "A");
			await doTurn(h, "B");

			// Find B's assistant entry and fold it
			const entries = h.sessionManager.getEntries();
			const assistantEntries = entries.filter(
				(e) => e.type === "message" && (e as any).message?.role === "assistant",
			);
			const bAssistant = assistantEntries[1];
			h.sessionManager.appendFold(bAssistant!.id, "Summary of B", 100);

			// Rebuild context
			const ctx = h.sessionManager.buildSessionContext();
			h.session["agent"].state.messages = ctx.messages;

			console.log("\n=== Fold filtering ===");
			const foldSummaryMsgs = h.session.messages.filter((m) => m.role === "foldSummary");
			console.log("session.messages foldSummary count:", foldSummaryMsgs.length);
			expect(foldSummaryMsgs.length).toBe(1);

			const full = simulateGetFullMessages(h);
			console.log("get_full_messages totalCount:", full.totalCount);
			console.log("session.messages count:", h.session.messages.length);

			// get_full_messages should NOT contain original reply-B
			const hasReplyB = full.allMessages.some((m) => getText(m) === "reply-B");
			console.log("get_full_messages contains original reply-B:", hasReplyB);
			expect(hasReplyB).toBe(false);

			expect(full.totalCount).toBe(h.session.messages.length);
		});
	});

	// ────────────────────────────────────────────
	// Segment summary filtering
	// ────────────────────────────────────────────

	describe("segment_summary filtering", () => {
		it("segment_summary: get_full_messages shows summary instead of original messages", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension()] });
			harnesses.push(h);

			await doTurn(h, "A");
			await doTurn(h, "B");
			await doTurn(h, "C");

			// Replace B's assistant with segment summary
			const entries = h.sessionManager.getEntries();
			const assistantEntries = entries.filter(
				(e) => e.type === "message" && (e as any).message?.role === "assistant",
			);
			const bAssistant = assistantEntries[1];
			h.sessionManager.appendSegmentSummary([bAssistant!.id], "Summary of turn B");

			const ctx = h.sessionManager.buildSessionContext();
			h.session["agent"].state.messages = ctx.messages;

			console.log("\n=== Segment summary filtering ===");
			const segSummaries = h.session.messages.filter((m) => m.role === "segmentSummary");
			console.log("session.messages segmentSummary count:", segSummaries.length);
			expect(segSummaries.length).toBe(1);

			// reply-B should be replaced by segmentSummary
			const hasReplyB = h.session.messages.some((m) => getText(m) === "reply-B");
			console.log("session.messages contains reply-B:", hasReplyB);
			expect(hasReplyB).toBe(false);

			const full = simulateGetFullMessages(h);
			console.log("get_full_messages totalCount:", full.totalCount);
			console.log("session.messages count:", h.session.messages.length);

			const fullHasReplyB = full.allMessages.some((m) => getText(m) === "reply-B");
			console.log("get_full_messages contains original reply-B:", fullHasReplyB);
			expect(full.totalCount).toBe(h.session.messages.length);
		});
	});

	// ────────────────────────────────────────────
	// Compaction
	// ────────────────────────────────────────────

	describe("compaction", () => {
		it("compaction: get_full_messages excludes pre-compaction messages", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension(), compactionExtension()] });
			harnesses.push(h);

			await doTurn(h, "A");
			await doTurn(h, "B");
			await doTurn(h, "C");
			await doTurn(h, "D");
			await doTurn(h, "E");

			// Compact: turns A-B are folded
			await h.session.compact();

			console.log("\n=== Compaction ===");
			console.log("session.messages:", h.session.messages.length, "messages");
			console.log("  roles:", h.session.messages.map((m) => m.role).join(", "));
			const hasCompaction = h.session.messages.some((m) => m.role === "compactionSummary");
			console.log("  has compactionSummary:", hasCompaction);

			const full = simulateGetFullMessages(h);
			console.log("get_full_messages totalCount:", full.totalCount);
			console.log("  persistedCount:", full.persistedCount);
			console.log("  unPersistedCount:", full.unPersistedCount);

			// compactionSummary is returned in a separate compactionEntries field
			const memWithoutCompaction = h.session.messages.filter((m) => m.role !== "compactionSummary");
			console.log("difference:", full.totalCount - memWithoutCompaction.length, "extra");
			expect(full.totalCount).toBe(memWithoutCompaction.length);
		});
	});

	// ────────────────────────────────────────────
	// Rollback + identity
	// ────────────────────────────────────────────

	describe("rollback + identity", () => {
		it("rollback after deletion: identity preserved, no duplication", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension()] });
			harnesses.push(h);

			// Turn 1: with tool call
			h.setResponses([
				fauxAssistantMessage(fauxToolCall("write", { path: "a.ts", content: "v1" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("done"),
			]);
			await h.session.prompt("turn1");
			const afterTurn1 = h.sessionManager.getLeafId()!;

			// Turn 2
			h.setResponses([fauxAssistantMessage("turn2-response")]);
			await h.session.prompt("turn2");

			// Delete turn1's toolCall assistant
			const entries = h.sessionManager.getEntries();
			const toolCallAssistant = entries
				.filter((e) => e.type === "message" && (e as any).message?.role === "assistant")
				.find((e) => {
					const msg = (e as any).message;
					return (
						Array.isArray(msg.content) && msg.content.some((p: any) => p.type === "toolCall")
					);
				});
			h.sessionManager.appendDeletion([toolCallAssistant!.id]);

			// Rebuild context (creates clones)
			const ctx = h.sessionManager.buildSessionContext();
			h.session["agent"].state.messages = ctx.messages;

			console.log("\n=== Rollback after deletion ===");
			console.log("After rebuild: session.messages count:", h.session.messages.length);

			// Now rollback past the deletion
			await h.session.navigateTree(afterTurn1, { summarize: false });

			// After rollback, check get_full_messages
			const full = simulateGetFullMessages(h);

			// The assistant with tool call should be back in messages
			const hasToolCall = full.allMessages.some(
				(m) =>
					m.role === "assistant" &&
					Array.isArray(m.content) &&
					m.content.some((p: any) => p.type === "toolCall"),
			);
			console.log("After rollback: has toolCall message:", hasToolCall);
			expect(hasToolCall).toBe(true);

			// But should NOT be duplicated
			console.log("get_full_messages totalCount:", full.totalCount);
			console.log("session.messages count:", h.session.messages.length);
			expect(full.totalCount).toBe(h.session.messages.length);
		});

		it("deletion + rollback: get_full_messages matches session.messages at each step", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension()] });
			harnesses.push(h);

			const t1 = await doTurn(h, "A");
			const t2 = await doTurn(h, "B");
			await doTurn(h, "C");

			// Delete B's assistant
			const entries = h.sessionManager.getEntries();
			const bAssistant = entries
				.filter((e) => e.type === "message" && (e as any).message?.role === "assistant")
				.find((e) => getText((e as any).message) === "reply-B");
			h.sessionManager.appendDeletion([bAssistant!.id]);
			let ctx = h.sessionManager.buildSessionContext();
			h.session["agent"].state.messages = ctx.messages;

			console.log("\n=== Deletion + rollback: after deleting B ===");
			let full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			expect(full.totalCount).toBe(h.session.messages.length);

			// Rollback to t2 (before deletion)
			await h.session.navigateTree(t2, { summarize: false });

			console.log("=== Deletion + rollback: after rollback to t2 ===");
			full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			expect(full.totalCount).toBe(h.session.messages.length);
		});

		it("compaction + deletion + rollback combo", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension(), compactionExtension()] });
			harnesses.push(h);

			await doTurn(h, "A");
			await doTurn(h, "B");
			const t3 = await doTurn(h, "C");
			await doTurn(h, "D");

			await h.session.compact();

			console.log("\n=== Combo: after compaction ===");
			let full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			const memNoComp = h.session.messages.filter((m) => m.role !== "compactionSummary");
			expect(full.totalCount).toBe(memNoComp.length);

			// Delete a post-compaction message
			const entries = h.sessionManager.getEntries();
			const dAssistant = entries
				.filter((e) => e.type === "message" && (e as any).message?.role === "assistant")
				.find((e) => getText((e as any).message) === "reply-D");
			h.sessionManager.appendDeletion([dAssistant!.id]);
			let ctx = h.sessionManager.buildSessionContext();
			h.session["agent"].state.messages = ctx.messages;

			console.log("=== Combo: after compaction + deletion ===");
			full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			const memNoComp2 = h.session.messages.filter((m) => m.role !== "compactionSummary");
			expect(full.totalCount).toBe(memNoComp2.length);

			// Rollback to t3 (before compaction + deletion)
			await h.session.navigateTree(t3, { summarize: false });

			console.log("=== Combo: after rollback to t3 ===");
			full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			expect(full.totalCount).toBe(h.session.messages.length);
		});

		it("rollback to root then continue", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension()] });
			harnesses.push(h);

			await doTurn(h, "A");
			await doTurn(h, "B");

			// Rollback to root
			const entries = h.sessionManager.getEntries();
			const root = entries.find((e) => e.parentId === null);
			await h.session.navigateTree(root!.id, { summarize: false });

			console.log("\n=== Rollback to root ===");
			let full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			expect(h.session.messages.length).toBe(0);

			// Continue from root
			await doTurn(h, "new-A");

			console.log("=== After continuing from root ===");
			full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			expect(full.totalCount).toBe(h.session.messages.length);
			expect(h.session.messages.filter((m) => m.role === "user").map(getText)).toEqual(["new-A"]);
		});
	});

	// ────────────────────────────────────────────
	// Edge cases
	// ────────────────────────────────────────────

	describe("edge cases", () => {
		it("empty session and single message", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension()] });
			harnesses.push(h);

			// Empty session
			console.log("\n=== Edge: empty session ===");
			let full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			expect(full.totalCount).toBe(0);

			// Single message
			await doTurn(h, "only");
			console.log("=== Edge: single message ===");
			full = simulateGetFullMessages(h);
			console.log("session.messages:", h.session.messages.length, "get_full_messages:", full.totalCount);
			expect(full.totalCount).toBe(2); // user + assistant
		});

		it("first load: get_full_messages returns all messages with entryIds", async () => {
			const h = await createHarness({ extensionFactories: [noopExtension()] });
			harnesses.push(h);

			await doTurn(h, "A");
			await doTurn(h, "B");
			await doTurn(h, "C");

			// Simulate consumer first load
			const full = simulateGetFullMessages(h);

			console.log("\n=== Edge: first load ===");
			console.log("session.messages:", h.session.messages.length);
			console.log("get_full_messages:", full.totalCount);

			// No deletion/compaction/segment/fold -> should match exactly
			expect(full.totalCount).toBe(h.session.messages.length);

			// Consumer gets complete data
			const userTexts = full.allMessages.filter((m) => m.role === "user").map(getText);
			expect(userTexts).toEqual(["A", "B", "C"]);

			// Every message has entryId
			for (const m of full.allMessages) {
				expect(m.entryId).toBeDefined();
			}
		});
	});
});
