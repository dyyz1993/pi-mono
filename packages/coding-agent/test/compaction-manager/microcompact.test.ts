import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { ToolResultMessage } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import { microcompactMessages, stripThinkingBlocks } from "../../extensions/compaction-manager/microcompact.js";

function makeToolResult(toolName: string, text: string, ageMs: number): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: `call-${Math.random()}`,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now() - ageMs,
	};
}

describe("microcompactMessages", () => {
	const clearableTools = ["read", "bash", "grep", "find", "glob"];
	const maxAgeMs = 60 * 60 * 1000;

	it("clears old tool results for clearable tools", () => {
		const messages: AgentMessage[] = [
			makeToolResult("read", "file content here...", maxAgeMs + 1000),
			makeToolResult("bash", "command output...", maxAgeMs + 5000),
		];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeDefined();
		expect(result!.messages).toHaveLength(2);
		const content = (result!.messages[0] as ToolResultMessage).content;
		expect(content[0]).toEqual({ type: "text", text: expect.stringContaining("Old read result cleared") });
	});

	it("does NOT clear recent tool results", () => {
		const messages: AgentMessage[] = [makeToolResult("read", "recent content", 1000)];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeUndefined();
	});

	it("does NOT clear non-clearable tool results even if old", () => {
		const messages: AgentMessage[] = [makeToolResult("edit", "edit result...", maxAgeMs + 10000)];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeUndefined();
	});

	it("returns undefined for empty messages array", () => {
		const result = microcompactMessages([], clearableTools, maxAgeMs);
		expect(result).toBeUndefined();
	});

	it("returns undefined when no tool results present", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "hello" } as AgentMessage,
			{ role: "assistant", content: [{ type: "text", text: "hi" }] } as AgentMessage,
		];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeUndefined();
	});

	it("clears tool result exactly at maxAgeMs boundary", () => {
		const messages: AgentMessage[] = [makeToolResult("read", "boundary content", maxAgeMs)];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeDefined();
		expect((result!.messages[0] as ToolResultMessage).content[0]).toEqual(
			expect.objectContaining({ type: "text", text: expect.stringContaining("cleared") }),
		);
	});

	it("clears tool result just past maxAgeMs boundary", () => {
		const messages: AgentMessage[] = [makeToolResult("read", "just past", maxAgeMs + 1)];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeDefined();
		expect((result!.messages[0] as ToolResultMessage).content[0]).toEqual(
			expect.objectContaining({ type: "text", text: expect.stringContaining("cleared") }),
		);
	});

	it("does NOT clear error tool results even if old and clearable", () => {
		const messages: AgentMessage[] = [
			{
				role: "toolResult",
				toolCallId: "call-err",
				toolName: "bash",
				content: [{ type: "text", text: "command failed with exit code 1" }],
				isError: true,
				timestamp: Date.now() - (maxAgeMs + 10000),
			} as ToolResultMessage,
		];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeUndefined();
	});

	it("clears all when all messages are old clearable tool results", () => {
		const messages: AgentMessage[] = [
			makeToolResult("read", "old-1", maxAgeMs + 1000),
			makeToolResult("bash", "old-2", maxAgeMs + 2000),
			makeToolResult("grep", "old-3", maxAgeMs + 3000),
		];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeDefined();
		for (const msg of result!.messages) {
			const content = (msg as ToolResultMessage).content[0];
			expect(content).toEqual(expect.objectContaining({ type: "text", text: expect.stringContaining("cleared") }));
		}
	});

	it("only clears old clearable ones in mixed messages", () => {
		const messages: AgentMessage[] = [
			makeToolResult("read", "old content", maxAgeMs + 1000),
			makeToolResult("read", "new content", 1000),
			makeToolResult("edit", "edit result", maxAgeMs + 1000),
		];

		const result = microcompactMessages(messages, clearableTools, maxAgeMs);
		expect(result).toBeDefined();
		expect((result!.messages[0] as ToolResultMessage).content[0]).toEqual(
			expect.objectContaining({ type: "text", text: expect.stringContaining("cleared") }),
		);
		expect((result!.messages[1] as ToolResultMessage).content).toEqual((messages[1] as ToolResultMessage).content);
		expect((result!.messages[2] as ToolResultMessage).content).toEqual((messages[2] as ToolResultMessage).content);
	});
});

