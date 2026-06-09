import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "@dyyz1993/pi-ai";
import {
	accumulateUsage,
	cleanupTempFiles,
	formatTokens,
	formatUsageStats,
	getDisplayItems,
	getFinalOutput,
	makeUsage,
	writePromptToTempFile,
} from "./utils.ts";

let tempFilePath: string | null = null;
let tempDir: string | null = null;

afterEach(() => {
	cleanupTempFiles(tempFilePath, tempDir);
	tempFilePath = null;
	tempDir = null;
});

describe("formatTokens", () => {
	it("returns exact string for counts under 1000", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(1)).toBe("1");
		expect(formatTokens(500)).toBe("500");
		expect(formatTokens(999)).toBe("999");
	});

	it("returns one-decimal k for 1000-9999", () => {
		expect(formatTokens(1000)).toBe("1.0k");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(9999)).toBe("10.0k");
	});

	it("returns rounded k for 10000-999999", () => {
		expect(formatTokens(10000)).toBe("10k");
		expect(formatTokens(12345)).toBe("12k");
		expect(formatTokens(999999)).toBe("1000k");
	});

	it("returns one-decimal M for 1000000 and above", () => {
		expect(formatTokens(1000000)).toBe("1.0M");
		expect(formatTokens(2500000)).toBe("2.5M");
	});
});

describe("formatUsageStats", () => {
	it("returns empty string when all fields are zero", () => {
		expect(formatUsageStats({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })).toBe("");
	});

	it("formats singular turn", () => {
		const result = formatUsageStats({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 });
		expect(result).toBe("1 turn");
	});

	it("formats plural turns", () => {
		const result = formatUsageStats({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 3 });
		expect(result).toBe("3 turns");
	});

	it("formats partial fields", () => {
		const result = formatUsageStats({ input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0, cost: 0 });
		expect(result).toBe("↑5.0k ↓2.0k");
	});

	it("appends model when provided", () => {
		const result = formatUsageStats({ input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, "gpt-4");
		expect(result).toContain("gpt-4");
	});

	it("formats all fields populated", () => {
		const result = formatUsageStats({
			input: 5000,
			output: 3000,
			cacheRead: 1000,
			cacheWrite: 500,
			cost: 0.1234,
			contextTokens: 8000,
			turns: 2,
		}, "claude-3");
		expect(result).toBe("2 turns ↑5.0k ↓3.0k R1.0k W500 $0.1234 ctx:8.0k claude-3");
	});

	it("omits contextTokens when zero", () => {
		const result = formatUsageStats({ input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 });
		expect(result).not.toContain("ctx:");
	});
});

describe("getFinalOutput", () => {
	it("returns empty string for empty array", () => {
		expect(getFinalOutput([])).toBe("");
	});

	it("returns empty string when no assistant messages", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello", timestamp: 0 },
			{ role: "toolResult", toolCallId: "1", toolName: "bash", content: [{ type: "text", text: "done" }], isError: false, timestamp: 0 },
		];
		expect(getFinalOutput(messages)).toBe("");
	});

	it("returns text from last assistant message", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [{ type: "text", text: "first" }],
				api: "anthropic",
				provider: "anthropic",
				model: "claude-3",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 0,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "last" }],
				api: "anthropic",
				provider: "anthropic",
				model: "claude-3",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 0,
			},
		];
		expect(getFinalOutput(messages)).toBe("last");
	});

	it("returns empty string when assistant has no text content", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [{ type: "thinking", thinking: "hmm" }],
				api: "anthropic",
				provider: "anthropic",
				model: "claude-3",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 0,
			},
		];
		expect(getFinalOutput(messages)).toBe("");
	});
});

describe("getDisplayItems", () => {
	it("returns empty array for empty messages", () => {
		expect(getDisplayItems([])).toEqual([]);
	});

	it("skips non-assistant messages", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello", timestamp: 0 },
			{ role: "toolResult", toolCallId: "1", toolName: "bash", content: [{ type: "text", text: "done" }], isError: false, timestamp: 0 },
		];
		expect(getDisplayItems(messages)).toEqual([]);
	});

	it("extracts text and toolCall from assistant messages", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "doing work" },
					{ type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" } },
				],
				api: "anthropic",
				provider: "anthropic",
				model: "claude-3",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "toolUse",
				timestamp: 0,
			},
		];
		const items = getDisplayItems(messages);
		expect(items).toEqual([
			{ type: "text", text: "doing work" },
			{ type: "toolCall", name: "bash", args: { command: "ls" } },
		]);
	});

	it("collects items from multiple assistant messages", () => {
		const makeAssistant = (text: string): Message => ({
			role: "assistant",
			content: [{ type: "text", text }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-3",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: 0,
		});
		const messages: Message[] = [makeAssistant("first"), makeAssistant("second")];
		const items = getDisplayItems(messages);
		expect(items).toEqual([
			{ type: "text", text: "first" },
			{ type: "text", text: "second" },
		]);
	});
});

