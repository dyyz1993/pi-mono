import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@dyyz1993/pi-ai";
import { fauxAssistantMessage } from "@dyyz1993/pi-ai";
import type { TSchema } from "typebox";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { validateStructuredOutput } from "../../src/utils/structured-output.js";
import { createHarness, type Harness } from "./harness.js";

const MAX_RETRIES = 3;

function getLastAssistantText(messages: AgentMessage[]): string {
	const lastMessage = messages[messages.length - 1];
	if (lastMessage?.role !== "assistant") return "";
	let text = "";
	for (const content of (lastMessage as AssistantMessage).content) {
		if (content.type === "text") {
			text += content.text;
		}
	}
	return text;
}

async function runStructuredOutputLoop(
	harness: Harness,
	schema: TSchema,
	initialMessage?: string,
): Promise<{ exitCode: number; data?: unknown; lastError?: string }> {
	const schemaPrompt = `\n\nYou must respond with valid JSON matching this schema:\n${JSON.stringify(schema)}\n\nRespond with JSON only, no markdown code blocks.`;
	const firstPrompt = (initialMessage ?? "") + schemaPrompt;
	await harness.session.prompt(firstPrompt);

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const raw = getLastAssistantText(harness.session.messages);
		const result = validateStructuredOutput(raw, schema);

		if (result.success) {
			return { exitCode: 0, data: result.data };
		}

		if (attempt < MAX_RETRIES) {
			await harness.session.prompt(
				`Your previous response was invalid: ${result.error}. Please respond with valid JSON matching the schema.`,
			);
		} else {
			return { exitCode: 1, lastError: result.error };
		}
	}

	return { exitCode: 1 };
}

describe("structured output harness integration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("succeeds when the LLM returns valid JSON on the first attempt", async () => {
		const schema = Type.Object({ name: Type.String(), age: Type.Number() });
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage('{"name":"Alice","age":30}')]);

		const { exitCode, data } = await runStructuredOutputLoop(harness, schema, "generate a person");

		expect(exitCode).toBe(0);
		expect(data).toEqual({ name: "Alice", age: 30 });
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("succeeds after one retry when the first response is not JSON", async () => {
		const schema = Type.Object({ count: Type.Number() });
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("The count is 42."), fauxAssistantMessage('{"count":42}')]);

		const { exitCode, data } = await runStructuredOutputLoop(harness, schema, "count to 42");

		expect(exitCode).toBe(0);
		expect(data).toEqual({ count: 42 });
		expect(harness.faux.state.callCount).toBe(2);
	});

	it("succeeds after a retry when the first response has a schema mismatch", async () => {
		const schema = Type.Object({ status: Type.String(), code: Type.Number() }, { additionalProperties: false });
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage('{"status":"ok","code":200,"extra":true}'),
			fauxAssistantMessage('{"status":"ok","code":200}'),
		]);

		const { exitCode, data } = await runStructuredOutputLoop(harness, schema, "status check");

		expect(exitCode).toBe(0);
		expect(data).toEqual({ status: "ok", code: 200 });
		expect(harness.faux.state.callCount).toBe(2);
	});

	it("succeeds when the LLM wraps JSON in markdown code blocks", async () => {
		const schema = Type.Object({ value: Type.Number() });
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage('```json\n{"value":99}\n```')]);

		const { exitCode, data } = await runStructuredOutputLoop(harness, schema, "give me a number");

		expect(exitCode).toBe(0);
		expect(data).toEqual({ value: 99 });
	});

	it("exhausts all retries and returns an error when every response is invalid", async () => {
		const schema = Type.Object({ result: Type.String() });
		const harness = await createHarness();
		harnesses.push(harness);

		const responses = Array.from({ length: MAX_RETRIES + 1 }, () => fauxAssistantMessage("I cannot produce JSON."));
		harness.setResponses(responses);

		const { exitCode, lastError } = await runStructuredOutputLoop(harness, schema, "produce JSON");

		expect(exitCode).toBe(1);
		expect(lastError).toContain("JSON parse failed");
		expect(harness.faux.state.callCount).toBe(MAX_RETRIES + 1);
	});

	it("succeeds on the final retry attempt", async () => {
		const schema = Type.Object({ ok: Type.Boolean() });
		const harness = await createHarness();
		harnesses.push(harness);

		const badResponses = Array.from({ length: MAX_RETRIES }, () => fauxAssistantMessage("not json"));
		harness.setResponses([...badResponses, fauxAssistantMessage('{"ok":true}')]);

		const { exitCode, data } = await runStructuredOutputLoop(harness, schema, "boolean check");

		expect(exitCode).toBe(0);
		expect(data).toEqual({ ok: true });
		expect(harness.faux.state.callCount).toBe(MAX_RETRIES + 1);
	});

	it("validates nested object schemas end-to-end", async () => {
		const schema = Type.Object({
			user: Type.Object({
				name: Type.String(),
				address: Type.Object({
					city: Type.String(),
					zip: Type.Number(),
				}),
			}),
		});
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage('{"user":{"name":"Bob","address":{"city":"NYC","zip":10001}}}')]);

		const { exitCode, data } = await runStructuredOutputLoop(harness, schema, "user info");

		expect(exitCode).toBe(0);
		expect(data).toEqual({
			user: { name: "Bob", address: { city: "NYC", zip: 10001 } },
		});
	});

	it("includes the schema prompt in the first user message", async () => {
		const schema = Type.Object({ x: Type.Number() });
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage('{"x":1}')]);

		await runStructuredOutputLoop(harness, schema, "compute");

		const userMessages = harness.session.messages.filter((m) => m.role === "user");
		const firstUserText = userMessages[0]
			? (userMessages[0].content as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text)
					.join("")
			: "";

		expect(firstUserText).toContain("compute");
		expect(firstUserText).toContain("You must respond with valid JSON matching this schema");
		expect(firstUserText).toContain('"x"');
	});

	it("includes validation error feedback in retry prompts", async () => {
		const schema = Type.Object({ n: Type.Number() });
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("nope"), fauxAssistantMessage('{"n":1}')]);

		await runStructuredOutputLoop(harness, schema, "number");

		const userMessages = harness.session.messages.filter((m) => m.role === "user");
		const retryText = userMessages[1]
			? (userMessages[1].content as Array<{ type: string; text?: string }>)
					.filter((p) => p.type === "text")
					.map((p) => p.text)
					.join("")
			: "";

		expect(retryText).toContain("Your previous response was invalid");
		expect(retryText).toContain("JSON parse failed");
	});
});
