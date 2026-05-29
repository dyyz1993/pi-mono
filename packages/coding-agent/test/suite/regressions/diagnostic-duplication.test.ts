/**
 * Diagnostic test to pinpoint the exact root cause of the 8 vs 6 discrepancy.
 */
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

function noopExtension() {
	return (_pi: import("../../../src/core/extensions/types.js").ExtensionAPI) => {};
}

describe("DIAGNOSTIC: get_full_messages duplication root cause", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("trace exact data flow: which messages appear and why", async () => {
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
		// Still the same - deletion entry appended but context not rebuilt

		// Rebuild context (this is what navigateTree/compaction/session-restart does)
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

		// Now simulate get_full_messages EXACTLY as rpc-mode.ts does
		const allEntries = h.sessionManager.getEntries();
		const branchEntries = h.sessionManager.getBranch();
		const branchIds = new Set(branchEntries.map((e) => e.id));
		const messageEntriesOnBranch = allEntries.filter(
			(e) => e.type === "message" && branchIds.has(e.id),
		);

		console.log("\n=== get_full_messages SIMULATION ===");
		console.log("message entries on branch (raw):", messageEntriesOnBranch.length);
		for (const e of messageEntriesOnBranch) {
			const msg = (e as any).message;
			console.log(
				"  entry:",
				e.id.slice(0, 8),
				msg.role,
				msg.role === "assistant" && Array.isArray(msg.content)
					? msg.content.map((p: any) => p.type).join("+")
					: "",
			);
		}

		// persistedSet
		const persistedSet = new Set(
			messageEntriesOnBranch.map((e) => (e as { message: AgentMessage }).message),
		);
		console.log("persistedSet size:", persistedSet.size);

		// Walk backward through memoryMessages
		console.log("\nWalking backward through session.messages:");
		const unPersisted: AgentMessage[] = [];
		for (let i = memAfter.length - 1; i >= 0; i--) {
			const msg = memAfter[i];
			const inSet = persistedSet.has(msg);
			console.log(
				"  i=",
				i,
				msg.role,
				"inPersistedSet:",
				inSet,
				msg.role === "assistant" && Array.isArray(msg.content)
					? msg.content.map((p: any) => p.type).join("+")
					: "",
			);
			if (inSet) {
				console.log("  → BREAK at i=", i);
				break;
			}
			if (msg.role === "compactionSummary") continue;
			unPersisted.unshift(msg);
		}
		console.log("unPersisted count:", unPersisted.length);

		const totalCount = messageEntriesOnBranch.length + unPersisted.length;
		console.log("\nFINAL: persistedMessages =", messageEntriesOnBranch.length, "+ unPersisted =", unPersisted.length, "= totalCount =", totalCount);
		console.log("session.messages.length =", memAfter.length);
		console.log("DISCREPANCY:", totalCount - memAfter.length, "extra messages");

		// The key question: does get_full_messages include DELETED entries?
		// It takes ALL message entries on branch - buildSessionContext filters deletions,
		// but get_full_messages does NOT.
		expect(totalCount).toBe(memAfter.length); // This will FAIL if bug exists
	});
});