describe("makeUsage", () => {
	it("returns zero-valued UsageStats", () => {
		const usage = makeUsage();
		expect(usage).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		});
	});
});

describe("accumulateUsage", () => {
	it("skips non-assistant messages", () => {
		const result = { usage: makeUsage() };
		accumulateUsage(result, { role: "user", content: "hi", timestamp: 0 });
		expect(result.usage.turns).toBe(0);
	});

	it("increments turns for each assistant message", () => {
		const result = { usage: makeUsage() };
		const msg: Message = {
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-3",
			usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
			stopReason: "stop",
			timestamp: 0,
		};
		accumulateUsage(result, msg);
		accumulateUsage(result, msg);
		expect(result.usage.turns).toBe(2);
	});

	it("accumulates usage fields from assistant messages", () => {
		const result = { usage: makeUsage() };
		const msg: Message = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-3",
			usage: { input: 200, output: 100, cacheRead: 50, cacheWrite: 25, totalTokens: 375, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } },
			stopReason: "stop",
			timestamp: 0,
		};
		accumulateUsage(result, msg);
		expect(result.usage.input).toBe(200);
		expect(result.usage.output).toBe(100);
		expect(result.usage.cacheRead).toBe(50);
		expect(result.usage.cacheWrite).toBe(25);
		expect(result.usage.cost).toBe(0.03);
		expect(result.usage.contextTokens).toBe(375);
	});

	it("sets model from first assistant message only", () => {
		const result = { usage: makeUsage() };
		const msg1: Message = {
			role: "assistant",
			content: [{ type: "text", text: "a" }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-3",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: 0,
		};
		const msg2: Message = {
			role: "assistant",
			content: [{ type: "text", text: "b" }],
			api: "openai",
			provider: "openai",
			model: "gpt-4",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: 0,
		};
		accumulateUsage(result, msg1);
		accumulateUsage(result, msg2);
		expect(result.model).toBe("claude-3");
	});

	it("sets stopReason from message", () => {
		const result = { usage: makeUsage() };
		const msg: Message = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-3",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "length",
			timestamp: 0,
		};
		accumulateUsage(result, msg);
		expect(result.stopReason).toBe("length");
	});

	it("sets errorMessage from message", () => {
		const result = { usage: makeUsage() };
		const msg: Message = {
			role: "assistant",
			content: [{ type: "text", text: "" }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-3",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "error",
			errorMessage: "rate limited",
			timestamp: 0,
		};
		accumulateUsage(result, msg);
		expect(result.errorMessage).toBe("rate limited");
	});

	it("handles assistant message without usage", () => {
		const result = { usage: makeUsage() };
		const msg = {
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "ok" }],
			api: "anthropic" as const,
			provider: "anthropic" as const,
			model: "claude-3",
			stopReason: "stop" as const,
			timestamp: 0,
		};
		accumulateUsage(result, msg as Message);
		expect(result.usage.turns).toBe(1);
		expect(result.usage.input).toBe(0);
	});
});

describe("writePromptToTempFile", () => {
	it("creates file with correct content", async () => {
		const { dir, filePath } = await writePromptToTempFile("test-agent", "hello world");
		tempDir = dir;
		tempFilePath = filePath;

		const content = fs.readFileSync(filePath, "utf-8");
		expect(content).toBe("hello world");
		expect(filePath).toMatch(/prompt-test-agent\.md$/);
	});

	it("sanitizes agent name with special characters", async () => {
		const { dir, filePath } = await writePromptToTempFile("my agent/v2", "content");
		tempDir = dir;
		tempFilePath = filePath;

		expect(filePath).toMatch(/prompt-my_agent_v2\.md$/);
	});

	it("uses custom tmp prefix", async () => {
		const { dir, filePath } = await writePromptToTempFile("x", "y", "pi-test-prefix-");
		tempDir = dir;
		tempFilePath = filePath;

		expect(dir).toMatch(/pi-test-prefix-/);
	});
});

describe("cleanupTempFiles", () => {
	it("removes file and dir", async () => {
		const { dir, filePath } = await writePromptToTempFile("cleanup-test", "data");
		expect(fs.existsSync(filePath)).toBe(true);

		cleanupTempFiles(filePath, dir);
		expect(fs.existsSync(filePath)).toBe(false);
		expect(fs.existsSync(dir)).toBe(false);
	});

	it("handles null arguments gracefully", () => {
		expect(() => cleanupTempFiles(null, null)).not.toThrow();
	});

	it("handles nonexistent paths without throwing", () => {
		expect(() => cleanupTempFiles("/tmp/no-such-file-utils-test", "/tmp/no-such-dir-utils-test")).not.toThrow();
	});
});
