/**
 * Ask-tools harness tests.
 *
 * Uses the suite harness + faux provider to test ask-tools extension logic.
 * In harness mode (no TUI), ctx.ui uses noOpUIContext defaults:
 *   - confirm() → false
 *   - select() → undefined
 *   - input() → undefined
 *   - editor() → undefined
 *   - notify() → no-op
 */
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { createHarness, type Harness } from "./harness.js";
import askToolsExtension from "../../extensions/ask-tools/index.js";

let harness: Harness;

afterEach(() => {
	harness?.cleanup();
});

function getLastToolResult(h: Harness): { toolName: string; resultText: string } | undefined {
	const ends = h.eventsOfType("tool_execution_end");
	if (ends.length === 0) return undefined;
	const last = ends[ends.length - 1];
	const text = (last as any).result?.content?.[0]?.text ?? "";
	return { toolName: (last as any).toolName, resultText: text };
}

describe("ask-tools extension", () => {
	it("registers all 5 tools", async () => {
		harness = await createHarness({
			extensionFactories: [askToolsExtension],
		});

		const tools = harness.session.getActiveToolNames();
		expect(tools).toContain("ask-confirm");
		expect(tools).toContain("ask-select");
		expect(tools).toContain("ask-input");
		expect(tools).toContain("ask-editor");
		expect(tools).toContain("ask-notify");
	});

	it("ask-confirm returns 'no' with noOp UI", async () => {
		harness = await createHarness({
			extensionFactories: [askToolsExtension],
		});

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ask-confirm", { title: "Proceed?", question: "Continue?" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("test");

		const result = getLastToolResult(harness);
		expect(result).toBeDefined();
		expect(result!.toolName).toBe("ask-confirm");
		expect(result!.resultText).toBe("User confirmed: no");
	});

	it("ask-select returns '(cancelled)' with noOp UI", async () => {
		harness = await createHarness({
			extensionFactories: [askToolsExtension],
		});

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ask-select", { title: "Pick color", options: ["red", "green", "blue"] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("test");

		const result = getLastToolResult(harness);
		expect(result).toBeDefined();
		expect(result!.toolName).toBe("ask-select");
		expect(result!.resultText).toBe("User selected: (cancelled)");
	});

	it("ask-select multiple=true returns '(none)' with noOp UI", async () => {
		harness = await createHarness({
			extensionFactories: [askToolsExtension],
		});

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ask-select", { title: "Pick colors", options: ["red", "green"], multiple: true })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("test");

		const result = getLastToolResult(harness);
		expect(result).toBeDefined();
		expect(result!.toolName).toBe("ask-select");
		expect(result!.resultText).toBe("User selected: (none)");
	});

	it("ask-input returns '(empty)' with noOp UI", async () => {
		harness = await createHarness({
			extensionFactories: [askToolsExtension],
		});

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ask-input", { title: "Your name" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("test");

		const result = getLastToolResult(harness);
		expect(result).toBeDefined();
		expect(result!.toolName).toBe("ask-input");
		expect(result!.resultText).toBe("User input: (empty)");
	});

	it("ask-editor returns '(cancelled)' with noOp UI", async () => {
		harness = await createHarness({
			extensionFactories: [askToolsExtension],
		});

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ask-editor", { title: "Edit text" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("test");

		const result = getLastToolResult(harness);
		expect(result).toBeDefined();
		expect(result!.toolName).toBe("ask-editor");
		expect(result!.resultText).toBe("(cancelled)");
	});

	it("ask-notify returns 'Notified user'", async () => {
		harness = await createHarness({
			extensionFactories: [askToolsExtension],
		});

		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("ask-notify", { message: "Hello!", type: "info" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("test");

		const result = getLastToolResult(harness);
		expect(result).toBeDefined();
		expect(result!.toolName).toBe("ask-notify");
		expect(result!.resultText).toBe("Notified user");
	});
});
