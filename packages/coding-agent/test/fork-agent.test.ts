import { type AssistantMessage, fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.js";

describe("forkAgent", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	it("returns ForkAgentResult with text and usage", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("fork result text")]);

		const result = await harness.session.forkAgent("do something");

		expect(result.text).toBe("fork result text");
		expect(result.usage).toBeDefined();
		expect(typeof result.usage.input).toBe("number");
		expect(typeof result.usage.output).toBe("number");
		expect(typeof result.usage.cost).toBe("number");
	});

	it("uses custom systemPrompt when provided", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("custom response")]);

		const result = await harness.session.forkAgent("analyze", {
			systemPrompt: "You are a code reviewer.",
		});

		expect(result.text).toBe("custom response");
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("inherits parent system prompt when inheritSystemPrompt is true", async () => {
		harness = await createHarness({ systemPrompt: "Parent system prompt content" });
		harness.setResponses([fauxAssistantMessage("inherited response")]);

		const result = await harness.session.forkAgent("task", {
			inheritSystemPrompt: true,
		});

		expect(result.text).toBe("inherited response");
	});

	it("prefers inheritSystemPrompt over custom systemPrompt when both provided", async () => {
		harness = await createHarness({ systemPrompt: "Parent prompt" });
		harness.setResponses([fauxAssistantMessage("inherited wins")]);

		await harness.session.forkAgent("task", {
			systemPrompt: "Custom prompt",
			inheritSystemPrompt: true,
		});

		expect(harness.faux.state.callCount).toBe(1);
	});

	it("uses empty system prompt when neither systemPrompt nor inheritSystemPrompt", async () => {
		harness = await createHarness({ systemPrompt: "Parent prompt" });
		harness.setResponses([fauxAssistantMessage("no prompt")]);

		const result = await harness.session.forkAgent("task");

		expect(result.text).toBe("no prompt");
	});

	it("starts with empty messages when shareContext is false", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("parent reply"), fauxAssistantMessage("fork reply")]);

		await harness.session.prompt("parent message");
		const result = await harness.session.forkAgent("fork task", {
			shareContext: false,
		});

		expect(result.text).toBe("fork reply");
	});

	it("inherits parent messages when shareContext is true", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("parent reply"), fauxAssistantMessage("fork reply")]);

		await harness.session.prompt("parent message");
		const result = await harness.session.forkAgent("follow up", {
			shareContext: true,
		});

		expect(result.text).toBe("fork reply");
	});

	it("uses safe default tools when no tools specified", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("safe tools response")]);

		const result = await harness.session.forkAgent("list files");

		expect(result.text).toBe("safe tools response");
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("uses specified tools when provided", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("tool response")]);

		const result = await harness.session.forkAgent("read and search", {
			tools: ["read", "grep"],
		});

		expect(result.text).toBe("tool response");
	});

	it("removes bash from tools when bash is set to deny", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("no bash response")]);

		const result = await harness.session.forkAgent("task", {
			tools: ["read", "bash", "grep"],
			bash: "deny",
		});

		expect(result.text).toBe("no bash response");
	});

	it("respects maxTurns limit", async () => {
		harness = await createHarness();
		harness.setResponses([
			fauxAssistantMessage("turn1"),
			fauxAssistantMessage("turn2"),
			fauxAssistantMessage("turn3"),
		]);

		const result = await harness.session.forkAgent("task", {
			maxTurns: 1,
		});

		expect(result.text).toBeDefined();
	});

	it("does not add messages to parent session", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("parent reply"), fauxAssistantMessage("fork reply")]);

		await harness.session.prompt("parent message");
		const parentMsgCount = harness.session.messages.length;

		await harness.session.forkAgent("fork task");

		expect(harness.session.messages.length).toBe(parentMsgCount);
	});

	it("respects abort signal", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("response")]);

		const controller = new AbortController();
		controller.abort();

		await expect(harness.session.forkAgent("task", { signal: controller.signal })).rejects.toThrow("Aborted");
	});

	it("uses default maxTurns of 5 when not specified", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("response")]);

		const result = await harness.session.forkAgent("task");

		expect(result.text).toBe("response");
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("captures usage from assistant response", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("usage test")]);

		const result = await harness.session.forkAgent("task");

		expect(result.text).toBe("usage test");
		expect(result.usage.input).toBeGreaterThan(0);
		expect(result.usage.output).toBeGreaterThan(0);
	});

	it("calculates cost from model pricing and usage", async () => {
		harness = await createHarness({
			models: [
				{
					id: "costly-model",
					name: "Costly Model",
					cost: { input: 10, output: 30, cacheRead: 1, cacheWrite: 2 },
				},
			],
		});
		harness.setResponses([fauxAssistantMessage("costly")]);

		const result = await harness.session.forkAgent("task");

		expect(result.text).toBe("costly");
		expect(result.usage.cost).toBeGreaterThan(0);
	});

	it("defaults to 5 maxTurns when not specified", async () => {
		const responses = Array.from({ length: 10 }, (_, i) => fauxAssistantMessage(`turn${i + 1}`));
		harness = await createHarness();
		harness.setResponses(responses);

		const result = await harness.session.forkAgent("task");

		expect(result.text).toBeDefined();
	});
});
