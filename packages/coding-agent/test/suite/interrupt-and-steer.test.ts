import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, getUserTexts, type Harness } from "./harness.ts";

describe("interrupt and steer", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("steer({ promote, immediate }) drains steer queue at idle and starts a run", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Queue a follow-up message directly on the agent (session's followUp would prompt when idle)
		const msg = {
			role: "user" as const,
			content: [{ type: "text" as const, text: "promoted msg" }],
			timestamp: Date.now(),
		};
		harness.session.agent.followUp(msg);

		// Promote it with immediate — should drain steer queue and start a run
		harness.setResponses([fauxAssistantMessage("processed promoted")]);

		await harness.session.steer({ promote: 0, immediate: true });

		// The promoted message should have been processed
		const as = getAssistantTexts(harness);
		expect(as).toContain("processed promoted");
		const us = getUserTexts(harness);
		expect(us).toContain("promoted msg");
	});

	it("steer({ immediate: true }) at idle drains steer queue and starts a run", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Queue a message via the agent directly
		const msg = {
			role: "user" as const,
			content: [{ type: "text" as const, text: "queued steer" }],
			timestamp: Date.now(),
		};
		harness.session["agent"].steer(msg);

		harness.setResponses([fauxAssistantMessage("queued response")]);

		// This should drain the steer queue and start a run
		await harness.session.steer({ immediate: true });

		const as = getAssistantTexts(harness);
		expect(as).toContain("queued response");
	});
});
