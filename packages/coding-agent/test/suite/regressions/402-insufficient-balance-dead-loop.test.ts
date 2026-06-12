import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, type Harness } from "../harness.ts";

// Regression: DeepSeek returns 402 Insufficient Balance. The error must not
// trigger compaction (which would succeed on summarized context and loop
// forever), retry, or any continuation. The session should terminate cleanly
// after a single LLM call.

describe("402 insufficient balance dead-loop prevention", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("does not retry 402 Insufficient Balance errors", async () => {
		const harness = await createHarness({
			settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "Error: 402 Insufficient Balance. Your balance is not enough to access this model.",
			}),
		]);

		await harness.session.prompt("test");

		// Must be exactly 1 call — no retries for billing errors
		expect(harness.faux.state.callCount).toBe(1);
		// No retry events
		expect(harness.eventsOfType("auto_retry_start")).toHaveLength(0);
		expect(harness.eventsOfType("auto_retry_end")).toHaveLength(0);
	});

	it("does not loop on 'insufficient_balance' error variant", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "insufficient_balance: account has no available funds",
			}),
		]);

		await harness.session.prompt("test");

		expect(harness.faux.state.callCount).toBe(1);
	});

	it("does not loop on 'insufficient balance' (space) error variant", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "Error: insufficient balance for this request",
			}),
		]);

		await harness.session.prompt("test");

		expect(harness.faux.state.callCount).toBe(1);
	});

	it("abort breaks out of post-run loop", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Return a normal response that would normally trigger compaction/continuation
		// but abort mid-flight to verify the _aborted flag works
		harness.setResponses([fauxAssistantMessage("done")]);

		// Start prompt and abort immediately
		const promptPromise = harness.session.prompt("test");
		await harness.session.abort();
		await promptPromise;

		// Session should not be streaming after abort
		expect(harness.session.isStreaming).toBe(false);
	});

	it("still retries transient errors (regression guard)", async () => {
		const harness = await createHarness({
			settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			fauxAssistantMessage("recovered"),
		]);

		await harness.session.prompt("test");

		expect(harness.faux.state.callCount).toBe(2);
		expect(getAssistantTexts(harness)).toContain("recovered");
	});

	it("continue() retries after error without adding new user message", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// First prompt: returns an error (non-retryable, non-billing so it doesn't loop)
		harness.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "some non-retryable error that is not billing",
			}),
			fauxAssistantMessage("recovered via continue"),
		]);

		await harness.session.prompt("test");

		// After prompt: 1 call, error occurred
		expect(harness.faux.state.callCount).toBe(1);

		// The error assistant message is still the last message in agent state.
		// _handlePostAgentRun consumed _lastAssistantMessage but didn't remove
		// it from agent.state.messages. For continue() to work, the last message
		// must be a user/tool-result message. Remove the error assistant message.
		const messages = harness.session.agent.state.messages;
		if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
			harness.session.agent.state.messages = messages.slice(0, -1);
		}

		// Now call continue() to retry
		await harness.session.continue();

		// continue() should have made a second call
		expect(harness.faux.state.callCount).toBe(2);
		expect(getAssistantTexts(harness)).toContain("recovered via continue");
	});

	it("continue() resets overflow recovery counter for re-compaction", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// First prompt: overflow error. Compaction is complex to simulate
		// end-to-end via the harness (compaction summary call + retry).
		// Instead, verify the counter reset via direct internal access.
		const internals = harness.session as unknown as {
			_overflowRecoveryAttempts: number;
		};

		// Simulate: overflow recovery was attempted multiple times
		internals._overflowRecoveryAttempts = 5;
		expect(internals._overflowRecoveryAttempts).toBe(5);

		// Seed a response and set up agent state for continue()
		harness.setResponses([fauxAssistantMessage("recovered")]);
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "retry" }], timestamp: Date.now() },
		];

		// continue() should reset _overflowRecoveryAttempts
		await harness.session.continue();

		expect(internals._overflowRecoveryAttempts).toBe(0);
		// The LLM was called (the retry)
		expect(harness.faux.state.callCount).toBe(1);
		expect(getAssistantTexts(harness)).toContain("recovered");
	});
});
