/**
 * Tests for compaction + rollback (tree navigation) interaction.
 *
 * These tests verify:
 * - Compaction entry appears in the tree correctly
 * - Rolling back past a compaction excludes the compaction summary from context
 * - Rolling back to a point before compaction, then appending, creates a new branch
 * - Data extraction (buildSessionContext, getBranch, getEntries) is correct after compaction + rollback
 * - Compaction followed by rollback preserves original messages in the old branch
 */

import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, userMsg } from "../utilities.ts";
import { createHarness, getMessageText, getUserTexts, type Harness } from "./harness.ts";

describe("compaction + rollback interaction", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("compaction entry appears in getBranch and getEntries", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		harness.sessionManager.appendCompaction("Summary of first question and answer", user2Id, 1000);

		const entries = harness.sessionManager.getEntries();
		const compactionEntry = entries.find((e) => e.type === "compaction");
		expect(compactionEntry).toBeDefined();
		expect((compactionEntry as any).summary).toBe("Summary of first question and answer");
		expect((compactionEntry as any).firstKeptEntryId).toBe(user2Id);

		// getBranch should include compaction + kept messages
		const branch = harness.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "compaction")).toBe(true);
	});

	it("rolling back to user message clears agent state and excludes compaction from context", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		// Compact
		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Before rollback: compaction summary is in context
		const contextBefore = harness.sessionManager.buildSessionContext();
		expect(JSON.stringify(contextBefore.messages)).toContain("Summary of first Q&A");

		// Rollback to user1 (navigateTree to user message sets leafId = null)
		const result = await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });
		expect(result.cancelled).toBe(false);
		expect(result.editorText).toBe("first question");

		// After rollback: leafId is null, agent messages are empty
		expect(harness.sessionManager.getLeafId()).toBeNull();
		expect(harness.session.messages).toEqual([]);
	});

	it("appending after rollback creates new branch independent of compaction", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Rollback to user1
		await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });

		// Append new messages on the new branch
		const newUserMsgId = harness.sessionManager.appendMessage(userMsg("different question"));
		const newAssistantId = harness.sessionManager.appendMessage(assistantMsg("different answer"));

		// New branch should not contain compaction
		const branch = harness.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "compaction")).toBe(false);
		expect(branch[0].id).toBe(newUserMsgId);
		expect(branch[1].id).toBe(newAssistantId);

		// Old entries still exist in the tree
		const allEntries = harness.sessionManager.getEntries();
		expect(allEntries.some((e) => e.type === "compaction")).toBe(true);
	});

	it("buildSessionContext after rollback to assistant message preserves path", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		const assistant1Id = harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		// Compact
		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Rollback to assistant1 (non-user message keeps the path)
		await harness.session.navigateTree(assistant1Id, { summarize: false });

		// Branch should be: user1 -> assistant1 (no compaction)
		const branch = harness.sessionManager.getBranch();
		expect(branch.length).toBe(2);
		expect(branch[0].id).toBe(user1Id);
		expect(branch[1].id).toBe(assistant1Id);
		expect(branch.some((e) => e.type === "compaction")).toBe(false);

		// Context should not contain compaction summary
		const context = harness.sessionManager.buildSessionContext();
		expect(JSON.stringify(context.messages)).not.toContain("Summary of first Q&A");
	});

	it("compaction then rollback then re-prompt works correctly", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Rollback to user1
		await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });

		// Set up response for re-prompt
		harness.setResponses([fauxAssistantMessage("new answer")]);

		// Re-prompt from the rollback point
		await harness.session.prompt("modified question");
		await harness.session.agent.waitForIdle();

		// Verify the new conversation has no compaction
		const branch = harness.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "compaction")).toBe(false);
	});

	it("multiple compactions on same branch, last one appears in context", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));
		const user3Id = harness.sessionManager.appendMessage(userMsg("third question"));
		harness.sessionManager.appendMessage(assistantMsg("third answer"));

		// First compaction
		harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 3000);
		// Second compaction
		harness.sessionManager.appendCompaction("Summary of second Q&A", user3Id, 2000);

		const entries = harness.sessionManager.getEntries();
		expect(entries.filter((e) => e.type === "compaction").length).toBe(2);

		// Context includes the latest compaction summary
		const context = harness.sessionManager.buildSessionContext();
		expect(JSON.stringify(context.messages)).toContain("Summary of second Q&A");
	});

	it("rollback to compaction entry preserves compaction summary in context", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		const compactId = harness.sessionManager.appendCompaction("Summary of first Q&A", user2Id, 1000);

		// Append more after compaction
		harness.sessionManager.appendMessage(userMsg("third question"));
		harness.sessionManager.appendMessage(assistantMsg("third answer"));

		// Rollback to compaction entry itself
		await harness.session.navigateTree(compactId, { summarize: false });

		const branch = harness.sessionManager.getBranch();
		expect(branch.some((e) => e.type === "compaction")).toBe(true);

		const context = harness.sessionManager.buildSessionContext();
		const contextText = JSON.stringify(context.messages);
		expect(contextText).toContain("Summary of first Q&A");
		// Should NOT include third Q&A (that's after compaction in a different branch)
		expect(contextText).not.toContain("third question");
	});
});

