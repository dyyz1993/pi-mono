/**
 * Tests for message retrieval and session state recovery.
 *
 * These tests validate the data paths that RPC commands (get_messages,
 * get_full_messages, get_state) rely on, simulating what a frontend
 * would see after a page refresh:
 *
 * 1. getMessages: raw session.messages array
 * 2. getFullMessages: sessionManager.getEntries() + getBranch() with
 *    tree structure, entryId on each message, deleted/summary filtering
 * 3. get_state: isStreaming, streamingMessage, messageCount
 *
 * The harness uses the faux provider (no real API calls).
 */

import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, userMsg } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

/**
 * Simulates the get_full_messages RPC command logic from rpc-mode.ts.
 * Takes the raw sessionManager data and returns the filtered, paginated
 * message list with tree/custom/compaction metadata.
 */
function simulateGetFullMessages(
	harness: Harness,
	options?: { afterEntryId?: string; beforeEntryId?: string; limit?: number },
): {
	messages: Array<{ role: string; entryId: string }>;
	hasMore: boolean;
	totalCount: number;
	nextCursor: string | null;
} {
	const branchEntries = harness.sessionManager.getBranch();

	// Collect deleted entry IDs
	const deletedIds = new Set<string>();
	for (const entry of branchEntries) {
		if (entry.type === "deletion") {
			const d = entry as { targetIds: string[] };
			for (const targetId of d.targetIds) {
				deletedIds.add(targetId);
			}
		}
	}

	// Build message list: skip non-message and deleted entries
	const messageEntries: Array<{ entryId: string; role: string }> = [];
	for (const entry of branchEntries) {
		if (entry.type !== "message" || deletedIds.has(entry.id)) continue;
		const role = (entry as { message: { role: string } }).message.role;
		messageEntries.push({ entryId: entry.id, role });
	}

	const totalCount = messageEntries.length;

	if (options?.limit !== undefined) {
		// Backward pagination: load messages before a given entryId
		if (options.beforeEntryId) {
			const endIndex = messageEntries.findIndex((e) => e.entryId === options.beforeEntryId);
			if (endIndex === -1 || endIndex === 0) {
				return { messages: [], hasMore: false, totalCount, nextCursor: null };
			}
			const startIndex = Math.max(0, endIndex - options.limit);
			const page = messageEntries.slice(startIndex, endIndex);
			const hasMore = startIndex > 0;
			const prevCursorEntry = hasMore ? messageEntries[startIndex] : undefined;
			return {
				messages: page,
				hasMore,
				totalCount,
				nextCursor: prevCursorEntry?.entryId ?? null,
			};
		}

		// Forward pagination: load messages after a given entryId (or from start)
		const startIndex = options.afterEntryId
			? Math.max(0, messageEntries.findIndex((e) => e.entryId === options.afterEntryId) + 1)
			: 0;
		const limit = options.limit;
		const page = messageEntries.slice(startIndex, startIndex + limit);
		const hasMore = startIndex + limit < totalCount;
		const nextCursorEntry = hasMore ? messageEntries[startIndex + limit - 1] : undefined;
		return {
			messages: page,
			hasMore,
			totalCount,
			nextCursor: nextCursorEntry?.entryId ?? null,
		};
	}

	return {
		messages: messageEntries,
		hasMore: false,
		totalCount,
		nextCursor: null,
	};
}

