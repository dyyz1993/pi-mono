import * as fs from "node:fs";
import * as path from "node:path";
import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.js";

describe("callLLM", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	describe("without tools (single-turn complete)", () => {
		it("returns text response from LLM", async () => {
			harness = await createHarness();
			harness.setResponses([fauxAssistantMessage("Hello from LLM!")]);

			const result = await harness.session.callLLM({
				systemPrompt: "You are a test assistant.",
				messages: [{ role: "user", content: "Say hello" }],
			});

			expect(result).toBe("Hello from LLM!");
			expect(harness.faux.state.callCount).toBe(1);
		});

		it("passes systemPrompt and messages correctly", async () => {
			harness = await createHarness();
			harness.setResponses([fauxAssistantMessage("response text")]);

			const result = await harness.session.callLLM({
				systemPrompt: "Be concise.",
				messages: [{ role: "user", content: "Hello" }],
			});

			expect(result).toBe("response text");
		});

		it("throws when no model is available", async () => {
			harness = await createHarness({ withConfiguredAuth: false });

			await expect(
				harness.session.callLLM({
					messages: [{ role: "user", content: "test" }],
				}),
			).rejects.toThrow("No API key");
		});

		it("respects maxTokens option", async () => {
			harness = await createHarness();
			harness.setResponses([fauxAssistantMessage("short")]);

			const result = await harness.session.callLLM({
				messages: [{ role: "user", content: "test" }],
				maxTokens: 10,
			});

			expect(result).toBe("short");
		});

		it("handles multi-message conversation", async () => {
			harness = await createHarness();
			harness.setResponses([fauxAssistantMessage("I understand.")]);

			const result = await harness.session.callLLM({
				systemPrompt: "You are helpful.",
				messages: [
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "Hi there!" },
					{ role: "user", content: "How are you?" },
				],
			});

			expect(result).toBe("I understand.");
		});
	});

	describe("with tools (agent loop)", () => {
		it("creates tools and runs agent loop", async () => {
			harness = await createHarness();

			const testFile = path.join(harness.tempDir, "test.txt");
			fs.writeFileSync(testFile, "hello world");

			const toolCallResponse = fauxAssistantMessage([
				{ type: "text", text: "Let me check." },
				{
					type: "toolCall",
					id: "tc_1",
					name: "read",
					arguments: { path: testFile },
				},
			]);
			harness.setResponses([toolCallResponse, fauxAssistantMessage("The file says hello world.")]);

			const result = await harness.session.callLLM({
				systemPrompt: "Read files when asked.",
				messages: [{ role: "user", content: `Read ${testFile}` }],
				tools: ["read"],
				maxTurns: 5,
			});

			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
			expect(harness.faux.state.callCount).toBe(2);
		});

		it("restricts to specified tools", async () => {
			harness = await createHarness();
			harness.setResponses([fauxAssistantMessage("done")]);

			await harness.session.callLLM({
				messages: [{ role: "user", content: "test" }],
				tools: ["read", "grep"],
				maxTurns: 1,
			});

			expect(harness.faux.state.callCount).toBe(1);
		});

		it("ignores unknown tool names", async () => {
			harness = await createHarness();
			harness.setResponses([fauxAssistantMessage("ok")]);

			await harness.session.callLLM({
				messages: [{ role: "user", content: "test" }],
				tools: ["read", "nonexistent_tool"],
				maxTurns: 1,
			});

			expect(harness.faux.state.callCount).toBe(1);
		});
	});

	describe("abort signal", () => {
		it("respects abort signal", async () => {
			harness = await createHarness();
			harness.setResponses([fauxAssistantMessage("should not see this")]);

			const controller = new AbortController();
			controller.abort();

			await expect(
				harness.session.callLLM({
					messages: [{ role: "user", content: "test" }],
					signal: controller.signal,
				}),
			).rejects.toThrow();
		});
	});
});
