import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

/**
 * Tests for rollback behavior with navigateTree's role-based logic.
 *
 * Backend navigateTree (agent-session.ts line 3225-3242):
 * - target is user message → newLeafId = parentId (jumps before the user msg)
 * - target is assistant/other → newLeafId = targetId (stays at the target)
 *
 * This means:
 * - navigateTree(assistantEntryId) → leaf = assistant → assistant is VISIBLE (on path)
 * - navigateTree(userEntryId) → leaf = parentId → user is NOT visible
 *
 * For "rollback this assistant reply" (remove it):
 *   Frontend should pass parentId of the assistant, not the assistant itself.
 *   navigateTree(parentId=userEntryId) → backend sees user → newLeafId = user's parentId
 *   → everything from that user onward is removed, including the assistant.
 *
 * For "jump to this point in history" (keep it visible):
 *   Frontend passes the entryId directly.
 *   navigateTree(assistantEntryId) → leaf = assistant → assistant is visible.
 */
describe("rollback assistant message: navigateTree role-based behavior", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function doSimpleTurn(h: Harness, prompt: string) {
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "dummy.txt", content: prompt }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await h.session.prompt(prompt);
	}

	it("navigateTree(currentLeaf) is no-op", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const leafId = h.sessionManager.getLeafId()!;
		const messagesBefore = h.session.messages.length;

		const result = await h.session.navigateTree(leafId, { summarize: false });
		expect(result.cancelled).toBe(false);
		expect(h.session.messages.length).toBe(messagesBefore);
	});

	it("navigateTree(assistantEntryId) keeps assistant visible — leaf stays at target", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		// Find turn1's last assistant entry
		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter((e) => e.type === "message");
		const assistantEntries = messageEntries.filter((e) => (e as any).message?.role === "assistant");
		// Turn 1's assistant: entries [1] and [3] (toolCall + text)
		const turn1LastAssistant = assistantEntries[1]; // "done" after turn1

		const messagesBefore = h.session.messages.length;

		// navigateTree(assistant) → backend: newLeafId = targetId (stays here)
		await h.session.navigateTree(turn1LastAssistant.id, { summarize: false });

		// Leaf should be at the assistant entry
		expect(h.sessionManager.getLeafId()).toBe(turn1LastAssistant.id);

		// Messages should decrease (turn2 stuff removed)
		const messagesAfter = h.session.messages.length;
		expect(messagesAfter).toBeLessThan(messagesBefore);

		// But the assistant entry itself should be visible (on the path)
		const branch = h.sessionManager.getBranch();
		expect(branch.some((e) => e.id === turn1LastAssistant.id)).toBe(true);
	});

	it("navigateTree(userEntryId) removes user and everything after — backend jumps to parentId", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		// Find turn2's user entry
		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter((e) => e.type === "message");
		const userEntries = messageEntries.filter((e) => (e as any).message?.role === "user");
		const turn2User = userEntries[1];

		const messagesBefore = h.session.messages.length;

		// navigateTree(user) → backend: newLeafId = parentId (before user)
		await h.session.navigateTree(turn2User.id, { summarize: false });

		// Leaf should be BEFORE turn2User
		const leafAfter = h.sessionManager.getLeafId();
		expect(leafAfter).not.toBe(turn2User.id);

		// Turn2 user should NOT be on the path
		const branch = h.sessionManager.getBranch();
		expect(branch.some((e) => e.id === turn2User.id)).toBe(false);

		// Messages should decrease
		expect(h.session.messages.length).toBeLessThan(messagesBefore);

		// Only 1 user message should remain
		const userMsgs = h.session.messages.filter((m) => m.role === "user").length;
		expect(userMsgs).toBe(1);
	});

	it("rollback scenario: pass assistant's parentId (user entry) removes both turn2 messages", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		// Find turn2's user entry (= parentId of turn2's first assistant)
		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter((e) => e.type === "message");
		const userEntries = messageEntries.filter((e) => (e as any).message?.role === "user");
		const turn2User = userEntries[1];

		// Frontend passes turn2User.id (parentId of assistant)
		// Backend sees user → newLeafId = turn2User.parentId (before turn2)
		await h.session.navigateTree(turn2User.id, { summarize: false });

		// Only turn1 should remain
		const userMsgs = h.session.messages.filter((m) => m.role === "user");
		expect(userMsgs.length).toBe(1);
	});

	it("getBranch confirms path structure", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const leafBefore = h.sessionManager.getLeafId()!;
		const branchBefore = h.sessionManager.getBranch(leafBefore);

		// Navigate to turn1's last assistant (keeping it visible)
		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter((e) => e.type === "message");
		const assistantEntries = messageEntries.filter((e) => (e as any).message?.role === "assistant");
		const turn1LastAssistant = assistantEntries[1];

		await h.session.navigateTree(turn1LastAssistant.id, { summarize: false });

		const leafAfter = h.sessionManager.getLeafId()!;
		const branchAfter = h.sessionManager.getBranch();

		expect(branchAfter.length).toBeLessThan(branchBefore.length);
		expect(branchAfter.some((e) => e.id === turn1LastAssistant.id)).toBe(true);
	});
});
