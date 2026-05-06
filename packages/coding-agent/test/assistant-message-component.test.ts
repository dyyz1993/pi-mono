import type { AssistantMessage } from "@dyyz1993/pi-ai";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function makeMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "Hello world" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

describe("AssistantMessageComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders text-only messages", () => {
		const msg = makeMessage({ content: [{ type: "text", text: "Simple response" }] });
		const comp = new AssistantMessageComponent(msg);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Simple response");
	});

	test("shows thinking blocks when not hidden", () => {
		const msg = makeMessage({
			content: [
				{ type: "thinking", thinking: "Let me think about this" },
				{ type: "text", text: "Here is my answer" },
			],
		});
		const comp = new AssistantMessageComponent(msg, false);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Let me think about this");
		expect(rendered).toContain("Here is my answer");
	});

	test("hides thinking blocks when setHideThinkingBlock is true", () => {
		const msg = makeMessage({
			content: [
				{ type: "thinking", thinking: "Secret reasoning" },
				{ type: "text", text: "Final answer" },
			],
		});
		const comp = new AssistantMessageComponent(msg, true);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).not.toContain("Secret reasoning");
		expect(rendered).toContain("Thinking...");
		expect(rendered).toContain("Final answer");
	});

	test("renders abort message when stopReason is aborted", () => {
		const msg = makeMessage({
			content: [{ type: "text", text: "Partial" }],
			stopReason: "aborted",
		});
		const comp = new AssistantMessageComponent(msg);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Partial");
		expect(rendered).toContain("Operation aborted");
	});

	test("renders custom abort message when errorMessage differs from default", () => {
		const msg = makeMessage({
			content: [{ type: "text", text: "Partial" }],
			stopReason: "aborted",
			errorMessage: "Custom abort reason",
		});
		const comp = new AssistantMessageComponent(msg);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Custom abort reason");
		expect(rendered).not.toContain("Operation aborted");
	});

	test("renders error message when stopReason is error", () => {
		const msg = makeMessage({
			content: [{ type: "text", text: "Partial" }],
			stopReason: "error",
			errorMessage: "Rate limited",
		});
		const comp = new AssistantMessageComponent(msg);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Error: Rate limited");
	});

	test("renders error with default message when errorMessage is missing", () => {
		const msg = makeMessage({
			content: [{ type: "text", text: "Partial" }],
			stopReason: "error",
		});
		const comp = new AssistantMessageComponent(msg);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Error: Unknown error");
	});

	test("renders mixed text and thinking content", () => {
		const msg = makeMessage({
			content: [
				{ type: "thinking", thinking: "Step 1" },
				{ type: "text", text: "Answer part 1" },
				{ type: "thinking", thinking: "Step 2" },
				{ type: "text", text: "Answer part 2" },
			],
		});
		const comp = new AssistantMessageComponent(msg, false);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Step 1");
		expect(rendered).toContain("Answer part 1");
		expect(rendered).toContain("Step 2");
		expect(rendered).toContain("Answer part 2");
	});

	test("does not render abort or error when tool calls are present", () => {
		const msg = makeMessage({
			content: [
				{ type: "text", text: "Partial" },
				{ type: "toolCall", id: "tc1", name: "read", arguments: {} },
			],
			stopReason: "aborted",
		});
		const comp = new AssistantMessageComponent(msg);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Partial");
		expect(rendered).not.toContain("Operation aborted");
	});

	test("does not render empty text blocks", () => {
		const msg = makeMessage({
			content: [
				{ type: "text", text: "   " },
				{ type: "text", text: "Visible" },
			],
		});
		const comp = new AssistantMessageComponent(msg);
		const rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Visible");
	});

	test("updates content when setHideThinkingBlock is toggled", () => {
		const msg = makeMessage({
			content: [
				{ type: "thinking", thinking: "Hidden thought" },
				{ type: "text", text: "Answer" },
			],
		});
		const comp = new AssistantMessageComponent(msg, true);
		let rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).not.toContain("Hidden thought");

		comp.setHideThinkingBlock(false);
		rendered = stripAnsi(comp.render(80).join("\n"));
		expect(rendered).toContain("Hidden thought");
	});
});
