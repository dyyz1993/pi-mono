import { type Context, fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.js";

describe("callLLMStructured", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("returns parsed JSON object matching schema", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage('{"score": 85, "summary": "Good code"}')]);

		const result = await harness.session.callLLMStructured({
			schema: Type.Object({
				score: Type.Number(),
				summary: Type.String(),
			}),
			messages: [{ role: "user", content: "Analyze this code" }],
		});

		expect(typeof result.score).toBe("number");
		expect(typeof result.summary).toBe("string");
		expect(result.score).toBe(85);
		expect(result.summary).toBe("Good code");
	});

	it("appends schema instructions to system prompt", async () => {
		const capturedContexts: Context[] = [];
		harness = await createHarness();
		harness.setResponses([
			(ctx: Context) => {
				capturedContexts.push(ctx);
				return fauxAssistantMessage('{"label": "positive"}');
			},
		]);

		await harness.session.callLLMStructured({
			schema: Type.Object({ label: Type.String() }),
			systemPrompt: "Always respond with positive sentiment analysis.",
			messages: [{ role: "user", content: "Analyze: great day" }],
		});

		expect(capturedContexts.length).toBe(1);
		const sys = capturedContexts[0]!.systemPrompt ?? "";
		expect(sys).toContain("positive sentiment");
		expect(sys).toContain("Respond with valid JSON matching this schema:");
		expect(sys).toContain("Respond with JSON only, no markdown.");
	});

	it("handles multi-message conversation", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage('{"answer": "yes"}')]);

		const result = await harness.session.callLLMStructured({
			schema: Type.Object({ answer: Type.String() }),
			messages: [
				{ role: "user", content: "First question" },
				{ role: "assistant", content: "First answer" },
				{ role: "user", content: "Follow up question" },
			],
		});

		expect(result).toBeDefined();
		expect(result.answer).toBe("yes");
	});

	it("respects maxTokens option", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage('{"x": 1}')]);

		const result = await harness.session.callLLMStructured({
			schema: Type.Object({ x: Type.Number() }),
			messages: [{ role: "user", content: "test" }],
			maxTokens: 100,
		});

		expect(result).toBeDefined();
		expect(result.x).toBe(1);
	});

	it("retries on invalid JSON response when maxRetries is set", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("not json at all"), fauxAssistantMessage('{"valid": true}')]);

		const result = await harness.session.callLLMStructured({
			schema: Type.Object({ valid: Type.Boolean() }),
			messages: [{ role: "user", content: "test" }],
			maxRetries: 2,
		});

		expect(result).toBeDefined();
		expect(result.valid).toBe(true);
		expect(harness.faux.state.callCount).toBeGreaterThanOrEqual(2);
	});

	it("throws on invalid JSON with no retries", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("not json")]);

		await expect(
			harness.session.callLLMStructured({
				schema: Type.Object({ x: Type.Number() }),
				messages: [{ role: "user", content: "test" }],
			}),
		).rejects.toThrow("JSON parse failed");
	});

	it("throws CallLLMStructuredError with raw and reason on json_parse failure", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("not json")]);

		try {
			await harness.session.callLLMStructured({
				schema: Type.Object({ x: Type.Number() }),
				messages: [{ role: "user", content: "test" }],
			});
			expect.unreachable("Should have thrown");
		} catch (e: unknown) {
			const err = e as { raw: string; reason: string; message: string };
			expect(err.raw).toBe("not json");
			expect(err.reason).toBe("json_parse");
			expect(err.message).toContain("JSON parse failed");
		}
	});

	it("retries on schema validation failure", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage('{"score": "not a number"}'), fauxAssistantMessage('{"score": 42}')]);

		const result = await harness.session.callLLMStructured({
			schema: Type.Object({ score: Type.Number() }),
			messages: [{ role: "user", content: "test" }],
			maxRetries: 1,
		});

		expect(result).toBeDefined();
		expect(result.score).toBe(42);
		expect(harness.faux.state.callCount).toBe(2);
	});

	it("throws CallLLMStructuredError with reason schema_validation when retries exhausted", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage('{"wrong_field": true}')]);

		try {
			await harness.session.callLLMStructured({
				schema: Type.Object({ required_field: Type.String() }),
				messages: [{ role: "user", content: "test" }],
				maxRetries: 0,
			});
			expect.unreachable("Should have thrown");
		} catch (e: unknown) {
			const err = e as { raw: string; reason: string; message: string };
			expect(err.reason).toBe("schema_validation");
			expect(err.raw).toBe('{"wrong_field": true}');
			expect(err.message).toContain("Schema validation failed");
		}
	});

	it("strips markdown code block wrapper from response", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage('```json\n{"value": 123}\n```')]);

		const result = await harness.session.callLLMStructured({
			schema: Type.Object({ value: Type.Number() }),
			messages: [{ role: "user", content: "test" }],
		});

		expect(result).toBeDefined();
		expect(result.value).toBe(123);
	});

	it("strips markdown code block without language hint", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage('```\n{"value": 456}\n```')]);

		const result = await harness.session.callLLMStructured({
			schema: Type.Object({ value: Type.Number() }),
			messages: [{ role: "user", content: "test" }],
		});

		expect(result).toBeDefined();
		expect(result.value).toBe(456);
	});

	it("respects abort signal", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage('{"x": 1}')]);
		const controller = new AbortController();
		controller.abort();

		await expect(
			harness.session.callLLMStructured({
				schema: Type.Object({ x: Type.Number() }),
				messages: [{ role: "user", content: "test" }],
				signal: controller.signal,
			}),
		).rejects.toThrow();
	});

	it("uses empty system prompt when none provided", async () => {
		const capturedContexts: Context[] = [];
		harness = await createHarness();
		harness.setResponses([
			(ctx: Context) => {
				capturedContexts.push(ctx);
				return fauxAssistantMessage('{"ok": true}');
			},
		]);

		const result = await harness.session.callLLMStructured({
			schema: Type.Object({ ok: Type.Boolean() }),
			messages: [{ role: "user", content: "test" }],
		});

		expect(result.ok).toBe(true);
		expect(capturedContexts[0]!.systemPrompt).not.toContain("undefined");
	});

	it("includes retry context in follow-up messages", async () => {
		const capturedContexts: Context[] = [];
		harness = await createHarness();
		harness.setResponses([
			(ctx: Context) => {
				capturedContexts.push(ctx);
				return fauxAssistantMessage("bad json");
			},
			(ctx: Context) => {
				capturedContexts.push(ctx);
				return fauxAssistantMessage('{"fixed": "yes"}');
			},
		]);

		await harness.session.callLLMStructured({
			schema: Type.Object({ fixed: Type.String() }),
			messages: [{ role: "user", content: "original" }],
			maxRetries: 1,
		});

		expect(capturedContexts.length).toBe(2);
		const retryMessages = capturedContexts[1]!.messages;
		const lastMsg = retryMessages[retryMessages.length - 1];
		expect(lastMsg?.role).toBe("user");
		const content = lastMsg?.content;
		if (typeof content === "string") {
			expect(content).toContain("Your previous response was invalid");
		} else if (Array.isArray(content)) {
			const text = content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
			expect(text).toContain("Your previous response was invalid");
		}
	});
});
