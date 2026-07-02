import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, getMessageText, getUserTexts, type Harness } from "./harness.ts";

function userMsg(text: string) {
	return {
		role: "user" as const,
		content: [{ type: "text" as const, text }],
		timestamp: Date.now(),
	};
}

/**
 * Create a harness with an interruptible tool that blocks until releaseToolExecution
 * is called, and checks the abort signal.
 */
async function createInterruptibleHarness(): Promise<{
	harness: Harness;
	releaseToolExecution: () => void;
	promptPromise: Promise<void>;
	waitForToolStart: Promise<void>;
}> {
	let releaseToolExecution: (() => void) | undefined;
	const toolRelease = new Promise<void>((resolve) => {
		releaseToolExecution = resolve;
	});

	const slowTool: AgentTool = {
		name: "slow",
		label: "Slow",
		description: "Slow tool that checks abort signal",
		parameters: Type.Object({}),
		execute: async (_id, _args, signal) => {
			// Cooperatively check the abort signal so interrupt() can cut through
			await new Promise<void>((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Interrupted before execution"));
					return;
				}
				const onAbort = () => reject(new Error("Interrupted"));
				signal?.addEventListener("abort", onAbort);
				toolRelease.then(() => {
					signal?.removeEventListener("abort", onAbort);
					resolve();
				});
			});
			return { content: [{ type: "text", text: "slow done" }], details: {} };
		},
	};

	const harness = await createHarness({ tools: [slowTool] });

	const waitForToolStart = new Promise<void>((resolve) => {
		const unsub = harness.session.subscribe((event) => {
			if (event.type === "tool_execution_start" && event.toolName === "slow") {
				unsub();
				resolve();
			}
		});
	});

	return {
		harness,
		releaseToolExecution: () => releaseToolExecution?.(),
		promptPromise: harness.session.prompt("start"),
		waitForToolStart,
	};
}