describe("stripThinkingBlocks", () => {
	it("returns undefined for empty array", () => {
		expect(stripThinkingBlocks([])).toBeUndefined();
	});

	it("returns undefined for messages without thinking blocks", () => {
		const messages: AgentMessage[] = [
			{ role: "assistant", content: [{ type: "text", text: "hello" }] } as AgentMessage,
		];
		expect(stripThinkingBlocks(messages)).toBeUndefined();
	});

	it("returns undefined for non-assistant messages", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "hello" } as AgentMessage,
			{
				role: "toolResult",
				toolCallId: "c1",
				toolName: "bash",
				content: [{ type: "text", text: "ok" }],
				isError: false,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		expect(stripThinkingBlocks(messages)).toBeUndefined();
	});

	it("returns undefined for assistant messages with non-array content (string content)", () => {
		const messages: AgentMessage[] = [{ role: "assistant", content: "just a string" } as unknown as AgentMessage];
		expect(stripThinkingBlocks(messages)).toBeUndefined();
	});

	it("strips thinking blocks from a single assistant message, keeps text blocks", () => {
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", text: "let me think..." },
					{ type: "text", text: "here is the answer" },
				],
			} as AgentMessage,
		];

		const result = stripThinkingBlocks(messages);
		expect(result).toBeDefined();
		expect(result!.messages).toHaveLength(1);
		expect((result!.messages[0] as { content: { type: string; text: string }[] }).content).toEqual([
			{ type: "text", text: "here is the answer" },
		]);
	});

	it("strips thinking blocks from multiple assistant messages", () => {
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", text: "thinking 1" },
					{ type: "text", text: "answer 1" },
				],
			} as AgentMessage,
			{
				role: "assistant",
				content: [
					{ type: "thinking", text: "thinking 2" },
					{ type: "text", text: "answer 2" },
				],
			} as AgentMessage,
		];

		const result = stripThinkingBlocks(messages);
		expect(result).toBeDefined();
		expect(result!.messages).toHaveLength(2);
		for (const msg of result!.messages) {
			const content = (msg as { content: { type: string }[] }).content;
			expect(content).toHaveLength(1);
			expect(content[0].type).toBe("text");
		}
	});

	it("only modifies assistant messages, leaves user/toolResult messages untouched", () => {
		const toolResult: AgentMessage = {
			role: "toolResult",
			toolCallId: "c1",
			toolName: "bash",
			content: [{ type: "text", text: "output" }],
			isError: false,
			timestamp: Date.now(),
		} as AgentMessage;

		const messages: AgentMessage[] = [
			{ role: "user", content: "question" } as AgentMessage,
			{
				role: "assistant",
				content: [
					{ type: "thinking", text: "hmm" },
					{ type: "text", text: "response" },
				],
			} as AgentMessage,
			toolResult,
		];

		const result = stripThinkingBlocks(messages);
		expect(result).toBeDefined();
		expect(result!.messages[0]).toEqual(messages[0]);
		expect(result!.messages[2]).toEqual(toolResult);
		expect((result!.messages[1] as { content: { type: string }[] }).content).toEqual([
			{ type: "text", text: "response" },
		]);
	});

	it("strips only thinking blocks, keeps toolCall and text blocks", () => {
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", text: "planning..." },
					{ type: "text", text: "I will do X" },
					{ type: "tool_call", id: "tc1", name: "bash", arguments: "{}" },
				],
			} as unknown as AgentMessage,
		];

		const result = stripThinkingBlocks(messages);
		expect(result).toBeDefined();
		const content = (result!.messages[0] as { content: { type: string }[] }).content;
		expect(content).toHaveLength(2);
		expect(content.map((b: { type: string }) => b.type)).toEqual(["text", "tool_call"]);
	});

	it("handles assistant message with ONLY thinking blocks (content becomes empty array)", () => {
		const messages: AgentMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", text: "only thinking" },
					{ type: "thinking", text: "more thinking" },
				],
			} as AgentMessage,
		];

		const result = stripThinkingBlocks(messages);
		expect(result).toBeDefined();
		expect((result!.messages[0] as { content: unknown[] }).content).toEqual([]);
	});
});
