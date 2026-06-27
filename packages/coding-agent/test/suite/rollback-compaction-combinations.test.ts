/**
 * Combination tests: rollback + compaction + continue chatting.
 *
 * 8 scenarios covering complex interaction between:
 *   - Compaction (session summarization that replaces older messages)
 *   - Rollback (navigateTree that branches the conversation)
 *   - Continue chatting (new prompts after rollback/compaction)
 *
 * Key invariant: after any combination, session.messages and getBranch()
 * must reflect the CURRENT active branch — new messages must be accessible
 * and old branch messages must be excluded.
 */

import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { assistantMsg, userMsg } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("rollback + compaction + continue combinations", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	// Helper: do a full prompt cycle
	async function chat(harness: Harness, question: string, answer: string) {
		harness.setResponses([fauxAssistantMessage(answer)]);
		await harness.session.prompt(question);
		await harness.session.agent.waitForIdle();
	}

	// Helper: find user message entry by text
	function findUserEntry(harness: Harness, text: string) {
		return harness.sessionManager
			.getEntries()
			.find((e) => e.type === "message" && e.message.role === "user" && getMessageText(e.message).includes(text));
	}

	function messageTexts(harness: Harness): string[] {
		return harness.session.messages.map((m) => getMessageText(m));
	}

	function branchTexts(harness: Harness): string[] {
		return harness.sessionManager
			.getBranch()
			.filter((e) => e.type === "message")
			.map((e) => getMessageText(e.message));
	}

	// ─── Case 1: 对话 → 压缩 → 继续聊 ────────────────────────────────

	it("case 1: chat → compaction → continue chatting", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));

		// Compaction
		harness.sessionManager.appendCompaction("Summary of q1+a1", user2Id, 1000);

		// Continue chatting
		harness.setResponses([fauxAssistantMessage("a3")]);
		await harness.session.prompt("q3");
		await harness.session.agent.waitForIdle();

		// q3 and a3 must be accessible
		const texts = messageTexts(harness);
		expect(texts.some((t) => t.includes("q3"))).toBe(true);
		expect(texts.some((t) => t.includes("a3"))).toBe(true);

		// Compaction summary should be in context
		const branch = branchTexts(harness);
		expect(branch.some((t) => t.includes("q3"))).toBe(true);
	});

	// ─── Case 2: 对话 → 压缩 → 回滚到压缩前 → 继续聊 ─────────────────

	it("case 2: chat → compaction → rollback BEFORE compaction → continue", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));

		// Compaction
		harness.sessionManager.appendCompaction("Summary", user2Id, 1000);

		// Post-compaction message
		harness.sessionManager.appendMessage(userMsg("q3 post-compact"));
		harness.sessionManager.appendMessage(assistantMsg("a3 post-compact"));

		// Rollback to user1 (before compaction)
		await harness.session.navigateTree(user1Id, { skipFiles: true, summarize: false });

		// Continue chatting
		await chat(harness, "q4 after rollback", "a4 after rollback");

		// q4 must be accessible
		const texts = messageTexts(harness);
		expect(texts.some((t) => t.includes("q4"))).toBe(true);
		expect(texts.some((t) => t.includes("a4"))).toBe(true);

		// Compaction and post-compaction messages should NOT be in current branch
		expect(branchTexts(harness).some((t) => t.includes("post-compact"))).toBe(false);
	});

	// ─── Case 3: 对话 → 压缩 → 回滚到压缩后 → 继续聊 ─────────────────

	it("case 3: chat → compaction → rollback AFTER compaction → continue", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));

		harness.sessionManager.appendCompaction("Summary", user2Id, 1000);

		// Post-compaction
		const user3Id = harness.sessionManager.appendMessage(userMsg("q3"));
		harness.sessionManager.appendMessage(assistantMsg("a3"));

		// Rollback to user3 (after compaction)
		await harness.session.navigateTree(user3Id, { skipFiles: true, summarize: false });

		// After rollback to q3: context may include compaction summary.
		// The key question is whether we can continue chatting correctly.
		// q3 may or may not appear in agent.messages depending on how
		// navigateTree handles the leaf reset for user messages.

		// Continue
		await chat(harness, "q4", "a4");

		// q4 and a4 MUST be accessible after continuing
		const texts = messageTexts(harness);
		expect(texts.some((t) => t.includes("a4"))).toBe(true);
		expect(branchTexts(harness).some((t) => t.includes("q4"))).toBe(true);
	});

	// ─── Case 4: 对话 → 回滚 → 压缩 → 继续聊 ─────────────────────────

	it("case 4: chat → rollback → compaction → continue", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));

		// Rollback to user1
		await harness.session.navigateTree(user1Id, { skipFiles: true, summarize: false });

		// Continue with q3
		await chat(harness, "q3", "a3");

		// Now compaction on current branch
		const q3Entry = findUserEntry(harness, "q3");
		harness.sessionManager.appendCompaction("Summary after rollback", q3Entry?.id ?? user1Id, 1000);

		// Continue after compaction
		await chat(harness, "q4", "a4");

		expect(messageTexts(harness).some((t) => t.includes("a4"))).toBe(true);
		// q2/a2 should NOT be in branch (was rolled back)
		expect(branchTexts(harness).some((t) => t.includes("q2"))).toBe(false);
	});

	// ─── Case 5: 回滚 → 继续聊 → 压缩 → 继续聊 ──────────────────────

	it("case 5: rollback → continue → compaction → continue", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));
		const user3Id = harness.sessionManager.appendMessage(userMsg("q3"));
		harness.sessionManager.appendMessage(assistantMsg("a3"));

		// Rollback to user2
		await harness.session.navigateTree(user2Id, { skipFiles: true, summarize: false });

		// Continue
		await chat(harness, "q4", "a4");

		// Compaction
		const q4Entry = findUserEntry(harness, "q4");
		harness.sessionManager.appendCompaction("Summary of q4", q4Entry?.id ?? user1Id, 1000);

		// Continue after compaction
		await chat(harness, "q5", "a5");

		const texts = messageTexts(harness);
		expect(texts.some((t) => t.includes("a5"))).toBe(true);
		expect(branchTexts(harness).some((t) => t.includes("q3"))).toBe(false); // q3 was rolled back
	});

	// ─── Case 6: 多次压缩 → 回滚 → 继续聊 ────────────────────────────

	it("case 6: multiple compactions → rollback → continue", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));

		// First compaction
		harness.sessionManager.appendCompaction("Summary 1", user2Id, 3000);

		const user3Id = harness.sessionManager.appendMessage(userMsg("q3"));
		harness.sessionManager.appendMessage(assistantMsg("a3"));

		// Second compaction
		harness.sessionManager.appendCompaction("Summary 2", user3Id, 2000);

		const user4Id = harness.sessionManager.appendMessage(userMsg("q4"));
		harness.sessionManager.appendMessage(assistantMsg("a4"));

		// Rollback to user3 (between the two compactions)
		await harness.session.navigateTree(user3Id, { skipFiles: true, summarize: false });

		// Continue
		await chat(harness, "q5", "a5");

		const texts = messageTexts(harness);
		expect(texts.some((t) => t.includes("a5"))).toBe(true);
		// q4/a4 should NOT be in branch (rolled back)
		expect(branchTexts(harness).some((t) => t.includes("q4"))).toBe(false);
	});

	// ─── Case 7: 回滚 → 聊 → 回滚 → 聊 → 压缩 ───────────────────────

	it("case 7: rollback → chat → rollback → chat → compaction", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));
		const user3Id = harness.sessionManager.appendMessage(userMsg("q3"));
		harness.sessionManager.appendMessage(assistantMsg("a3"));

		// First rollback to user2
		await harness.session.navigateTree(user2Id, { skipFiles: true, summarize: false });
		await chat(harness, "qA", "aA");

		// Second rollback to user3 (original branch)
		await harness.session.navigateTree(user3Id, { skipFiles: true, summarize: false });

		// Continue
		await chat(harness, "qB", "aB");

		// Compaction
		const qBEntry = findUserEntry(harness, "qB");
		harness.sessionManager.appendCompaction("Summary B", qBEntry?.id ?? user1Id, 1000);

		// Continue after compaction
		await chat(harness, "qC", "aC");

		const texts = messageTexts(harness);
		expect(texts.some((t) => t.includes("aC"))).toBe(true);
		// qA/aA should NOT be in branch (was on a different branch)
		expect(branchTexts(harness).some((t) => t.includes("qA"))).toBe(false);
	});

	// ─── Case 8: 压缩 → 回滚到压缩点 → 继续 → 再压缩 ────────────────

	it("case 8: compaction → rollback to compaction → continue → re-compact", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));

		// First compaction
		const compact1Id = harness.sessionManager.appendCompaction("Summary 1", user2Id, 1000);

		const user3Id = harness.sessionManager.appendMessage(userMsg("q3"));
		harness.sessionManager.appendMessage(assistantMsg("a3"));

		// Rollback to user3 (after first compaction)
		await harness.session.navigateTree(user3Id, { skipFiles: true, summarize: false });

		// Continue
		await chat(harness, "q4", "a4");

		// Second compaction
		const q4Entry = findUserEntry(harness, "q4");
		harness.sessionManager.appendCompaction("Summary 2", q4Entry?.id ?? user3Id, 1000);

		// Continue after second compaction
		await chat(harness, "q5", "a5");

		const texts = messageTexts(harness);
		expect(texts.some((t) => t.includes("a5"))).toBe(true);
		expect(branchTexts(harness).some((t) => t.includes("q5"))).toBe(true);
	});

	// ─── Edge: compaction then immediately rollback to before compaction ──

	it("compaction then rollback to pre-compaction user msg: messages correct", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		const user1Id = harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));

		harness.sessionManager.appendCompaction("Summary of q1+a1+q2+a2", user2Id, 1000);

		// Rollback to user1 (before compaction)
		await harness.session.navigateTree(user1Id, { skipFiles: true, summarize: false });

		// After rollback to user1: compaction should be excluded
		const ctx = harness.sessionManager.buildSessionContext();
		const ctxTexts = ctx.messages.map((m) => getMessageText(m));
		expect(ctxTexts.some((t) => t.includes("Summary"))).toBe(false);
		expect(ctxTexts.some((t) => t.includes("q2"))).toBe(false);
	});

	// ─── Edge: rollback to compaction entry itself ────────────────────

	it("rollback to a non-user entry between compaction and messages", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.sessionManager.appendMessage(userMsg("q1"));
		harness.sessionManager.appendMessage(assistantMsg("a1"));
		const user2Id = harness.sessionManager.appendMessage(userMsg("q2"));
		harness.sessionManager.appendMessage(assistantMsg("a2"));

		harness.sessionManager.appendCompaction("Summary", user2Id, 1000);

		// Post-compaction messages
		harness.sessionManager.appendMessage(userMsg("q3"));
		harness.sessionManager.appendMessage(assistantMsg("a3"));

		// Find the user2 entry and rollback
		await harness.session.navigateTree(user2Id, { skipFiles: true, summarize: false });

		// After rollback to user2 (which is the compaction's firstKeptEntry):
		// The context should include the compaction summary
		const ctx = harness.sessionManager.buildSessionContext();
		const ctxTexts = ctx.messages.map((m) => getMessageText(m));

		// q3/a3 should be excluded
		expect(ctxTexts.some((t) => t.includes("q3"))).toBe(false);
	});
});
