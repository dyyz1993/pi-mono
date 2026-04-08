/**
 * Tests for Context Compression Extension
 *
 * These tests verify the extension's behavior when integrated with the
 * compressContext pipeline. They mock the compressContext function to
 * test the extension logic independently.
 *
 * NOTE: Vitest mock hoisting requires manual mock management.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { ExtensionAPI, AgentMessage, ToolResultMessage } from "@mariozechner/pi-coding-agent";

// Create mock function that will be hoisted
const mockCompressContext = vi.fn();

// Mock the compressContext function from the actual import path used by the extension
vi.mock("../src/core/context-compression/index.js", () => ({
	compressContext: (...args: unknown[]) => mockCompressContext(...args),
}));

// Also mock the types import
vi.mock("../src/core/context-compression/types.js", () => ({
	DEFAULT_COMPRESSION_PIPELINE_CONFIG: {
		protectedMessageCount: 6,
		protectedContentAge: 20,
		maxProtectedPerStep: 3,
	},
	STRATEGY_LABELS: {
		protected: "保留",
		persist: "持久化",
		summary: "摘要",
		persistShort: "持久化短",
		drop: "清理",
	},
}));

// Import after mocking - extension is in .pi/extensions/
import contextCompressionExtension from "../../.pi/extensions/context-compression.js";

// Helper functions
function createUserMsg(content: string): AgentMessage {
	return { role: "user", content };
}

function createAssistantMsg(content: string): AgentMessage {
	return { role: "assistant", content };
}

function createToolResult(toolName: string, content: string): ToolResultMessage {
	return {
		role: "tool",
		name: toolName,
		content,
		tool_call_id: `call_${toolName}_${Date.now()}`,
	};
}

function createLargeContent(kb: number): string {
	const base = "This is a test line for compression. It has some content.\n";
	const targetSize = kb * 1024;
	let result = "";
	while (result.length < targetSize) {
		result += base;
	}
	return result.substring(0, targetSize);
}

describe("Context Compression Extension", () => {
	let mockPI: ExtensionAPI;
	let eventHandlers: Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>;
	let mockSetStatus: Mock;
	let mockNotify: Mock;

	beforeEach(() => {
		vi.clearAllMocks();
		eventHandlers = new Map();
		mockSetStatus = vi.fn();
		mockNotify = vi.fn();

		mockPI = {
			on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
				eventHandlers.set(event, handler);
			}),
			ui: {
				setStatus: mockSetStatus,
				notify: mockNotify,
			},
		} as unknown as ExtensionAPI;

		// Initialize the extension
		contextCompressionExtension(mockPI);
	});

	// -----------------------------------------------------------------------
	// Event Registration Tests
	// -----------------------------------------------------------------------

	it("should register handlers for context, agent_start, and session_shutdown events", () => {
		expect(eventHandlers.has("context")).toBe(true);
		expect(eventHandlers.has("agent_start")).toBe(true);
		expect(eventHandlers.has("session_shutdown")).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Context Compression Logic Tests
	// -----------------------------------------------------------------------

	describe("context event handler", () => {
		it("should not compress when there are fewer than 3 messages", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const messages: AgentMessage[] = [createUserMsg("hello"), createAssistantMsg("hi")];

			const event = { messages };
			const ctx = { ui: mockPI.ui };

			const result = await handler!(event, ctx);

			expect(result).toBeUndefined();
			expect(mockCompressContext).not.toHaveBeenCalled();
		});

		it("should not compress when message size is less than 10KB", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", "small output"),
			];

			const event = { messages };
			const ctx = { ui: mockPI.ui };

			const result = await handler!(event, ctx);

			expect(result).toBeUndefined();
			expect(mockCompressContext).not.toHaveBeenCalled();
		});

		it("should compress when there are 3+ messages and size >= 10KB", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const largeContent = createLargeContent(15);
			const compressedContent = createLargeContent(8);
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", largeContent),
			];

			const compressedMessages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", compressedContent),
			];

			mockCompressContext.mockResolvedValueOnce({
				messages: compressedMessages,
				steps: {
					scoring: {
						protectCount: 1,
						persistCount: 1,
						summaryCount: 0,
						persistShortCount: 0,
						dropCount: 1,
					},
				},
				durationMs: 150,
			});

			const event = { messages };
			const ctx = { ui: mockPI.ui };

			const result = (await handler!(event, ctx)) as { messages: AgentMessage[] };

			expect(result).toBeDefined();
			expect(result.messages).toBeDefined();
			expect(mockCompressContext).toHaveBeenCalledWith(messages, expect.any(Object));
			expect(mockNotify).toHaveBeenCalled();
			expect(mockSetStatus).toHaveBeenCalledWith("ctx-compress", expect.stringContaining("压缩:1次"));
		});

		it("should handle compression errors gracefully", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const largeContent = createLargeContent(15);
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", largeContent),
			];

			mockCompressContext.mockRejectedValueOnce(new Error("Compression failed"));

			const event = { messages };
			const ctx = { ui: mockPI.ui };

			const result = await handler!(event, ctx);

			expect(result).toBeUndefined();
			expect(mockNotify).toHaveBeenCalledWith(
				expect.stringContaining("[ctx-compress] error: Compression failed"),
				"warning",
			);
		});

		it("should return undefined if no compression steps were performed", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const largeContent = createLargeContent(15);
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", largeContent),
			];

			mockCompressContext.mockResolvedValueOnce({
				messages,
				steps: {},
				durationMs: 10,
			});

			const event = { messages };
			const ctx = { ui: mockPI.ui };

			const result = await handler!(event, ctx);

			expect(result).toBeUndefined();
			expect(mockNotify).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Agent Start Event Tests
	// -----------------------------------------------------------------------

	describe("agent_start event handler", () => {
		it("should reset compression statistics on agent start", async () => {
			const handler = eventHandlers.get("agent_start");
			expect(handler).toBeDefined();

			const ctx = { ui: mockPI.ui };
			await handler!({}, ctx);

			expect(mockSetStatus).toHaveBeenCalledWith("ctx-compress", undefined);
			expect(mockNotify).toHaveBeenCalledWith("[ctx-compress] extension loaded", "info");
		});
	});

	// -----------------------------------------------------------------------
	// Session Shutdown Event Tests
	// -----------------------------------------------------------------------

	describe("session_shutdown event handler", () => {
		it("should clear status on session shutdown", async () => {
			const handler = eventHandlers.get("session_shutdown");
			expect(handler).toBeDefined();

			const ctx = { ui: mockPI.ui };
			await handler!({}, ctx);

			expect(mockSetStatus).toHaveBeenCalledWith("ctx-compress", undefined);
		});
	});

	// -----------------------------------------------------------------------
	// Status Update Tests
	// -----------------------------------------------------------------------

	describe("status updates", () => {
		it("should update status with compression statistics", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			// First compression
			const largeContent1 = createLargeContent(15);
			const messages1: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", largeContent1),
			];

			mockCompressContext.mockResolvedValueOnce({
				messages: messages1,
				steps: {
					scoring: {
						protectCount: 1,
						persistCount: 1,
						summaryCount: 1,
						persistShortCount: 0,
						dropCount: 1,
					},
				},
				durationMs: 150,
			});

			const event1 = { messages: messages1 };
			const ctx = { ui: mockPI.ui };
			await handler!(event1, ctx);

			// Second compression
			const largeContent2 = createLargeContent(20);
			const messages2: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", largeContent2),
			];

			mockCompressContext.mockResolvedValueOnce({
				messages: messages2,
				steps: {
					scoring: {
						protectCount: 2,
						persistCount: 1,
						summaryCount: 0,
						persistShortCount: 1,
						dropCount: 2,
					},
				},
				durationMs: 200,
			});

			const event2 = { messages: messages2 };
			await handler!(event2, ctx);

			// Verify status shows cumulative statistics
			expect(mockSetStatus).toHaveBeenLastCalledWith(
				"ctx-compress",
				expect.stringContaining("压缩:2次"),
			);
		});

		it("should show percentage saved in status", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const largeContent = createLargeContent(15);
			const compressedContent = createLargeContent(5);
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", largeContent),
			];

			mockCompressContext.mockResolvedValueOnce({
				messages: [
					createUserMsg("hello"),
					createAssistantMsg("hi"),
					createToolResult("bash", compressedContent),
				],
				steps: {
					scoring: {
						protectCount: 1,
						persistCount: 1,
						summaryCount: 0,
						persistShortCount: 0,
						dropCount: 1,
					},
				},
				durationMs: 150,
			});

			const event = { messages };
			const ctx = { ui: mockPI.ui };
			await handler!(event, ctx);

			// Should show approximately 66% saved (15KB -> 5KB)
			expect(mockSetStatus).toHaveBeenCalledWith(
				"ctx-compress",
				expect.stringMatching(/节省[0-9]+%/),
			);
		});
	});

	// -----------------------------------------------------------------------
	// Legacy Pipeline Tests
	// -----------------------------------------------------------------------

	describe("legacy pipeline support", () => {
		it("should handle compression results with persistence step", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const largeContent = createLargeContent(15);
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", largeContent),
			];

			mockCompressContext.mockResolvedValueOnce({
				messages,
				steps: {
					persistence: { persistedCount: 2 },
					lifecycle: { degradedCount: 1, clearedCount: 0 },
				},
				durationMs: 100,
			});

			const event = { messages };
			const ctx = { ui: mockPI.ui };
			const result = (await handler!(event, ctx)) as { messages: AgentMessage[] };

			expect(result).toBeDefined();
			expect(mockNotify).toHaveBeenCalledWith(
				expect.stringContaining("persist:2"),
				"info",
			);
		});

		it("should handle compression results with classification step", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const largeContent = createLargeContent(15);
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantMsg("hi"),
				createToolResult("bash", largeContent),
			];

			mockCompressContext.mockResolvedValueOnce({
				messages,
				steps: {
					scoring: {
						protectCount: 1,
						persistCount: 1,
						summaryCount: 0,
						persistShortCount: 0,
						dropCount: 1,
					},
					classification: { intent: "debugging", confidence: 0.9 },
				},
				durationMs: 120,
			});

			const event = { messages };
			const ctx = { ui: mockPI.ui };
			const result = (await handler!(event, ctx)) as { messages: AgentMessage[] };

			expect(result).toBeDefined();
			expect(mockNotify).toHaveBeenCalledWith(
				expect.stringContaining("debugging"),
				"info",
			);
		});
	});

	// -----------------------------------------------------------------------
	// Edge Cases
	// -----------------------------------------------------------------------

	describe("edge cases", () => {
		it("should handle empty messages array", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const event = { messages: [] };
			const ctx = { ui: mockPI.ui };
			const result = await handler!(event, ctx);

			expect(result).toBeUndefined();
			expect(mockCompressContext).not.toHaveBeenCalled();
		});

		it("should handle messages with undefined content", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const messages: AgentMessage[] = [
				{ role: "user", content: undefined as unknown as string },
				{ role: "assistant", content: undefined as unknown as string },
				{ role: "tool", content: undefined as unknown as string, name: "test", tool_call_id: "123" },
			];

			const event = { messages };
			const ctx = { ui: mockPI.ui };
			const result = await handler!(event, ctx);

			// Should still attempt to estimate size (which may be smaller due to undefined)
			expect(result).toBeUndefined();
		});

		it("should handle messages with non-serializable content gracefully", async () => {
			const handler = eventHandlers.get("context");
			expect(handler).toBeDefined();

			const circularObj: { self?: unknown } = {};
			circularObj.self = circularObj;

			const messages: AgentMessage[] = [
				{ role: "user", content: circularObj as unknown as string },
				{ role: "assistant", content: "hi" },
				{ role: "tool", content: "output", name: "test", tool_call_id: "123" },
			];

			const event = { messages };
			const ctx = { ui: mockPI.ui };

			// Should not throw, but may have size estimate of 0
			const result = await handler!(event, ctx);
			expect(result).toBeUndefined();
		});
	});
});
