import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import multiCompaction from "../../extensions/_multi-compaction/index.ts";
import { convertToLlm } from "../../src/core/messages.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

// Test that contextFold:
// 1. Creates a compaction_fold custom entry (for UI display)
// 2. Queues a fold summary for next-turn delivery (deliverAs: "nextTurn")
//    so the LLM sees it on the next prompt — NOT immediately (which would
//    re-trigger the agent loop via the steering queue).
// 3. After the next prompt, the fold summary IS in LLM-visible context.

describe("contextFold LLM injection", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("fold summary appears in LLM context after next prompt (nextTurn delivery)", async () => {
		const harness = await createHarness({
			extensionFactories: [multiCompaction],
		});
		harnesses.push(harness);

		// Seed old messages that will be folded (timestamp > 30 min ago)
		const oldTimestamp = Date.now() - 31 * 60 * 1000;
		const sm = harness.sessionManager;

		// Create enough assistant messages to trigger fold (need > keepRecentCount=6)
		for (let i = 0; i < 8; i++) {
			sm.appendMessage(fauxAssistantMessage(`old message ${i}`, { timestamp: oldTimestamp + i * 1000 }));
		}

		// Add one recent message to make the old ones foldable
		sm.appendMessage(fauxAssistantMessage("recent work", { timestamp: Date.now() }));

		// First prompt: triggers turn_end → contextFold → queues fold summary for nextTurn
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("first prompt");

		// At this point, the fold summary should be queued but not yet in LLM context.
		// The messages were deleted from context. A compaction_fold custom entry exists.
		const inMemoryContextText = harness.session.agent.state.messages.map(getMessageText).join("\n");
		expect(inMemoryContextText).not.toContain("old message 0");
		expect(inMemoryContextText).toContain("recent work");

		// Second prompt: the nextTurn message (fold summary) gets prepended
		harness.setResponses([fauxAssistantMessage("second response")]);
		await harness.session.prompt("second prompt");

		// Now check that the fold summary IS in the LLM-visible context
		const sessionContext = sm.buildSessionContext();
		const llmMessages = convertToLlm(sessionContext.messages);

		const foldMessages = llmMessages.filter(
			(m) =>
				typeof m.content === "object" &&
				Array.isArray(m.content) &&
				m.content.some((part: { text?: string }) => part.text?.includes("Context fold")),
		);

		expect(foldMessages.length).toBeGreaterThan(0);
		const foldText = (foldMessages[0]!.content as Array<{ text: string }>).map((p) => p.text).join("");
		expect(foldText).toContain("Context fold");
	});

	it("fold does NOT immediately re-trigger the agent loop (no steering)", async () => {
		// Regression test for text-only reply loop (session 86e95d84).
		// Before the fix, pi.sendMessage() during turn_end went into the
		// steering queue, causing runLoop to continue and re-call the LLM.
		// After the fix (deliverAs: "nextTurn"), the loop should NOT continue.
		const harness = await createHarness({
			extensionFactories: [multiCompaction],
		});
		harnesses.push(harness);

		// Seed old messages
		const oldTimestamp = Date.now() - 31 * 60 * 1000;
		const sm = harness.sessionManager;
		for (let i = 0; i < 8; i++) {
			sm.appendMessage(fauxAssistantMessage(`old ${i}`, { timestamp: oldTimestamp + i * 1000 }));
		}
		sm.appendMessage(fauxAssistantMessage("recent", { timestamp: Date.now() }));

		// Provide exactly ONE response — if the loop re-triggers, it'll try
		// to call the faux provider again and either hang or error.
		harness.setResponses([fauxAssistantMessage("single response")]);

		await harness.session.prompt("test");

		// Should have called the LLM exactly once (not multiple times from re-triggering)
		expect(harness.faux.state.callCount).toBe(1);
	});
});