describe("interrupt and steer", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	// ────────── Normal flow (4 tests) ──────────

	it('steer("text") at idle starts a new run', async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("text done")]);
		await harness.session.steer("hello");

		const us = getUserTexts(harness);
		expect(us).toContain("hello");
		const as = getAssistantTexts(harness);
		expect(as).toContain("text done");
	});

	it("steer({ promote, immediate }) at idle promotes and processes message", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.followUp(userMsg("from followUp"));
		harness.setResponses([fauxAssistantMessage("promoted")]);

		await harness.session.steer({ promote: 0, immediate: true });

		const us = getUserTexts(harness);
		expect(us).toContain("from followUp");
		const as = getAssistantTexts(harness);
		expect(as).toContain("promoted");
	});

	it("steer({ immediate }) at idle drains steer queue", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.steer(userMsg("queued"));
		harness.setResponses([fauxAssistantMessage("drained")]);

		await harness.session.steer({ immediate: true });

		const us = getUserTexts(harness);
		expect(us).toContain("queued");
	});

	it("steer({ promote }) at idle (no immediate) still starts a run", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.followUp(userMsg("auto promote"));
		harness.setResponses([fauxAssistantMessage("auto done")]);

		await harness.session.steer({ promote: 0 });

		const us = getUserTexts(harness);
		expect(us).toContain("auto promote");
	});

	// ────────── Edge cases (12 tests) ──────────

	it("steer({ promote: -1 }) at idle does nothing (no crash, no run)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.followUp(userMsg("stays"));
		harness.setResponses([fauxAssistantMessage("should not appear")]);

		// Negative index — takeAt returns undefined, nothing is enqueued
		await harness.session.steer({ promote: -1, immediate: true });

		// No LLM call should have happened — "should not appear" should not be consumed
		// The followUp queue still has the message
		expect(harness.session.agent.hasQueuedMessages()).toBe(true);
		const as = getAssistantTexts(harness);
		expect(as).toHaveLength(0);
	});

	it("steer({ promote: 999 }) at idle does nothing (out of bounds)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.followUp(userMsg("stays"));
		harness.setResponses([fauxAssistantMessage("should not appear")]);

		await harness.session.steer({ promote: 999, immediate: true });

		expect(harness.session.agent.hasQueuedMessages()).toBe(true);
		const as = getAssistantTexts(harness);
		expect(as).toHaveLength(0);
	});

	it("steer({ immediate }) with empty queues does nothing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("ghost")]);
		await harness.session.steer({ immediate: true });

		// No run should have started
		const as = getAssistantTexts(harness);
		expect(as).toHaveLength(0);
	});

	it("interrupt() at idle does nothing (no crash, no run)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.interrupt();
		// No run should have started
		const msgs = harness.session.messages;
		expect(msgs).toHaveLength(0);
	});

	it("steer(AgentMessage) appends (old API), steer(opts) overwrites (new API)", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Old API appends
		harness.session.agent.steer(userMsg("first"));
		harness.session.agent.steer(userMsg("second"));

		let drained = harness.session.agent.drainSteeringMessages();
		expect(drained).toHaveLength(2);
		expect(getMessageText(drained[0])).toBe("first");
		expect(getMessageText(drained[1])).toBe("second");

		// New API overwrites
		harness.session.agent.steer({ message: userMsg("third") });
		harness.session.agent.steer({ message: userMsg("fourth") });

		drained = harness.session.agent.drainSteeringMessages();
		expect(drained).toHaveLength(1);
		expect(getMessageText(drained[0])).toBe("fourth");
	});

	it("steer({ message }) followed by steer({ message }) overwrites", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.steer({ message: userMsg("first") });
		harness.session.agent.steer({ message: userMsg("second") });

		harness.setResponses([fauxAssistantMessage("second only")]);

		// Drain should only have "second"
		const drained = harness.session.agent.drainSteeringMessages();
		expect(drained).toHaveLength(1);
		expect(getMessageText(drained[0])).toBe("second");

		// The second message should be the one processed
		await harness.session.agent.prompt(drained);
		const as = getAssistantTexts(harness);
		// The prompt consumed our response
	});

	it("followUp promotes one item, remaining items are auto-consumed by finishRun", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.followUp(userMsg("keep"));
		harness.session.agent.followUp(userMsg("promote me"));

		// Two responses needed: one for promoted msg, one for remaining followUp
		harness.setResponses([fauxAssistantMessage("promoted"), fauxAssistantMessage("auto kept")]);

		// Promote index 1 (the second one)
		await harness.session.steer({ promote: 1, immediate: true });

		// "promote me" was processed first
		const us = getUserTexts(harness);
		expect(us).toContain("promote me");

		// "keep" was auto-processed by finishRun → followUp drain
		expect(us).toContain("keep");
		const as = getAssistantTexts(harness);
		expect(as).toContain("promoted");
		expect(as).toContain("auto kept");
	});

	it("steer({ promote: 0 }) on empty followUp does nothing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("nope")]);
		await harness.session.steer({ promote: 0, immediate: true });

		// No run should have started
		const as = getAssistantTexts(harness);
		expect(as).toHaveLength(0);
	});

	it("steer with empty text still works", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("empty ok")]);
		await harness.session.steer("");

		const us = getUserTexts(harness);
		// Empty string is still a user message
		expect(us).toHaveLength(1);
	});

	it("steer({ promote: 0 }) after steer({ promote: 0 }) only last survives", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.session.agent.followUp(userMsg("a"));
		harness.session.agent.followUp(userMsg("b"));

		// First promote takes "a", second promote takes "b" from remaining
		harness.session.agent.steer({ promote: 0 }); // promotes "a" → "b" remains
		harness.session.agent.steer({ promote: 0 }); // promotes "b" → empty

		const drained = harness.session.agent.drainSteeringMessages();
		expect(drained).toHaveLength(1);
		expect(getMessageText(drained[0])).toBe("b");
	});

	it("steer({ message }) at idle (text path) starts a new run even without immediate", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("idle ok")]);
		await harness.session.steer("idle message");

		const us = getUserTexts(harness);
		expect(us).toContain("idle message");
	});

	it("interrupt() during tool execution cuts tool and steer is picked up", async () => {
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = await createInterruptibleHarness();
		harnesses.push(harness);

		// First response calls the slow tool
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("slow", {}), { stopReason: "toolUse" }),
			(context) => {
				const hasSteer = context.messages.some((m) => m.role === "user" && getMessageText(m) === "interject!");
				return fauxAssistantMessage(hasSteer ? "saw interject" : "missed interject");
			},
		]);

		await waitForToolStart;

		// While tool is running, send steer with promote
		harness.session.agent.followUp(userMsg("interject!"));
		await harness.session.steer({ promote: 0, immediate: true });

		// Release the tool — the interrupt signal should have aborted it via the listener
		releaseToolExecution();

		await promptPromise;

		// The steer message should have been injected and the LLM saw it
		const as = getAssistantTexts(harness);
		expect(as).toContain("saw interject");
	});
});
