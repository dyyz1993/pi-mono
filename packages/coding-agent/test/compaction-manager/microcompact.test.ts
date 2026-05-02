import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { ToolResultMessage } from "@dyyz1993/pi-ai";
import { describe, expect, it } from "vitest";
import { microcompactMessages } from "../../extensions/compaction-manager/microcompact.js";

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
