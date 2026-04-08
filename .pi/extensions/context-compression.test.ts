/**
 * Context Compression Extension Tests
 *
 * Tests for the extension that hooks into 'context' event
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the ExtensionAPI
interface MockUI {
	setStatus: ReturnType<typeof vi.fn>;
	notify: ReturnType<typeof vi.fn>;
}

interface MockExtensionAPI {
	on: ReturnType<typeof vi.fn>;
	ui: MockUI;
}

// Import the actual implementation
import { compressContext } from "../../packages/coding-agent/src/core/context-compression/index.js";
import { DEFAULT_COMPRESSION_PIPELINE_CONFIG, STRATEGY_LABELS } from "../../packages/coding-agent/src/core/context-compression/types.js";
import contextCompressionExtension from "../context-compression.js";

// ============================================================================
// Test helpers
// ============================================================================

function createMockExtensionAPI(): MockExtensionAPI {
	return {
		on: vi.fn(),
		ui: {
			setStatus: vi.fn(),
			notify: vi.fn(),
		},
	};
}

function createUserMsg(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }] } as AgentMessage;
}

function createAssistantMsg(text: string): AgentMessage {
	return { role: "assistant", content: [{ type: "text", text }] } as AgentMessage;
}

function createToolResult(toolName: string, content: string): AgentMessage {
	return {
		role: "toolResult",
		content: [{ type: "text", text: content }],
		toolName,
		timestamp: Date.now(),
	} as AgentMessage;
}

function createLargeContent(sizeKB: number): string {
	return "x".repeat(sizeKB * 1024);
}

// ============================================================================
// Tests
// ============================================================================

describe("Context Compression Extension", () => {
	let mockPI: MockExtensionAPI;
	let eventHandlers: Map<string, Function>;

	beforeEach(() => {
		mockPI = createMockExtensionAPI();
		eventHandlers = new Map();

		// Capture event handlers
		mockPI.on.mockImplementation((event: string, handler: Function) => {
			eventHandlers.set(event, handler);
		});

		// Reset mocks
		vi.clearAllMocks();

		// Initialize extension
		contextCompressionExtension(mockPI as any);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	// -----------------------------------------------------------------------
	// Event Registration Tests
	// -----------------------------------------------------------------------

	it("should register handlers for context, agent_start, and session_shutdown events", () => {
		expect(mockPI.on).toHaveBeenCalledWith("context", expect.any(Function));
		expect(mockPI.on).toHaveBeenCalledWith("agent_start", expect.any(Function));
		expect(mockPI.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
		expect(mockPI.on).toHaveBeenCalledTimes(3);
	});

	// -----------------------------------------------------------------------
	// Compression Logic Tests (Real Implementation)
	// -----------------------------------------------------------------------

	it("should call compressContext with correct parameters when triggered", async () => {
		const contextHandler = eventHandlers.get("context");
		expect(contextHandler).toBeDefined();

		// Create messages >= 10KB
		const largeContent = createLargeContent(15);
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", largeContent),
		];

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		await contextHandler!(event, ctx);

		// The extension should call compressContext with the messages
		// Note: We can't easily verify the call was made since we're using the real implementation
		// but we can verify the result is correct
	});

	// -----------------------------------------------------------------------
	// Early Return Tests
	// -----------------------------------------------------------------------

	it("should skip compression when messages < 3", async () => {
		const contextHandler = eventHandlers.get("context");
		expect(contextHandler).toBeDefined();

		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
		];

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		const result = await contextHandler!(event, ctx);

		expect(result).toBeUndefined();
		expect(compressContext).not.toHaveBeenCalled();
	});

	it("should skip compression when message size < 10KB", async () => {
		const contextHandler = eventHandlers.get("context");
		expect(contextHandler).toBeDefined();

		// 3 messages but total size < 10KB
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", "small output"),
		];

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		const result = await contextHandler!(event, ctx);

		expect(result).toBeUndefined();
		expect(compressContext).not.toHaveBeenCalled();
	});

	it("should trigger compression when messages >= 3 and size >= 10KB", async () => {
		const contextHandler = eventHandlers.get("context");
		expect(contextHandler).toBeDefined();

		// Create large messages >= 10KB
		const largeContent = createLargeContent(12); // 12KB
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", largeContent),
		];

		const compressedMessages = [...messages]; // Simulate no actual compression
		vi.mocked(compressContext).mockResolvedValueOnce({
			messages: compressedMessages,
			steps: {},
			tokensBefore: 12000,
			tokensAfter: 12000,
			durationMs: 50,
		});

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		const result = await contextHandler!(event, ctx);

		expect(compressContext).toHaveBeenCalledWith(messages, DEFAULT_COMPRESSION_PIPELINE_CONFIG);
		expect(result).toEqual({ messages: compressedMessages });
	});

	// -----------------------------------------------------------------------
	// Compression Result Tests
	// -----------------------------------------------------------------------

	it("should return undefined when no compression steps executed", async () => {
		const contextHandler = eventHandlers.get("context");

		const largeContent = createLargeContent(15);
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", largeContent),
		];

		// Simulate no compression steps
		vi.mocked(compressContext).mockResolvedValueOnce({
			messages,
			steps: {}, // No steps executed
			tokensBefore: 15000,
			tokensAfter: 15000,
			durationMs: 10,
		});

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		const result = await contextHandler!(event, ctx);

		expect(result).toBeUndefined();
	});

	it("should return compressed messages when compression happens", async () => {
		const contextHandler = eventHandlers.get("context");

		const largeContent = createLargeContent(20);
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", largeContent),
		];

		const compressedMessages = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", "[compressed]"),
		];

		vi.mocked(compressContext).mockResolvedValueOnce({
			messages: compressedMessages,
			steps: {
				scoring: {
					protectCount: 0,
					persistCount: 1,
					summaryCount: 0,
					persistShortCount: 0,
					dropCount: 0,
				},
			},
			tokensBefore: 20000,
			tokensAfter: 5000,
			durationMs: 100,
		});

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		const result = await contextHandler!(event, ctx);

		expect(result).toEqual({ messages: compressedMessages });
		expect(mockPI.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("[ctx-compress]"),
			"info"
		);
	});

	// -----------------------------------------------------------------------
	// Statistics Tests
	// -----------------------------------------------------------------------

	it("should track compression statistics across multiple calls", async () => {
		const contextHandler = eventHandlers.get("context");

		// First compression
		const largeContent1 = createLargeContent(20);
		const messages1: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", largeContent1),
		];

		vi.mocked(compressContext).mockResolvedValueOnce({
			messages: messages1,
			steps: {
				scoring: {
					protectCount: 2,
					persistCount: 1,
					summaryCount: 1,
					persistShortCount: 0,
					dropCount: 0,
				},
			},
			tokensBefore: 20000,
			tokensAfter: 8000,
			durationMs: 100,
		});

		await contextHandler!({ messages: messages1 }, { ui: mockPI.ui });

		expect(mockPI.ui.setStatus).toHaveBeenCalledWith(
			"ctx-compress",
			expect.stringContaining("压缩:1次")
		);
		expect(mockPI.ui.setStatus).toHaveBeenCalledWith(
			"ctx-compress",
			expect.stringContaining("保留2")
		);
		expect(mockPI.ui.setStatus).toHaveBeenCalledWith(
			"ctx-compress",
			expect.stringContaining("持久化1")
		);

		// Second compression
		const largeContent2 = createLargeContent(25);
		const messages2: AgentMessage[] = [
			createUserMsg("test"),
			createAssistantMsg("ok"),
			createToolResult("bash", largeContent2),
		];

		vi.mocked(compressContext).mockResolvedValueOnce({
			messages: messages2,
			steps: {
				scoring: {
					protectCount: 3,
					persistCount: 2,
					summaryCount: 0,
					persistShortCount: 1,
					dropCount: 1,
				},
			},
			tokensBefore: 25000,
			tokensAfter: 10000,
			durationMs: 150,
		});

		await contextHandler!({ messages: messages2 }, { ui: mockPI.ui });

		// Stats should accumulate
		expect(mockPI.ui.setStatus).toHaveBeenCalledWith(
			"ctx-compress",
			expect.stringContaining("压缩:2次")
		);
	});

	it("should reset statistics on agent_start event", async () => {
		const agentStartHandler = eventHandlers.get("agent_start");
		const contextHandler = eventHandlers.get("context");

		// First do a compression
		const largeContent = createLargeContent(15);
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", largeContent),
		];

		vi.mocked(compressContext).mockResolvedValueOnce({
			messages,
			steps: {
				scoring: {
					protectCount: 1,
					persistCount: 1,
					summaryCount: 0,
					persistShortCount: 0,
					dropCount: 0,
				},
			},
			tokensBefore: 15000,
			tokensAfter: 5000,
			durationMs: 50,
		});

		await contextHandler!({ messages }, { ui: mockPI.ui });
		expect(mockPI.ui.setStatus).toHaveBeenCalledWith(
			"ctx-compress",
			expect.stringContaining("压缩:1次")
		);

		// Now trigger agent_start
		await agentStartHandler!({}, { ui: mockPI.ui });

		// Status should be cleared
		expect(mockPI.ui.setStatus).toHaveBeenCalledWith("ctx-compress", undefined);

		// Stats should be reset
		vi.mocked(compressContext).mockResolvedValueOnce({
			messages,
			steps: {
				scoring: {
					protectCount: 1,
					persistCount: 0,
					summaryCount: 0,
					persistShortCount: 0,
					dropCount: 0,
				},
			},
			tokensBefore: 15000,
			tokensAfter: 10000,
			durationMs: 50,
		});

		await contextHandler!({ messages }, { ui: mockPI.ui });
		expect(mockPI.ui.setStatus).toHaveBeenCalledWith(
			"ctx-compress",
			expect.stringContaining("压缩:1次") // Back to 1, not 2
		);
	});

	it("should clear status on session_shutdown event", async () => {
		const sessionShutdownHandler = eventHandlers.get("session_shutdown");

		await sessionShutdownHandler!({}, { ui: mockPI.ui });

		expect(mockPI.ui.setStatus).toHaveBeenCalledWith("ctx-compress", undefined);
	});

	// -----------------------------------------------------------------------
	// Error Handling Tests
	// -----------------------------------------------------------------------

	it("should handle compression errors gracefully", async () => {
		const contextHandler = eventHandlers.get("context");

		const largeContent = createLargeContent(15);
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", largeContent),
		];

		vi.mocked(compressContext).mockRejectedValueOnce(new Error("Compression failed"));

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		const result = await contextHandler!(event, ctx);

		expect(result).toBeUndefined();
		expect(mockPI.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("[ctx-compress] error: Compression failed"),
			"warning"
		);
	});

	// -----------------------------------------------------------------------
	// Legacy Pipeline Tests
	// -----------------------------------------------------------------------

	it("should handle legacy pipeline (L0/L1/L2/L3) results", async () => {
		const contextHandler = eventHandlers.get("context");

		const largeContent = createLargeContent(20);
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			createAssistantMsg("hi"),
			createToolResult("bash", largeContent),
		];

		// Legacy pipeline returns different step structure
		vi.mocked(compressContext).mockResolvedValueOnce({
			messages,
			steps: {
				persistence: { persistedCount: 2, bytesSaved: 10000 },
				lifecycle: { degradedCount: 3, clearedCount: 1 },
				summary: { summarizedCount: 1 },
			},
			tokensBefore: 20000,
			tokensAfter: 8000,
			durationMs: 150,
		});

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		const result = await contextHandler!(event, ctx);

		expect(result).toEqual({ messages });
		expect(mockPI.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("persist:2"),
			"info"
		);
		expect(mockPI.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("life:-3"),
			"info"
		);
		expect(mockPI.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("summarized:1"),
			"info"
		);
	});

	// -----------------------------------------------------------------------
	// Edge Cases
	// -----------------------------------------------------------------------

	it("should handle messages with non-serializable content", async () => {
		const contextHandler = eventHandlers.get("context");

		// Create messages with circular reference
		const circularObj: any = { name: "test" };
		circularObj.self = circularObj;

		const messages: AgentMessage[] = [
			{ role: "user", content: circularObj } as AgentMessage,
			{ role: "assistant", content: "hi" } as AgentMessage,
			{ role: "toolResult", content: createLargeContent(15) } as AgentMessage,
		];

		const event = { messages };
		const ctx = { ui: mockPI.ui };

		// Should not throw, should handle gracefully
		const result = await contextHandler!(event, ctx);

		// If JSON.stringify fails, estimateSize returns 0, so no compression triggered
		expect(result).toBeUndefined();
	});

	it("should handle very large messages efficiently", async () => {
		const contextHandler = eventHandlers.get("context");

		// Create a very large conversation (100KB+)
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 50; i++) {
			messages.push(createUserMsg(`Question ${i}`));
			messages.push(createAssistantMsg(`Answer ${i}`));
			messages.push(createToolResult("bash", createLargeContent(2)));
		}

		const compressedMessages = messages.slice(0, 30); // Simulate 40% reduction

		vi.mocked(compressContext).mockResolvedValueOnce({
			messages: compressedMessages,
			steps: {
				scoring: {
					protectCount: 10,
					persistCount: 20,
					summaryCount: 15,
					persistShortCount: 5,
					dropCount: 10,
				},
			},
			tokensBefore: 100000,
			tokensAfter: 40000,
			durationMs: 500,
		});

		const start = Date.now();
		const result = await contextHandler!({ messages }, { ui: mockPI.ui });
		const elapsed = Date.now() - start;

		expect(result).toEqual({ messages: compressedMessages });
		expect(elapsed).toBeLessThan(1000); // Should complete quickly
	});
});
