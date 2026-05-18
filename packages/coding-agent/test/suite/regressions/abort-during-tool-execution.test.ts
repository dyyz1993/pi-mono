/**
 * Test for: session.abort() must resolve promptly even when a tool is executing.
 *
 * Previously, AgentSession.abort() called agent.abort() + await agent.waitForIdle().
 * If a tool execution didn't check the abort signal, waitForIdle() blocked forever.
 * Fix: Added a timeout (Promise.race) to the waitForIdle() call.
 */

import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

describe("session.abort() during tool execution", () => {
	it("abort resolves within idle timeout even when tool ignores abort signal", async () => {
		let resolveTool: () => void = () => {};
		const toolDone = new Promise<void>((resolve) => {
			resolveTool = resolve;
		});

		const harness: Harness = await createHarness({
			tools: [
				{
					name: "slow_tool",
					description: "A tool that blocks forever",
					parameters: {
						type: "object",
						properties: { input: { type: "string" } },
					} as any,
					execute: async () => {
						await toolDone;
						return { output: "done" };
					},
				} satisfies AgentTool<{ input: string }>,
			],
		});

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("slow_tool", { input: "test" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Task completed"),
		]);

		const sawToolStart = new Promise<void>((resolve) => {
			const unsub = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					unsub();
					resolve();
				}
			});
		});

		harness.session.prompt("run slow_tool").catch(() => {});
		await sawToolStart;

		// abort() should resolve within the idle timeout (2s), not hang forever.
		// We give it 5s as the upper bound for the test.
		const abortStart = Date.now();
		const MAX_ABORT_MS = 5_000;

		const abortResult = await Promise.race([
			harness.session.abort().then(
				() => "resolved" as const,
				() => "rejected" as const,
			),
			new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), MAX_ABORT_MS)),
		]);

		const elapsed = Date.now() - abortStart;

		// Unblock tool for cleanup
		resolveTool();

		if (abortResult === "timeout") {
			harness.cleanup();
			expect.fail(
				`session.abort() timed out after ${elapsed}ms — ` +
					"abort should resolve within idle timeout even when tool blocks",
			);
		}

		// abort should resolve in ~2s (the idle timeout), well under 5s
		expect(elapsed).toBeLessThan(MAX_ABORT_MS);
		harness.cleanup();
	});
});