/**
 * End-to-end tests for rollback → continue chatting → verify message history.
 *
 * These tests verify the full chain:
 * 1. Roll back to a previous point
 * 2. Continue chatting (re-prompt)
 * 3. Verify session.messages, buildSessionContext, and getBranch
 *    all return the correct message history for the new branch.
 */
describe("rollback then continue chatting - message history verification", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	/**
	 * Helper: extract text from context.messages for assertions.
	 */
	function contextTexts(harness: Harness): { users: string[]; all: string[] } {
		const ctx = harness.sessionManager.buildSessionContext();
		const users = ctx.messages.filter((m) => m.role === "user").map((m) => getMessageText(m));
		const all = ctx.messages.map((m) => getMessageText(m));
		return { users, all };
	}

	it("rollback to first message then re-prompt: session.messages contains only new branch", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Build: u1 -> a1 -> u2 -> a2
		const user1Id = harness.sessionManager.appendMessage(userMsg("original question 1"));
		harness.sessionManager.appendMessage(assistantMsg("original answer 1"));
		harness.sessionManager.appendMessage(userMsg("original question 2"));
		harness.sessionManager.appendMessage(assistantMsg("original answer 2"));

		// Roll back to user1 (root)
		await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });

		// After rollback, session.messages should be empty (leaf is null)
		expect(harness.session.messages).toEqual([]);

		// Set up LLM response and re-prompt
		harness.setResponses([fauxAssistantMessage("new answer after rollback")]);
		await harness.session.prompt("new question after rollback");
		await harness.session.agent.waitForIdle();

		// session.messages should have exactly: new user + new assistant
		expect(harness.session.messages).toHaveLength(2);
		expect(harness.session.messages[0].role).toBe("user");
		expect(harness.session.messages[1].role).toBe("assistant");
		expect(getMessageText(harness.session.messages[0])).toBe("new question after rollback");
		expect(getMessageText(harness.session.messages[1])).toBe("new answer after rollback");

		// No traces of old messages
		const allTexts = harness.session.messages.map((m) => getMessageText(m));
		expect(allTexts).not.toContain("original question 1");
		expect(allTexts).not.toContain("original answer 1");
		expect(allTexts).not.toContain("original question 2");
		expect(allTexts).not.toContain("original answer 2");
	});

	it("rollback to first message then re-prompt: buildSessionContext returns new branch only", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("first question"));
		harness.sessionManager.appendMessage(assistantMsg("first answer"));
		harness.sessionManager.appendMessage(userMsg("second question"));
		harness.sessionManager.appendMessage(assistantMsg("second answer"));

		await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });

		harness.setResponses([fauxAssistantMessage("fresh response")]);
		await harness.session.prompt("fresh prompt");
		await harness.session.agent.waitForIdle();

		// buildSessionContext should return only the new branch
		const { users, all } = contextTexts(harness);
		expect(users).toEqual(["fresh prompt"]);
		expect(all).toContain("fresh response");

		// Old messages must not appear in context
		expect(all).not.toContain("first question");
		expect(all).not.toContain("first answer");
		expect(all).not.toContain("second question");
		expect(all).not.toContain("second answer");
	});

	it("rollback to first message then re-prompt: getBranch has correct ids", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("Q1"));
		harness.sessionManager.appendMessage(assistantMsg("A1"));
		harness.sessionManager.appendMessage(userMsg("Q2"));
		harness.sessionManager.appendMessage(assistantMsg("A2"));

		await harness.session.navigateTree(user1Id, { summarize: false, skipFiles: true });

		harness.setResponses([fauxAssistantMessage("new A")]);
		await harness.session.prompt("new Q");
		await harness.session.agent.waitForIdle();

		const branch = harness.sessionManager.getBranch();
		// Should have exactly 2 entries (new user + new assistant), no old ones
		expect(branch).toHaveLength(2);
		expect(branch.every((e) => e.type === "message")).toBe(true);

		// Old entries still exist in the full tree
		const allEntries = harness.sessionManager.getEntries();
		expect(allEntries.length).toBeGreaterThanOrEqual(6); // 4 old + 2 new
	});

	it("rollback to middle then re-prompt: preserves prior messages in path", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Build: u1 -> a1 -> u2 -> a2 -> u3 -> a3
		const u1 = harness.sessionManager.appendMessage(userMsg("question one"));
		const a1 = harness.sessionManager.appendMessage(assistantMsg("answer one"));
		harness.sessionManager.appendMessage(userMsg("question two"));
		harness.sessionManager.appendMessage(assistantMsg("answer two"));
		harness.sessionManager.appendMessage(userMsg("question three"));
		harness.sessionManager.appendMessage(assistantMsg("answer three"));

		// Roll back to a1 (middle of conversation)
		await harness.session.navigateTree(a1, { summarize: false, skipFiles: true });

		// After rollback, messages should be u1 -> a1
		expect(harness.session.messages).toHaveLength(2);
		expect(getMessageText(harness.session.messages[0])).toBe("question one");
		expect(getMessageText(harness.session.messages[1])).toBe("answer one");

		// Continue chatting
		harness.setResponses([fauxAssistantMessage("redirected answer")]);
		await harness.session.prompt("redirected question");
		await harness.session.agent.waitForIdle();

		// session.messages should be: u1 -> a1 -> new_u -> new_a
		expect(harness.session.messages).toHaveLength(4);
		expect(getMessageText(harness.session.messages[0])).toBe("question one");
		expect(getMessageText(harness.session.messages[1])).toBe("answer one");
		expect(getMessageText(harness.session.messages[2])).toBe("redirected question");
		expect(getMessageText(harness.session.messages[3])).toBe("redirected answer");

		// buildSessionContext must match
		const { all } = contextTexts(harness);
		expect(all).toEqual(["question one", "answer one", "redirected question", "redirected answer"]);

		// Old branch messages must not leak
		expect(all).not.toContain("question two");
		expect(all).not.toContain("answer two");
		expect(all).not.toContain("question three");
		expect(all).not.toContain("answer three");
	});

	it("rollback to middle then re-prompt: getBranch path is correct", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const u1 = harness.sessionManager.appendMessage(userMsg("msg-1"));
		const a1 = harness.sessionManager.appendMessage(assistantMsg("resp-1"));
		harness.sessionManager.appendMessage(userMsg("msg-2"));
		harness.sessionManager.appendMessage(assistantMsg("resp-2"));

		await harness.session.navigateTree(a1, { summarize: false, skipFiles: true });

		harness.setResponses([fauxAssistantMessage("new-resp")]);
		await harness.session.prompt("new-msg");
		await harness.session.agent.waitForIdle();

		const branch = harness.sessionManager.getBranch();
		expect(branch).toHaveLength(4);
		expect(branch[0].id).toBe(u1);
		expect(branch[1].id).toBe(a1);
		// New entries should not have the old ids
		expect(branch[2].id).not.toBe(branch[0].id);
		expect(branch[3].id).not.toBe(branch[1].id);
	});

	it("multiple rollbacks with re-prompt: no cross-branch message leakage", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Initial conversation
		const u1 = harness.sessionManager.appendMessage(userMsg("initial Q"));
		harness.sessionManager.appendMessage(assistantMsg("initial A"));

		// First rollback + re-prompt
		await harness.session.navigateTree(u1, { summarize: false, skipFiles: true });
		harness.setResponses([fauxAssistantMessage("branch1 A")]);
		await harness.session.prompt("branch1 Q");
		await harness.session.agent.waitForIdle();

		expect(getUserTexts(harness)).toEqual(["branch1 Q"]);

		// Second rollback + re-prompt
		await harness.session.navigateTree(u1, { summarize: false, skipFiles: true });
		harness.setResponses([fauxAssistantMessage("branch2 A")]);
		await harness.session.prompt("branch2 Q");
		await harness.session.agent.waitForIdle();

		// Should only have branch2 messages, no branch1 leakage
		expect(getUserTexts(harness)).toEqual(["branch2 Q"]);
		const { all } = contextTexts(harness);
		expect(all).not.toContain("branch1 Q");
		expect(all).not.toContain("branch1 A");
		expect(all).not.toContain("initial A");
	});

	it("rollback then multi-turn conversation: accumulates messages correctly", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Build initial conversation
		const u1 = harness.sessionManager.appendMessage(userMsg("old Q1"));
		harness.sessionManager.appendMessage(assistantMsg("old A1"));
		harness.sessionManager.appendMessage(userMsg("old Q2"));

		// Roll back to start
		await harness.session.navigateTree(u1, { summarize: false, skipFiles: true });

		// Multi-turn conversation after rollback
		harness.setResponses([fauxAssistantMessage("new A1"), fauxAssistantMessage("new A2")]);

		await harness.session.prompt("new Q1");
		await harness.session.agent.waitForIdle();
		await harness.session.prompt("new Q2");
		await harness.session.agent.waitForIdle();

		// Should have 4 messages: new Q1, new A1, new Q2, new A2
		expect(harness.session.messages).toHaveLength(4);
		expect(getUserTexts(harness)).toEqual(["new Q1", "new Q2"]);
		expect(getMessageText(harness.session.messages[1])).toBe("new A1");
		expect(getMessageText(harness.session.messages[3])).toBe("new A2");

		// No old messages
		const { all } = contextTexts(harness);
		expect(all).not.toContain("old Q1");
		expect(all).not.toContain("old A1");
		expect(all).not.toContain("old Q2");
	});
});
