import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { ToolResultMessage } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import { convertToLlm } from "../src/core/messages.ts";

function toolResultMessage(input: { text: string; isError: boolean }): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "tool-call-1",
		toolName: "bash",
		content: [{ type: "text", text: input.text }],
		isError: input.isError,
		timestamp: Date.now(),
	};
}

describe("convertToLlm tool result handling", () => {
	it("truncates long failed tool results before sending them to the LLM", () => {
		const longError = Array.from({ length: 180 }, (_, index) => `stderr line ${index + 1}: ${"x".repeat(80)}`).join(
			"\n",
		);
		const message = toolResultMessage({ text: longError, isError: true });

		const [converted] = convertToLlm([message as AgentMessage]);

		expect(converted?.role).toBe("toolResult");
		if (converted?.role !== "toolResult") throw new Error("expected tool result");
		const convertedText = converted.content[0]?.type === "text" ? converted.content[0].text : "";
		expect(convertedText.length).toBeLessThan(longError.length);
		expect(convertedText).toContain("stderr line 1");
		expect(convertedText).toContain("stderr line 180");
		expect(convertedText).toContain("tool error output truncated");
		expect(message.content[0]?.type === "text" ? message.content[0].text : "").toBe(longError);
	});

	it("keeps successful tool results unchanged", () => {
		const output = `${"ok\n".repeat(200)}done`;
		const message = toolResultMessage({ text: output, isError: false });

		const [converted] = convertToLlm([message as AgentMessage]);

		expect(converted).toBe(message);
	});
});