describe("message retrieval and state recovery", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	// =================================================================
	// get_messages: raw session.messages
	// =================================================================

	describe("getMessages (session.messages)", () => {
		it("returns empty array for a fresh session", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			expect(harness.session.messages).toEqual([]);
		});

		it("returns user and assistant messages after a prompt", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("hello back")]);
			await harness.session.prompt("hello");

			const messages = harness.session.messages;
			expect(messages.length).toBe(2);
			expect(messages[0].role).toBe("user");
			expect(messages[1].role).toBe("assistant");
			expect(getMessageText(messages[1])).toBe("hello back");
		});

		it("reflects completed messages accurately after each turn", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Turn 1
			harness.setResponses([fauxAssistantMessage("reply1")]);
			await harness.session.prompt("q1");
			expect(harness.session.messages.length).toBe(2);

			// Turn 2
			harness.setResponses([fauxAssistantMessage("reply2")]);
			await harness.session.prompt("q2");
			expect(harness.session.messages.length).toBe(4);

			// Turn 3
			harness.setResponses([fauxAssistantMessage("reply3")]);
			await harness.session.prompt("q3");
			expect(harness.session.messages.length).toBe(6);
		});
	});

	// =================================================================
	// get_full_messages: sessionManager-based retrieval with tree/entries
	// =================================================================

	describe("getFullMessages (sessionManager entries + branch)", () => {
		it("returns all messages with entryId from sessionManager", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("response")]);
			await harness.session.prompt("question");

			const result = simulateGetFullMessages(harness);
			expect(result.messages.length).toBe(2);

			// Each message should have a non-empty entryId
			for (const msg of result.messages) {
				expect(msg.entryId).toEqual(expect.any(String));
				expect(msg.entryId.length).toBeGreaterThan(0);
			}

			// Roles should be user then assistant
			expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		});

		it("returns tree entries with parent-child structure", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const id1 = harness.sessionManager.appendMessage(userMsg("first"));
			const id2 = harness.sessionManager.appendMessage(assistantMsg("first reply"));
			const id3 = harness.sessionManager.appendMessage(userMsg("second"));

			const allEntries = harness.sessionManager.getEntries();
			expect(allEntries.length).toBeGreaterThanOrEqual(3);

			// Verify parent chain: id2.parentId === id1, id3.parentId === id2
			const entry2 = allEntries.find((e) => e.id === id2);
			const entry3 = allEntries.find((e) => e.id === id3);
			expect(entry2?.parentId).toBe(id1);
			expect(entry3?.parentId).toBe(id2);
		});

		it("filters out deleted entries", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const id1 = harness.sessionManager.appendMessage(userMsg("keep this"));
			const id2 = harness.sessionManager.appendMessage(assistantMsg("keep reply"));
			const id3 = harness.sessionManager.appendMessage(userMsg("delete this"));
			harness.sessionManager.appendMessage(assistantMsg("delete reply"));

			// Delete entry id3
			harness.sessionManager.appendDeletion([id3]);

			// Simulate get_full_messages: it filters deleted entries
			const result = simulateGetFullMessages(harness);
			const entryIds = result.messages.map((m) => m.entryId);

			// Deleted entry should NOT appear
			expect(entryIds).not.toContain(id3);
			// Non-deleted entries should still be there
			expect(entryIds).toContain(id1);
			expect(entryIds).toContain(id2);
		});

		it("returns compaction entries", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage(userMsg("question 1"));
			harness.sessionManager.appendMessage(assistantMsg("answer 1"));
			const user2Id = harness.sessionManager.appendMessage(userMsg("question 2"));

			harness.sessionManager.appendCompaction("Summary of Q&A 1", user2Id, 1000);

			const allEntries = harness.sessionManager.getEntries();
			const compactionEntries = allEntries.filter((e) => e.type === "compaction");
			expect(compactionEntries.length).toBe(1);

			const compaction = compactionEntries[0] as {
				summary: string;
				tokensBefore: number;
				firstKeptEntryId: string;
			};
			expect(compaction.summary).toBe("Summary of Q&A 1");
			expect(compaction.tokensBefore).toBe(1000);
			expect(compaction.firstKeptEntryId).toBe(user2Id);
		});

		it("returns custom entries", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage(userMsg("hello"));
			harness.sessionManager.appendCustomEntry("note", { text: "my custom note" });

			const allEntries = harness.sessionManager.getEntries();
			const customEntries = allEntries.filter((e) => e.type === "custom");
			expect(customEntries.length).toBe(1);

			const custom = customEntries[0] as { customType: string; data: unknown };
			expect(custom.customType).toBe("note");
			expect((custom.data as { text: string }).text).toBe("my custom note");
		});

		it("replaces summarized segments with branchSummary message", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const id1 = harness.sessionManager.appendMessage(userMsg("msg1"));
			const id2 = harness.sessionManager.appendMessage(assistantMsg("reply1"));
			const id3 = harness.sessionManager.appendMessage(userMsg("msg2"));
			harness.sessionManager.appendMessage(assistantMsg("reply2"));

			// Summarize id1 + id2 into one summary
			harness.sessionManager.appendSegmentSummary([id1, id2], "Summary of msg1+reply1");

			// Simulate get_full_messages segment_summary logic
			const branchEntries = harness.sessionManager.getBranch();
			const deletedIds = new Set<string>();
			const segmentTargets = new Map<string, { summary: string; isFirst: boolean }>();
			for (const entry of branchEntries) {
				if (entry.type === "deletion") {
					for (const tid of (entry as { targetIds: string[] }).targetIds) {
						deletedIds.add(tid);
					}
				}
			}
			for (const entry of branchEntries) {
				if (entry.type === "segment_summary") {
					const se = entry as { targetIds: string[]; summary: string };
					for (let i = 0; i < se.targetIds.length; i++) {
						const tid = se.targetIds[i];
						if (deletedIds.has(tid) || segmentTargets.has(tid)) continue;
						segmentTargets.set(tid, { summary: se.summary, isFirst: i === 0 });
					}
				}
			}

			// Build final message list
			const result: Array<{ role: string }> = [];
			for (const entry of branchEntries) {
				if (entry.type !== "message") continue;
				const seg = segmentTargets.get(entry.id);
				if (seg) {
					if (seg.isFirst) {
						result.push({ role: "branchSummary" });
					}
					continue;
				}
				result.push({ role: (entry as { message: { role: string } }).message.role });
			}

			// msg1 replaced by branchSummary, reply1 skipped, msg2 + reply2 remain
			expect(result).toEqual([{ role: "branchSummary" }, { role: "user" }, { role: "assistant" }]);
		});

		it("supports forward pagination with limit and afterEntryId", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Create 6 messages (3 Q&A pairs)
			const ids: string[] = [];
			for (let i = 0; i < 3; i++) {
				ids.push(harness.sessionManager.appendMessage(userMsg(`q${i}`)));
				ids.push(harness.sessionManager.appendMessage(assistantMsg(`a${i}`)));
			}

			// Page: limit=2, afterEntryId = ids[1]
			const page1 = simulateGetFullMessages(harness, { afterEntryId: ids[1], limit: 2 });
			expect(page1.messages.length).toBe(2);
			expect(page1.totalCount).toBe(6);
			expect(page1.hasMore).toBe(true);
			expect(page1.nextCursor).toEqual(expect.any(String));

			// Page 2: afterEntryId = nextCursor
			const page2 = simulateGetFullMessages(harness, {
				afterEntryId: page1.nextCursor!,
				limit: 2,
			});
			expect(page2.messages.length).toBe(2);
			expect(page2.hasMore).toBe(false);
		});

		it("supports backward pagination with beforeEntryId (scroll up to load older)", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Create 10 messages (5 Q&A pairs)
			const ids: string[] = [];
			for (let i = 0; i < 5; i++) {
				ids.push(harness.sessionManager.appendMessage(userMsg(`q${i}`)));
				ids.push(harness.sessionManager.appendMessage(assistantMsg(`a${i}`)));
			}

			// Scenario: first load only the last 4 messages (ids[6]~ids[9])
			// User scrolls up, wants to load messages before ids[6]
			const page1 = simulateGetFullMessages(harness, { beforeEntryId: ids[6], limit: 4 });
			expect(page1.messages.length).toBe(4);
			expect(page1.messages[0].entryId).toBe(ids[2]); // ids[2], ids[3], ids[4], ids[5]
			expect(page1.messages[3].entryId).toBe(ids[5]);
			expect(page1.hasMore).toBe(true); // ids[0], ids[1] still above
			expect(page1.nextCursor).toEqual(expect.any(String));

			// Scroll up again: load before the cursor
			const page2 = simulateGetFullMessages(harness, {
				beforeEntryId: page1.nextCursor!,
				limit: 4,
			});
			expect(page2.messages.length).toBe(2); // only ids[0], ids[1] left
			expect(page2.messages[0].entryId).toBe(ids[0]);
			expect(page2.messages[1].entryId).toBe(ids[1]);
			expect(page2.hasMore).toBe(false); // reached the top
		});

		it("returns empty page when scrolling up past the beginning", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			const id1 = harness.sessionManager.appendMessage(userMsg("first"));
			harness.sessionManager.appendMessage(assistantMsg("reply"));

			// Try to load before the first message
			const result = simulateGetFullMessages(harness, { beforeEntryId: id1, limit: 10 });
			expect(result.messages).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it("backward and forward pagination produce consistent data", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Create 8 messages
			const ids: string[] = [];
			for (let i = 0; i < 4; i++) {
				ids.push(harness.sessionManager.appendMessage(userMsg(`q${i}`)));
				ids.push(harness.sessionManager.appendMessage(assistantMsg(`a${i}`)));
			}

			// Forward: load first 4 (ids[0]~ids[3])
			const forward = simulateGetFullMessages(harness, { limit: 4 });
			expect(forward.messages.map((m) => m.entryId)).toEqual(ids.slice(0, 4));

			// Backward: load 4 before ids[4] (should get ids[0]~ids[3])
			const backward = simulateGetFullMessages(harness, { beforeEntryId: ids[4], limit: 4 });
			expect(backward.messages.map((m) => m.entryId)).toEqual(ids.slice(0, 4));

			// Both should return the same set of messages
			expect(forward.messages.map((m) => m.entryId)).toEqual(backward.messages.map((m) => m.entryId));
		});

		it("returns leafId in tree structure", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage(userMsg("q"));
			const lastId = harness.sessionManager.appendMessage(assistantMsg("a"));

			const leafId = harness.sessionManager.getLeafId();
			expect(leafId).toBe(lastId);
		});
	});

	// =================================================================
	// get_state: session status
	// =================================================================

	describe("getState (session status)", () => {
		it("returns idle state for fresh session", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			expect(harness.session.isStreaming).toBe(false);
			expect(harness.session.messages.length).toBe(0);
			expect(harness.session.state.streamingMessage).toBeUndefined();
		});

		it("isStreaming is false after prompt completes", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("done")]);
			await harness.session.prompt("hi");

			expect(harness.session.isStreaming).toBe(false);
			expect(harness.session.state.streamingMessage).toBeUndefined();
		});

		it("messageCount reflects only completed messages", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("reply")]);

			// Before prompt
			expect(harness.session.messages.length).toBe(0);

			await harness.session.prompt("question");

			// After completion: user + assistant
			expect(harness.session.messages.length).toBe(2);
		});
	});

	// =================================================================
	// Full refresh-and-recover simulation
	// =================================================================

	describe("refresh-and-recover scenario", () => {
		it("recovers all messages and state after simulated refresh", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Simulate a conversation
			harness.setResponses([fauxAssistantMessage("first reply")]);
			await harness.session.prompt("first question");

			harness.setResponses([fauxAssistantMessage("second reply")]);
			await harness.session.prompt("second question");

			// --- Simulate refresh: re-read everything from scratch ---

			// Step 1: get_state equivalent
			const isStreaming = harness.session.isStreaming;
			const streamingMessage = harness.session.state.streamingMessage;
			const messageCount = harness.session.messages.length;

			expect(isStreaming).toBe(false);
			expect(streamingMessage).toBeUndefined();
			expect(messageCount).toBe(4); // 2 user + 2 assistant

			// Step 2: get_full_messages equivalent
			const result = simulateGetFullMessages(harness);
			const recoveredMessages = result.messages;

			expect(recoveredMessages.length).toBe(4);
			expect(recoveredMessages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

			// Every message must have a non-empty entryId
			for (const msg of recoveredMessages) {
				expect(msg.entryId).toEqual(expect.any(String));
				expect(msg.entryId.length).toBeGreaterThan(0);
			}

			// Step 3: tree structure
			const allEntries = harness.sessionManager.getEntries();
			const treeEntries = allEntries.map((e) => ({
				id: e.id,
				parentId: e.parentId,
				type: e.type,
			}));
			expect(treeEntries.length).toBeGreaterThanOrEqual(4);
			expect(treeEntries[0].parentId).toBeNull(); // root entry
		});

		it("recovers correctly after fork/rollback", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Build conversation
			harness.setResponses([fauxAssistantMessage("reply1")]);
			await harness.session.prompt("question1");

			harness.setResponses([fauxAssistantMessage("reply2")]);
			await harness.session.prompt("question2");

			// Record original message count
			expect(harness.session.messages.length).toBe(4);

			// Fork from first user message
			const userMessages = harness.session.getUserMessagesForForking();
			expect(userMessages.length).toBe(2);
			expect(userMessages[0].text).toBe("question1");
			expect(userMessages[1].text).toBe("question2");

			// Fork from the first user message
			const forkEntryId = userMessages[0].entryId;
			await harness.session.navigateTree(forkEntryId, { summarize: false, skipFiles: true });

			// After rollback: session messages should be cleared (leafId = null for user msg)
			expect(harness.session.messages.length).toBe(0);
			expect(harness.sessionManager.getLeafId()).toBeNull();

			// Continue with new branch
			harness.setResponses([fauxAssistantMessage("new reply")]);
			await harness.session.prompt("new question");

			// New branch should only have the new exchange
			expect(harness.session.messages.length).toBe(2);
			expect(getMessageText(harness.session.messages[0])).toBe("new question");
			expect(getMessageText(harness.session.messages[1])).toBe("new reply");

			// get_full_messages from sessionManager reflects the new branch
			const result = simulateGetFullMessages(harness);
			expect(result.messages.length).toBe(2);
			expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"]);

			// Old branch entries still exist in the tree
			const allEntries = harness.sessionManager.getEntries();
			expect(allEntries.length).toBeGreaterThan(2);
		});

		it("pagination works correctly after rollback (no cross-branch leakage)", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Build original conversation: 6 messages (3 Q&A pairs)
			harness.setResponses([fauxAssistantMessage("a1")]);
			await harness.session.prompt("q1");
			harness.setResponses([fauxAssistantMessage("a2")]);
			await harness.session.prompt("q2");
			harness.setResponses([fauxAssistantMessage("a3")]);
			await harness.session.prompt("q3");

			expect(harness.session.messages.length).toBe(6);

			// Rollback to q1 (first user message)
			const userMessages = harness.session.getUserMessagesForForking();
			await harness.session.navigateTree(userMessages[0].entryId, {
				summarize: false,
				skipFiles: true,
			});
			expect(harness.session.messages.length).toBe(0);

			// Build new branch with 4 messages (2 Q&A pairs)
			harness.setResponses([fauxAssistantMessage("new_a1")]);
			await harness.session.prompt("new_q1");
			harness.setResponses([fauxAssistantMessage("new_a2")]);
			await harness.session.prompt("new_q2");

			expect(harness.session.messages.length).toBe(4);

			// Verify get_full_messages only returns new branch data
			const result = simulateGetFullMessages(harness);
			expect(result.totalCount).toBe(4); // NOT 6 from old branch
			expect(result.messages.length).toBe(4);

			// Verify message content is from new branch
			const branch = harness.sessionManager.getBranch();
			const messageEntries = branch.filter((e) => e.type === "message");
			expect(getMessageText((messageEntries[0] as { message: object }).message)).toBe("new_q1");
			expect(getMessageText((messageEntries[1] as { message: object }).message)).toBe("new_a1");

			// No message from old branch should appear
			const newTexts = messageEntries.map((e) => getMessageText((e as { message: object }).message));
			// New branch should only contain new_* messages
			expect(newTexts).toEqual(["new_q1", "new_a1", "new_q2", "new_a2"]);

			// Old entries still exist in full tree but not in branch
			const allEntries = harness.sessionManager.getEntries();
			const allMessageEntries = allEntries.filter((e) => e.type === "message");
			expect(allMessageEntries.length).toBeGreaterThan(4); // old + new
		});

		it("backward pagination after rollback loads only new branch history", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Build original: 4 messages
			harness.setResponses([fauxAssistantMessage("old_a1")]);
			await harness.session.prompt("old_q1");
			harness.setResponses([fauxAssistantMessage("old_a2")]);
			await harness.session.prompt("old_q2");

			// Rollback to first message
			const userMessages = harness.session.getUserMessagesForForking();
			await harness.session.navigateTree(userMessages[0].entryId, {
				summarize: false,
				skipFiles: true,
			});

			// New branch: 6 messages (3 Q&A pairs)
			harness.setResponses([fauxAssistantMessage("new_a1")]);
			await harness.session.prompt("new_q1");
			harness.setResponses([fauxAssistantMessage("new_a2")]);
			await harness.session.prompt("new_q2");
			harness.setResponses([fauxAssistantMessage("new_a3")]);
			await harness.session.prompt("new_q3");

			expect(harness.session.messages.length).toBe(6);

			// Get the entryIds of the new branch
			const branch = harness.sessionManager.getBranch();
			const messageEntries = branch.filter((e) => e.type === "message");
			const newIds = messageEntries.map((e) => e.id);
			expect(newIds.length).toBe(6);

			// Simulate: first load last 4 messages (newIds[2]~newIds[5])
			// Then scroll up: load before newIds[2]
			const page1 = simulateGetFullMessages(harness, {
				beforeEntryId: newIds[2],
				limit: 4,
			});
			expect(page1.messages.length).toBe(2); // only newIds[0], newIds[1]
			expect(page1.messages[0].entryId).toBe(newIds[0]);
			expect(page1.messages[1].entryId).toBe(newIds[1]);
			expect(page1.hasMore).toBe(false); // reached the top of new branch

			// Critical: old branch messages must NOT leak
			for (const msg of page1.messages) {
				expect(newIds).toContain(msg.entryId);
			}
		});

		it("forward pagination after rollback only returns new branch", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Build original: 4 messages
			harness.setResponses([fauxAssistantMessage("old_a1")]);
			await harness.session.prompt("old_q1");
			harness.setResponses([fauxAssistantMessage("old_a2")]);
			await harness.session.prompt("old_q2");

			// Rollback to first message
			const userMessages = harness.session.getUserMessagesForForking();
			await harness.session.navigateTree(userMessages[0].entryId, {
				summarize: false,
				skipFiles: true,
			});

			// New branch: 4 messages
			harness.setResponses([fauxAssistantMessage("new_a1")]);
			await harness.session.prompt("new_q1");
			harness.setResponses([fauxAssistantMessage("new_a2")]);
			await harness.session.prompt("new_q2");

			// Forward paginate: limit=2, no afterEntryId (from start)
			const page1 = simulateGetFullMessages(harness, { limit: 2 });
			expect(page1.totalCount).toBe(4);
			expect(page1.messages.length).toBe(2);
			expect(page1.hasMore).toBe(true);

			// Second page
			const page2 = simulateGetFullMessages(harness, {
				afterEntryId: page1.nextCursor!,
				limit: 2,
			});
			expect(page2.messages.length).toBe(2);
			expect(page2.hasMore).toBe(false);

			// All 4 messages should be from new branch only
			const allPaginated = [...page1.messages, ...page2.messages];
			const branch = harness.sessionManager.getBranch();
			const branchIds = branch.filter((e) => e.type === "message").map((e) => e.id);

			for (const msg of allPaginated) {
				expect(branchIds).toContain(msg.entryId);
			}
			expect(allPaginated.length).toBe(branchIds.length);
		});

		it("can identify every message by role and entryId in a multi-turn session", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// 5-turn conversation
			for (let i = 0; i < 5; i++) {
				harness.setResponses([fauxAssistantMessage(`answer ${i}`)]);
				await harness.session.prompt(`question ${i}`);
			}

			// Verify session.messages
			const sessionMessages = harness.session.messages;
			expect(sessionMessages.length).toBe(10);

			// Verify get_full_messages equivalent
			const result = simulateGetFullMessages(harness);
			expect(result.messages.length).toBe(10);
			expect(result.totalCount).toBe(10);

			// Every message should be identifiable: unique entryId, correct role
			const entryIds = new Set<string>();
			for (let i = 0; i < result.messages.length; i++) {
				const msg = result.messages[i];
				expect(msg.entryId).toEqual(expect.any(String));
				expect(entryIds.has(msg.entryId)).toBe(false);
				entryIds.add(msg.entryId);

				const expectedRole = i % 2 === 0 ? "user" : "assistant";
				expect(msg.role).toBe(expectedRole);
			}

			// Cross-check text content via sessionManager entries
			const branch = harness.sessionManager.getBranch();
			const messageEntries = branch.filter((e) => e.type === "message");
			for (let i = 0; i < messageEntries.length; i++) {
				const entry = messageEntries[i] as { message: { role: string } };
				if (entry.message.role === "user") {
					const turnIdx = Math.floor(i / 2);
					expect(getMessageText(entry.message)).toBe(`question ${turnIdx}`);
				} else {
					const turnIdx = Math.floor(i / 2);
					expect(getMessageText(entry.message)).toBe(`answer ${turnIdx}`);
				}
			}
		});

		it("messages from session.messages match messages from sessionManager entries", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.setResponses([fauxAssistantMessage("response 1")]);
			await harness.session.prompt("message 1");

			harness.setResponses([fauxAssistantMessage("response 2")]);
			await harness.session.prompt("message 2");

			// session.messages (getMessages) should have same count as sessionManager
			const sessionMsgs = harness.session.messages;
			const result = simulateGetFullMessages(harness);

			expect(sessionMsgs.length).toBe(result.messages.length);

			// Text content should match
			for (let i = 0; i < sessionMsgs.length; i++) {
				const sessionText = getMessageText(sessionMsgs[i]);
				const branch = harness.sessionManager.getBranch();
				const messageEntries = branch.filter((e) => e.type === "message");
				const entryText = getMessageText((messageEntries[i] as { message: object }).message);
				expect(sessionText).toBe(entryText);
			}
		});
	});

	// =================================================================
	// Edge cases
	// =================================================================

	describe("edge cases", () => {
		it("handles limit larger than total message count", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage(userMsg("q1"));
			harness.sessionManager.appendMessage(assistantMsg("a1"));

			// Request limit=100 but only 2 messages exist
			const result = simulateGetFullMessages(harness, { limit: 100 });
			expect(result.messages.length).toBe(2);
			expect(result.hasMore).toBe(false);
			expect(result.nextCursor).toBeNull();
		});

		it("handles pagination on empty session", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// No messages at all
			const forward = simulateGetFullMessages(harness, { limit: 10 });
			expect(forward.messages).toEqual([]);
			expect(forward.hasMore).toBe(false);
			expect(forward.totalCount).toBe(0);

			const backward = simulateGetFullMessages(harness, { beforeEntryId: "nonexistent", limit: 10 });
			expect(backward.messages).toEqual([]);
			expect(backward.hasMore).toBe(false);
		});

		it("handles afterEntryId pointing to nonexistent entry", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage(userMsg("q1"));
			harness.sessionManager.appendMessage(assistantMsg("a1"));

			// findIndex returns -1, -1+1=0, so it loads from start
			const result = simulateGetFullMessages(harness, { afterEntryId: "nonexistent", limit: 10 });
			expect(result.messages.length).toBe(2);
		});

		it("handles beforeEntryId pointing to nonexistent entry", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			harness.sessionManager.appendMessage(userMsg("q1"));
			harness.sessionManager.appendMessage(assistantMsg("a1"));

			// findIndex returns -1, treated as "not found" → empty result
			const result = simulateGetFullMessages(harness, { beforeEntryId: "nonexistent", limit: 10 });
			expect(result.messages).toEqual([]);
			expect(result.hasMore).toBe(false);
		});

		it("pagination skips deleted entries correctly", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Create 6 messages
			const ids: string[] = [];
			for (let i = 0; i < 3; i++) {
				ids.push(harness.sessionManager.appendMessage(userMsg(`q${i}`)));
				ids.push(harness.sessionManager.appendMessage(assistantMsg(`a${i}`)));
			}

			// Delete ids[2] and ids[3]
			harness.sessionManager.appendDeletion([ids[2], ids[3]]);

			// Now only 4 messages remain visible
			const all = simulateGetFullMessages(harness);
			expect(all.totalCount).toBe(4);
			expect(all.messages.map((m) => m.entryId)).not.toContain(ids[2]);
			expect(all.messages.map((m) => m.entryId)).not.toContain(ids[3]);

			// Forward paginate: limit=2
			const page1 = simulateGetFullMessages(harness, { limit: 2 });
			expect(page1.messages.length).toBe(2);
			expect(page1.hasMore).toBe(true);

			const page2 = simulateGetFullMessages(harness, {
				afterEntryId: page1.nextCursor!,
				limit: 2,
			});
			expect(page2.messages.length).toBe(2);
			expect(page2.hasMore).toBe(false);

			// Total paginated = 4 (not 6)
			expect(page1.messages.length + page2.messages.length).toBe(4);
		});

		it("supports multiple consecutive rollbacks (rollback → new → rollback → new)", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Branch 1: 2 messages
			harness.setResponses([fauxAssistantMessage("b1_a1")]);
			await harness.session.prompt("b1_q1");
			expect(harness.session.messages.length).toBe(2);

			// Rollback 1: back to first user message
			let userMessages = harness.session.getUserMessagesForForking();
			await harness.session.navigateTree(userMessages[0].entryId, {
				summarize: false,
				skipFiles: true,
			});

			// Branch 2: 4 messages
			harness.setResponses([fauxAssistantMessage("b2_a1")]);
			await harness.session.prompt("b2_q1");
			harness.setResponses([fauxAssistantMessage("b2_a2")]);
			await harness.session.prompt("b2_q2");
			expect(harness.session.messages.length).toBe(4);

			// Rollback 2: back to branch 2's first message
			userMessages = harness.session.getUserMessagesForForking();
			await harness.session.navigateTree(userMessages[0].entryId, {
				summarize: false,
				skipFiles: true,
			});

			// Branch 3: 2 messages
			harness.setResponses([fauxAssistantMessage("b3_a1")]);
			await harness.session.prompt("b3_q1");
			expect(harness.session.messages.length).toBe(2);

			// getFullMessages should only show branch 3
			const result = simulateGetFullMessages(harness);
			expect(result.totalCount).toBe(2);
			const texts = result.messages.map((m) => {
				const branch = harness.sessionManager.getBranch();
				const entry = branch.find((e) => e.id === m.entryId) as { message: object } | undefined;
				return entry ? getMessageText(entry.message) : "";
			});
			expect(texts).toEqual(["b3_q1", "b3_a1"]);

			// All 3 branches' entries exist in the tree
			const allEntries = harness.sessionManager.getEntries();
			const allMessageEntries = allEntries.filter((e) => e.type === "message");
			expect(allMessageEntries.length).toBeGreaterThan(2);
		});

		it("session.messages and getFullMessages stay consistent after rollback + new branch", async () => {
			const harness = await createHarness();
			harnesses.push(harness);

			// Build conversation
			harness.setResponses([fauxAssistantMessage("original reply")]);
			await harness.session.prompt("original question");

			// Rollback
			const userMessages = harness.session.getUserMessagesForForking();
			await harness.session.navigateTree(userMessages[0].entryId, {
				summarize: false,
				skipFiles: true,
			});

			// New branch
			harness.setResponses([fauxAssistantMessage("new reply")]);
			await harness.session.prompt("new question");

			// session.messages and getFullMessages must agree
			const sessionCount = harness.session.messages.length;
			const fullResult = simulateGetFullMessages(harness);
			expect(sessionCount).toBe(fullResult.totalCount);
			expect(sessionCount).toBe(fullResult.messages.length);

			// Text content must match
			for (let i = 0; i < sessionCount; i++) {
				const sessionText = getMessageText(harness.session.messages[i]);
				const branch = harness.sessionManager.getBranch();
				const messageEntries = branch.filter((e) => e.type === "message");
				const entryText = getMessageText((messageEntries[i] as { message: object }).message);
				expect(sessionText).toBe(entryText);
			}
		});
	});
});
