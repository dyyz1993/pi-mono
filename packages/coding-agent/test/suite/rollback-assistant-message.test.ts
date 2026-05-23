import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

describe("rollback assistant message: targetId correctness", () => {
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

	it("navigateTree(leafId) is no-op when leaf is already at that position", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const leafId = h.sessionManager.getLeafId()!;
		expect(leafId).toBeTruthy();

		const messagesBefore = h.session.messages.length;

		const result = await h.session.navigateTree(leafId, { summarize: false });

		expect(result.cancelled).toBe(false);
		const messagesAfter = h.session.messages.length;
		expect(messagesAfter).toBe(messagesBefore);
	});

	it("navigateTree(assistantEntryId) keeps e4 in path because leaf stays at e4", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter((e) => e.type === "message");

		const assistantEntries = messageEntries.filter(
			(e) => (e as any).message?.role === "assistant",
		);
		expect(assistantEntries.length).toBeGreaterThanOrEqual(2);

		const lastAssistant = assistantEntries[assistantEntries.length - 1];
		const lastAssistantId = lastAssistant.id;

		const leafBefore = h.sessionManager.getLeafId();
		const messagesBefore = h.session.messages.length;

		const branchBefore = h.sessionManager.getBranch();
		const branchIncludesAssistant = branchBefore.some((e) => e.id === lastAssistantId);
		expect(branchIncludesAssistant).toBe(true);

		if (lastAssistantId !== leafBefore) {
			await h.session.navigateTree(lastAssistantId, { summarize: false });

			const leafAfter = h.sessionManager.getLeafId();
			expect(leafAfter).toBe(lastAssistantId);

			const messagesAfter = h.session.messages.length;
			expect(messagesAfter).toBeLessThanOrEqual(messagesBefore);

			const branchAfter = h.sessionManager.getBranch();
			const stillInBranch = branchAfter.some((e) => e.id === lastAssistantId);
			expect(stillInBranch).toBe(true);
		}
	});

	it("navigateTree(parentOfLastAssistant) correctly removes e4 assistant message", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const leafId = h.sessionManager.getLeafId()!;
		const leafEntry = h.sessionManager.getEntry(leafId)!;
		expect(leafEntry).toBeTruthy();

		const parentId = leafEntry.parentId;
		expect(parentId).toBeTruthy();

		const messagesBeforeRollback = h.session.messages.length;

		await h.session.navigateTree(parentId!, { summarize: false });

		const leafAfterRollback = h.sessionManager.getLeafId()!;
		expect(leafAfterRollback).toBe(parentId);

		const messagesAfterRollback = h.session.messages.length;
		expect(messagesAfterRollback).toBeLessThan(messagesBeforeRollback);

		const branchAfterRollback = h.sessionManager.getBranch();
		const leafEntryStillInBranch = branchAfterRollback.some((e) => e.id === leafId);
		expect(leafEntryStillInBranch).toBe(false);
	});

	it("full scenario: 2 turns → verify e1-e4 → navigateTree(e4) no-op → navigateTree(e3) removes e4", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter((e) => e.type === "message");

		const userEntries = messageEntries.filter(
			(e) => (e as any).message?.role === "user",
		);
		const assistantEntries = messageEntries.filter(
			(e) => (e as any).message?.role === "assistant",
		);

		expect(userEntries.length).toBe(2);
		expect(assistantEntries.length).toBeGreaterThanOrEqual(2);

		const leafId = h.sessionManager.getLeafId()!;
		const leafEntry = h.sessionManager.getEntry(leafId)!;
		const parentId = leafEntry.parentId!;

		const result = await h.session.navigateTree(leafId, { summarize: false });
		expect(result.cancelled).toBe(false);
		expect(h.sessionManager.getLeafId()).toBe(leafId);

		const messagesBeforeParentRollback = h.session.messages.length;
		const userMsgsBefore = h.session.messages.filter((m) => m.role === "user").length;

		await h.session.navigateTree(parentId, { summarize: false });

		const messagesAfterRollback = h.session.messages.length;
		expect(messagesAfterRollback).toBeLessThan(messagesBeforeParentRollback);

		const userMsgsAfter = h.session.messages.filter((m) => m.role === "user").length;
		expect(userMsgsAfter).toBe(userMsgsBefore);

		const assistantMsgsAfter = h.session.messages.filter((m) => m.role === "assistant").length;
		const assistantMsgsBefore = messagesBeforeParentRollback - messagesBeforeParentRollback;

		const branchAfter = h.sessionManager.getBranch();
		const messageIdsInBranch = new Set(
			branchAfter.filter((e) => e.type === "message").map((e) => e.id),
		);
		expect(messageIdsInBranch.has(leafId)).toBe(false);
	});

	it("getBranch(fromId) returns correct path for each target", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const leafId = h.sessionManager.getLeafId()!;
		const leafEntry = h.sessionManager.getEntry(leafId)!;
		const parentId = leafEntry.parentId!;

		const branchFromLeaf = h.sessionManager.getBranch(leafId);
		const branchFromParent = h.sessionManager.getBranch(parentId);

		expect(branchFromLeaf.length).toBeGreaterThan(branchFromParent.length);

		const leafInBranchFromLeaf = branchFromLeaf.some((e) => e.id === leafId);
		expect(leafInBranchFromLeaf).toBe(true);

		const leafInBranchFromParent = branchFromParent.some((e) => e.id === leafId);
		expect(leafInBranchFromParent).toBe(false);

		const userMsgsFromParent = branchFromParent.filter(
			(e) => e.type === "message" && (e as any).message?.role === "user",
		);
		expect(userMsgsFromParent.length).toBe(2);
	});

	it("getBranch from e3 still has both user messages but not e4 assistant entries", async () => {
		const h = await createHarness();
		harnesses.push(h);

		await doSimpleTurn(h, "turn1");
		await doSimpleTurn(h, "turn2");

		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter((e) => e.type === "message");

		const userEntries = messageEntries.filter(
			(e) => (e as any).message?.role === "user",
		);

		const leafId = h.sessionManager.getLeafId()!;
		const leafEntry = h.sessionManager.getEntry(leafId)!;
		const parentId = leafEntry.parentId!;

		const branchFromParent = h.sessionManager.getBranch(parentId);

		for (const ue of userEntries) {
			expect(branchFromParent.some((e) => e.id === ue.id)).toBe(true);
		}

		const assistantInParentBranch = branchFromParent.filter(
			(e) => e.type === "message" && (e as any).message?.role === "assistant",
		);
		const assistantInLeafBranch = messageEntries.filter(
			(e) => (e as any).message?.role === "assistant",
		);
		expect(assistantInParentBranch.length).toBeLessThan(assistantInLeafBranch.length);
	});
});
