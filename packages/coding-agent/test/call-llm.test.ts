import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("AgentSession.callLLM", () => {
	let harness: Harness | undefined;

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("returns text from a single LLM call", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("hello from callLLM")]);

		const result = await harness.session.callLLM({
			systemPrompt: "Be direct.",
			messages: [{ role: "user", content: "Say hello" }],
		});

		expect(result).toBe("hello from callLLM");
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("passes multi-message history to the provider", async () => {
		harness = await createHarness();
		let receivedMessages = 0;
		harness.setResponses([
			(context) => {
				receivedMessages = context.messages.length;
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.callLLM({
			messages: [
				{ role: "user", content: "first" },
				{ role: "assistant", content: "second" },
				{ role: "user", content: "third" },
			],
		});

		expect(receivedMessages).toBe(3);
	});

	it("runs a temporary tool-using agent when tools are specified", async () => {
		harness = await createHarness();
		const filePath = join(harness.tempDir, "note.txt");
		writeFileSync(filePath, "hello file");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { path: filePath }, { id: "call-read" })),
			fauxAssistantMessage("read completed"),
		]);

		const result = await harness.session.callLLM({
			messages: [{ role: "user", content: `Read ${filePath}` }],
			tools: ["read"],
			maxTurns: 5,
		});

		expect(result).toBe("read completed");
		expect(harness.faux.state.callCount).toBe(2);
	});
});
