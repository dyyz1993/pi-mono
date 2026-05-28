/**
 * Tests for auto_retry_end event emission from pi.callLLM with retry options.
 *
 * Bug: When callLLM succeeds (withRetry returns successfully), the finally block
 * still emits auto_retry_end { success: false, attempt: 0 }, causing the UI
 * to show a spurious "retry failed" notification even though the call succeeded.
 */
import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

describe("callLLM retry event emission", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should not emit auto_retry_end { success: false } when callLLM with retry succeeds on first attempt", async () => {
		let callLLMResult: string | undefined;
		let callLLMError: string | undefined;
		let callLLMDone = false;

		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("agent_end", async () => {
						try {
							callLLMResult = await pi.callLLM({
								systemPrompt: "test",
								messages: [{ role: "user", content: "summarize" }],
								retry: { maxRetries: 3, baseDelayMs: 1 },
							});
						} catch (err) {
							callLLMError = err instanceof Error ? err.message : String(err);
						} finally {
							callLLMDone = true;
						}
					});
				},
			],
		});
		harnesses.push(harness);

		const retryEndEvents: Array<{ success: boolean; attempt: number; finalError?: string }> = [];
		harness.session.subscribe((event) => {
			if (event.type === "auto_retry_end") {
				retryEndEvents.push({ success: event.success, attempt: event.attempt, finalError: event.finalError });
			}
		});

		// Response 1: main agent response
		// Response 2: callLLM response (succeeds)
		harness.setResponses([fauxAssistantMessage("main response"), fauxAssistantMessage("callLLM response")]);

		await harness.session.prompt("test");

		// Wait for callLLM to complete (it runs in agent_end extension handler)
		await new Promise<void>((resolve) => {
			const check = () => {
				if (callLLMDone) return resolve();
				setTimeout(check, 10);
			};
			check();
		});

		// callLLM should have succeeded
		expect(callLLMResult).toBe("callLLM response");
		expect(callLLMError).toBeUndefined();

		// BUG: The finally block emits auto_retry_end { success: false, attempt: 0 }
		// even though callLLM succeeded. This spurious event should NOT exist.
		const spuriousEvents = retryEndEvents.filter((e) => e.success === false && e.attempt === 0);
		expect(spuriousEvents).toHaveLength(0);
	});

	it("should not emit any auto_retry_end when callLLM with retry succeeds without retries", async () => {
		let callLLMDone = false;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("agent_end", async () => {
						try {
							await pi.callLLM({
								systemPrompt: "test",
								messages: [{ role: "user", content: "summarize" }],
								retry: { maxRetries: 3, baseDelayMs: 1 },
							});
						} catch {
							// ignore
						} finally {
							callLLMDone = true;
						}
					});
				},
			],
		});
		harnesses.push(harness);

		const retryEvents: Array<{ type: string; success?: boolean; attempt: number }> = [];
		harness.session.subscribe((event) => {
			if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
				retryEvents.push({
					type: event.type,
					success: event.type === "auto_retry_end" ? event.success : undefined,
					attempt: event.attempt,
				});
			}
		});

		harness.setResponses([fauxAssistantMessage("main response"), fauxAssistantMessage("callLLM response")]);

		await harness.session.prompt("test");

		// Wait for callLLM to complete
		await new Promise<void>((resolve) => {
			const check = () => {
				if (callLLMDone) return resolve();
				setTimeout(check, 10);
			};
			check();
		});

		// No retries were needed — no auto_retry_start or auto_retry_end should be emitted
		expect(retryEvents).toEqual([]);
	});

	it("should not emit spurious auto_retry_end when callLLM is called without retry option", async () => {
		let callLLMDone = false;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("agent_end", async () => {
						try {
							await pi.callLLM({
								systemPrompt: "test",
								messages: [{ role: "user", content: "summarize" }],
								// No retry option
							});
						} catch {
							// ignore
						} finally {
							callLLMDone = true;
						}
					});
				},
			],
		});
		harnesses.push(harness);

		const retryEvents: Array<{ type: string; success?: boolean; attempt: number }> = [];
		harness.session.subscribe((event) => {
			if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
				retryEvents.push({
					type: event.type,
					success: event.type === "auto_retry_end" ? event.success : undefined,
					attempt: event.attempt,
				});
			}
		});

		harness.setResponses([fauxAssistantMessage("main response"), fauxAssistantMessage("callLLM response")]);

		await harness.session.prompt("test");

		// Wait for callLLM to complete
		await new Promise<void>((resolve) => {
			const check = () => {
				if (callLLMDone) return resolve();
				setTimeout(check, 10);
			};
			check();
		});

		// Without retry option, no retry events should be emitted at all
		expect(retryEvents).toEqual([]);
	});
});
