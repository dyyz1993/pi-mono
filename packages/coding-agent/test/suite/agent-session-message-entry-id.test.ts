import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession message entry ids", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("includes the persisted entry id on public message_end events", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("hello")]);

		await harness.session.prompt("hi");

		const assistantEnd = harness.eventsOfType("message_end").find((event) => event.message.role === "assistant");
		expect(assistantEnd?.entryId).toEqual(expect.any(String));

		const entry = harness.sessionManager.getEntries().find((candidate) => candidate.id === assistantEnd?.entryId);
		expect(entry?.type).toBe("message");
		if (entry?.type !== "message") {
			throw new Error("expected persisted message entry");
		}
		expect(entry.message.role).toBe("assistant");
	});
});
