/**
 * Regression test: get_full_messages duplication bug after deletion + rollback.
 *
 * BUG: When a deletion entry causes buildSessionContext to strip tool calls from
 * an assistant message (via spread clone at session-manager.ts:524), the cloned
 * message object loses identity with the original entry.message reference.
 *
 * In get_full_messages (rpc-mode.ts:782-791), the persistedSet uses object identity
 * (Set.has) to detect the boundary between persisted and unpersisted messages.
 * After navigateTree, agent.state.messages contains the CLONE (from buildSessionContext),
 * while persistedSet contains the ORIGINAL entry.message. The identity check fails,
 * causing the message to appear in BOTH persistedMessages AND unPersisted — duplication.
 *
 * This test reproduces the exact scenario:
 *   1. Turn with tool call
 *   2. Delete the assistant message with tool call (triggers stripping)
 *   3. Rebuild context (clone created)
 *   4. Rollback past the deletion
 *   5. Call get_full_messages simulation → check for duplication
 */
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

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

/**
 * Simulates get_full_messages from rpc-mode.ts — includes the identity-based persistedSet check.
 */
function getFullMessagesWithIdentity(h: Harness) {
	const allEntries = h.sessionManager.getEntries();
	const branchEntries = h.sessionManager.getBranch();
	const branchIds = new Set(branchEntries.map((e) => e.id));
	const messageEntries = allEntries.filter((e) => e.type === "message" && branchIds.has(e.id));

	// persistedSet uses OBJECT IDENTITY (same as rpc-mode.ts line 782)
	const persistedSet = new Set(messageEntries.map((e) => (e as { message: AgentMessage }).message));

	const memoryMessages = h.session.messages;
	const unPersisted: (AgentMessage & { entryId?: string })[] = [];
	for (let i = memoryMessages.length - 1; i >= 0; i--) {
		const msg = memoryMessages[i];
		if (persistedSet.has(msg)) break; // identity check
		if (msg.role === "compactionSummary") continue;
		unPersisted.unshift(msg);
	}

	const persistedMessages: (AgentMessage & { entryId: string })[] = messageEntries.map((e) => ({
		...(e as { message: AgentMessage }).message,
		entryId: e.id,
	}));

	const allMessages: (AgentMessage & { entryId?: string })[] = [...persistedMessages, ...unPersisted];

	return {
		messages: allMessages,
		persistedCount: persistedMessages.length,
		unPersistedCount: unPersisted.length,
		memoryCount: memoryMessages.length,
		totalCount: allMessages.length,
		// Expose for debugging
		persistedSet,
		memoryMessages,
	};
}

describe("rollback message duplication regression", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("reproduces: deletion + context rebuild breaks identity, causing duplication in get_full_messages", async () => {
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
		const afterTurn2 = h.sessionManager.getLeafId()!;
		await h.session.prompt("turn2");

		// Turn 3: simple text
		h.setResponses([fauxAssistantMessage("turn3-response")]);
		await h.session.prompt("turn3");

		// Count messages before deletion
		const beforeDeletion = h.session.messages.length;
		expect(beforeDeletion).toBeGreaterThan(0);

		// Find turn2's first assistant entry (the one with the tool call)
		const entries = h.sessionManager.getEntries();
		const messageEntries = entries.filter(
			(e) => e.type === "message" && (e as any).message?.role === "assistant",
		);

		// Find the assistant with toolCall content
		const toolCallAssistant = messageEntries.find((e) => {
			const msg = (e as any).message;
			return (
				msg.role === "assistant" &&
				Array.isArray(msg.content) &&
				msg.content.some((p: any) => p.type === "toolCall")
			);
		});
		expect(toolCallAssistant).toBeDefined();

		// Delete it — this creates a deletion entry
		h.sessionManager.appendDeletion([toolCallAssistant!.id]);

		// Rebuild context — this is where the clone happens
		const ctx = h.sessionManager.buildSessionContext();
		h.session["agent"].state.messages = ctx.messages;

		// Now check: session.messages should NOT contain the deleted message
		const afterRebuild = h.session.messages;
		expect(
			afterRebuild.some(
				(m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((p: any) => p.type === "toolCall"),
			),
		).toBe(false);

		// Now simulate get_full_messages — this is where the bug manifests
		const full = getFullMessagesWithIdentity(h);

		// The total count should equal the visible message count
		// (NOT double-counted due to identity mismatch)
		const expectedCount = h.session.messages.length;

		// THIS IS THE BUG: if identity breaks, totalCount > expectedCount
		// (some messages appear in both persisted and unPersisted)
		expect(full.totalCount).toBe(expectedCount);

		// If this assertion fails, it means:
		// - persistedSet doesn't recognize the cloned messages
		// - They fall through to unPersisted
		// - Result: duplicated messages in get_full_messages
	});

	it("reproduces: rollback after deletion → identity mismatch → duplication", async () => {
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

		// Now rollback past the deletion
		await h.session.navigateTree(afterTurn1, { summarize: false });

		// After rollback, check get_full_messages
		const full = getFullMessagesWithIdentity(h);

		// The assistant with tool call should be back in messages
		const hasToolCall = full.messages.some(
			(m) =>
				m.role === "assistant" &&
				Array.isArray(m.content) &&
				m.content.some((p: any) => p.type === "toolCall"),
		);
		expect(hasToolCall).toBe(true);

		// But should NOT be duplicated
		const expectedCount = h.session.messages.length;
		expect(full.totalCount).toBe(expectedCount);
	});

	it("no deletion scenario: identity preserved, no duplication", async () => {
		const h = await createHarness({ extensionFactories: [noopExtension()] });
		harnesses.push(h);

		// Simple turns — no tool calls, no deletions
		h.setResponses([fauxAssistantMessage("reply-1")]);
		const afterTurn1 = h.sessionManager.getLeafId()!;
		await h.session.prompt("turn1");
		const t1 = h.sessionManager.getLeafId()!;

		h.setResponses([fauxAssistantMessage("reply-2")]);
		await h.session.prompt("turn2");

		// Rollback to turn 1 (no deletion involved)
		await h.session.navigateTree(t1, { summarize: false });

		const full = getFullMessagesWithIdentity(h);
		expect(full.totalCount).toBe(h.session.messages.length);
		expect(full.unPersistedCount).toBe(0);
	});
});
