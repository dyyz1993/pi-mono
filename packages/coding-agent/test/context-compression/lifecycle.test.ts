import { mkdtempSync, rmSync } from "node:fs";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_LIFECYCLE_CONFIG,
	type LifecycleConfig,
	type LifecycleResult,
	ToolPriority,
} from "../../src/core/context-compression/types.js";

// Import module under test (will fail until implemented)
let applyLifecycle: (messages: AgentMessage[], config?: LifecycleConfig) => Promise<LifecycleResult>;
let _getToolPriority: (toolName: string) => ToolPriority;
let _estimateTokens: (messages: AgentMessage[]) => number;

try {
	const mod = await import("../../src/core/context-compression/lifecycle.js");
	applyLifecycle = mod.applyLifecycle;
	_getToolPriority = mod.getToolPriority;
	_estimateTokens = mod.estimateTokens;
} catch {
	applyLifecycle = async () => {
		throw new Error("lifecycle.ts not implemented yet");
	};
	_getToolPriority = () => ToolPriority.DISCARDABLE;
	_estimateTokens = () => 0;
}

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
	return mkdtempSync("pi-lifecycle-test-");
}

/** Create a toolResult message */
function createToolResult(
	toolName: string,
	content: string,
	options?: { toolCallId?: string; timestamp?: number },
): AgentMessage {
	return {
		role: "toolResult",
		content: [{ type: "text", text: content }],
		toolName,
		toolCallId: options?.toolCallId ?? `call_${toolName}_1`,
		timestamp: options?.timestamp ?? Date.now(),
	} as AgentMessage;
}

/** Create a user message */
function createUserMsg(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

/** Create an assistant message with tool calls */
function createAssistantWithTools(
	text: string,
	toolCalls: Array<{ name: string; args?: Record<string, unknown> }> = [],
): AgentMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text },
			...toolCalls.map((tc) => ({
				type: "toolCall" as const,
				name: tc.name,
				arguments: JSON.stringify(tc.args ?? {}),
				id: `call_${tc.name}_1`,
			})),
		],
		timestamp: Date.now(),
	} as AgentMessage;
}

/**
 * Build a realistic conversation turn: user → assistant(with tools) → results
 */
function _createTurn(
	userText: string,
	assistantText: string,
	results: Array<{ tool: string; output: string }>,
	baseTime?: number,
	now?: number,
): AgentMessage[] {
	const t = baseTime ?? Date.now();
	const _n = now ?? Date.now();
	return [
		createUserMsg(userText),
		{
			...createAssistantWithTools(
				assistantText,
				results.map((r) => ({ name: r.tool })),
			),
			timestamp: t + 1,
		},
		...results.map((r) => createToolResult(r.tool, r.output, { timestamp: t + 2 })),
	];
}

/** Default config for tests */
function createLifecycleConfig(overrides?: Partial<LifecycleConfig>): LifecycleConfig {
	return {
		...DEFAULT_LIFECYCLE_CONFIG,
		...overrides,
		toolPriority: { ...DEFAULT_LIFECYCLE_CONFIG.toolPriority, ...overrides?.toolPriority },
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("L1+L2: Tool Result Lifecycle Management", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	// ====================================================================
	// L1 - Count-based degradation
	// ====================================================================

	describe("L1: Count-based result degradation", () => {
		it("should keep all results when under keepRecent limit", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 3; i++) {
				messages.push(createUserMsg(`query ${i}`));
				messages.push(createAssistantWithTools(`thinking ${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `output ${i}`.repeat(100)));
			}
			const config = createLifecycleConfig({ keepRecent: 5 });

			const result = await applyLifecycle(messages, config);

			expect(result.degradedCount).toBe(0);
			expect(result.clearedCount).toBe(0);
			// All tool results should still be intact
			const toolResults = result.messages.filter((m) => m.role === "toolResult");
			expect(toolResults.length).toBe(3);
		});

		it("should keep exactly keepRecent results intact when at limit", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 5; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `out${i}`.repeat(100)));
			}
			const config = createLifecycleConfig({ keepRecent: 5 });

			const result = await applyLifecycle(messages, config);

			expect(result.degradedCount).toBe(0);
			expect(result.clearedCount).toBe(0);
		});

		it("should degrade excess results to stubs", async () => {
			const messages: AgentMessage[] = [];
			// Create 8 turns (8 tool results), keepRecent=5
			for (let i = 0; i < 8; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `result data ${i}`.repeat(200)));
			}
			const config = createLifecycleConfig({ keepRecent: 5 });

			const result = await applyLifecycle(messages, config);

			// 3 should be degraded (8 total - 5 kept)
			expect(result.degradedCount).toBeGreaterThanOrEqual(3);
			expect(result.clearedCount).toBe(0);

			// Last 5 tool results should be full
			const toolResults = result.messages.filter((m) => m.role === "toolResult");
			const fullOnes = toolResults.filter((m) => {
				const c = m.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				return text.includes("result data"); // not degraded
			});
			expect(fullOnes.length).toBe(5);
		});

		it("should clear far-excess results entirely", async () => {
			const messages: AgentMessage[] = [];
			// 20 tool results, keep only 5
			for (let i = 0; i < 20; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `big output ${i}`.repeat(300)));
			}
			const config = createLifecycleConfig({ keepRecent: 5 });

			const result = await applyLifecycle(messages, config);

			// At least some should be fully cleared
			expect(result.clearedCount).toBeGreaterThan(0);
			// Tokens should decrease significantly
			expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
		});

		it("should NOT clear CRITICAL tools even in far-excess scenario", async () => {
			const messages: AgentMessage[] = [];
			// 20 results: mix of critical (write/edit) and discardable (bash)
			// Only 3 kept → 17 cleared, but write/edit must survive
			for (let i = 0; i < 8; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `discardable output ${i}`.repeat(200)));
			}
			// Insert critical tools in the middle (older timestamps)
			for (let i = 0; i < 4; i++) {
				messages.push(createUserMsg(`critical_q${i}`));
				messages.push(createAssistantWithTools(`critical_a${i}`, [{ name: "write" }]));
				messages.push(createToolResult("write", `IMPORTANT FILE CONTENT ${i}`.repeat(200)));
			}
			// More discardable at the end
			for (let i = 0; i < 8; i++) {
				messages.push(createUserMsg(`tail_q${i}`));
				messages.push(createAssistantWithTools(`tail_a${i}`, [{ name: "grep" }]));
				messages.push(createToolResult("grep", `grep match ${i}`.repeat(200)));
			}
			const config = createLifecycleConfig({ keepRecent: 3 });

			const result = await applyLifecycle(messages, config);

			// Debug: show ALL toolResult contents
			const _allToolResults = result.messages.filter((m) => m.role === "toolResult");

			// Write/edit results should NOT be cleared or degraded
			const writeResults = result.messages.filter((m) => {
				if (m.role !== "toolResult") return false;
				const c = m.content as Array<{ type: string; text?: string }>;
				if (!Array.isArray(c)) return false;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				return text.includes("IMPORTANT FILE CONTENT");
			});
			// All 4 write results should still have original content (not [cleared] or [degraded])
			expect(writeResults.length).toBe(4);
			for (const wr of writeResults) {
				const c = wr.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				expect(text).toContain("IMPORTANT FILE CONTENT");
				expect(text).not.toContain("[cleared]");
				expect(text).not.toContain("[degraded]");
			}
		});

		it("should preserve critical tool results longer than discardable ones", async () => {
			const messages: AgentMessage[] = [];
			const tools = [
				{ tool: "write", output: "WRITE_MARKER_0".repeat(20) },
				{ tool: "bash", output: "BASH_MARKER_1".repeat(20) },
				{ tool: "edit", output: "EDIT_MARKER_2".repeat(20) },
				{ tool: "grep", output: "GREP_MARKER_3".repeat(20) },
				{ tool: "ls", output: "LS_MARKER_4".repeat(20) },
				{ tool: "read", output: "READ_MARKER_5".repeat(20) },
				{ tool: "find", output: "FIND_MARKER_6".repeat(20) },
				{ tool: "git_log", output: "GITLOG_MARKER_7".repeat(20) },
			];
			for (const t of tools) {
				messages.push(createUserMsg(`cmd for ${t.tool}`));
				messages.push(createAssistantWithTools(`processing`, [{ name: t.tool }]));
				messages.push(createToolResult(t.tool, t.output));
			}
			const config = createLifecycleConfig({ keepRecent: 4 });

			const result = await applyLifecycle(messages, config);

			const finalTexts = result.messages
				.filter((m) => m.role === "toolResult")
				.map((m) => {
					const c = m.content as Array<{ type: string; text?: string }>;
					return c.find((p) => p.type === "text")?.text ?? "";
				});

			expect(finalTexts.some((t) => t.includes("WRITE_MARKER_0"))).toBe(true);
			expect(finalTexts.some((t) => t.includes("EDIT_MARKER_2"))).toBe(true);
			expect(finalTexts.every((t) => !t.includes("BASH_MARKER_1"))).toBe(true);
			expect(finalTexts.some((t) => t.includes("READ_MARKER_5"))).toBe(true);
			expect(finalTexts.some((t) => t.includes("FIND_MARKER_6"))).toBe(true);
			expect(finalTexts.every((t) => !t.includes("GREP_MARKER_3"))).toBe(true);
		});

		it("should keep MOST RECENT entries, not oldest (identity assertion)", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 10; i++) {
				messages.push(createUserMsg(`query_${i}`));
				messages.push(createAssistantWithTools(`thinking_${i}`, [{ name: "grep" }]));
				messages.push(createToolResult("grep", `UNIQUE_MARKER_GREP_${i}`.repeat(50)));
			}
			const config = createLifecycleConfig({ keepRecent: 3 });

			const result = await applyLifecycle(messages, config);

			const finalTexts = result.messages
				.filter((m) => m.role === "toolResult")
				.map((m) => {
					const c = m.content as Array<{ type: string; text?: string }>;
					return c.find((p) => p.type === "text")?.text ?? "";
				});

			expect(finalTexts.some((t) => t.includes("UNIQUE_MARKER_GREP_9"))).toBe(true);
			expect(finalTexts.some((t) => t.includes("UNIQUE_MARKER_GREP_8"))).toBe(true);
			expect(finalTexts.some((t) => t.includes("UNIQUE_MARKER_GREP_7"))).toBe(true);
			expect(finalTexts.every((t) => !t.includes("UNIQUE_MARKER_GREP_0"))).toBe(true);
			expect(finalTexts.every((t) => !t.includes("UNIQUE_MARKER_GREP_1"))).toBe(true);
			expect(finalTexts.every((t) => !t.includes("UNIQUE_MARKER_GREP_2"))).toBe(true);
		});

		it("should preserve image content blocks when degrading text (C2 fix)", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 10; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push({
					role: "toolResult",
					content: [
						{ type: "text", text: `output data ${i}`.repeat(200) },
						{ type: "image", data: `fake-image-data-${i}`, mimeType: "image/png" },
					],
					toolName: "bash",
					toolCallId: `call_bash_${i}`,
					timestamp: Date.now(),
				} as AgentMessage);
			}
			const config = createLifecycleConfig({ keepRecent: 8 });

			const result = await applyLifecycle(messages, config);

			const toolResults = result.messages.filter((m) => m.role === "toolResult");
			expect(toolResults.length).toBe(10);

			for (const tr of toolResults) {
				const c = tr.content as Array<{ type: string; [key: string]: unknown }>;
				expect(c.some((p) => p.type === "image")).toBe(true);
			}

			// Results should be either degraded or cleared (both preserve images)
			const compressedResults = toolResults.filter((tr) => {
				const c = tr.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				return text.includes("[degraded]") || text.includes("[cleared]");
			});
			expect(compressedResults.length).toBeGreaterThan(0);
			for (const cr of compressedResults) {
				const c = cr.content as Array<{ type: string; [key: string]: unknown }>;
				expect(c.some((p) => p.type === "text")).toBe(true);
				expect(c.some((p) => p.type === "image")).toBe(true);
			}
		});
	});

	// ====================================================================
	// L2 - Time-based clearing
	// ====================================================================

	describe("L2: Time-based result clearing", () => {
		it("should not clear fresh results regardless of count", async () => {
			const messages: AgentMessage[] = [];
			const now = Date.now();
			for (let i = 0; i < 10; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `output ${i}`.repeat(100), { timestamp: now - i * 60_000 }));
			}
			const config = createLifecycleConfig({ keepRecent: 8, staleMinutes: 30 });

			const result = await applyLifecycle(messages, config);

			// All results are within 10 minutes (< 30min stale threshold)
			// Only count-based rules should apply, not time-based
			const toolResults = result.messages.filter((m) => m.role === "toolResult");
			const clearedByTime = toolResults.filter((m) => {
				const c = m.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				return text.includes("[cleared]") || text === "";
			});
			// Fresh results should not be time-cleared (only count-degraded at most)
			expect(clearedByTime.length).toBe(0);
		});

		it("should clear stale results even if under count limit", async () => {
			const messages: AgentMessage[] = [];
			const now = Date.now();
			// Only 2 results (under keepRecent=5), but both very stale
			for (let i = 0; i < 2; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(
					createToolResult("bash", `old output ${i}`.repeat(100), { timestamp: now - 3 * 60 * 60_000 }),
				);
			}
			const config = createLifecycleConfig({ keepRecent: 5, staleMinutes: 60 });

			const result = await applyLifecycle(messages, config);

			// Both results are 3 hours old > 60min stale threshold
			expect(result.clearedCount).toBeGreaterThan(0);
		});

		it("should handle mixed fresh and stale results", async () => {
			const messages: AgentMessage[] = [];
			const now = Date.now();
			// 5 stale results
			for (let i = 0; i < 5; i++) {
				messages.push(createUserMsg(`stale_q${i}`));
				messages.push(createAssistantWithTools(`stale_a${i}`, [{ name: "bash" }]));
				messages.push(
					createToolResult("bash", `stale output ${i}`.repeat(100), { timestamp: now - 2 * 60 * 60_000 }),
				);
			}
			// 5 fresh results
			for (let i = 0; i < 5; i++) {
				messages.push(createUserMsg(`fresh_q${i}`));
				messages.push(createAssistantWithTools(`fresh_a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `fresh output ${i}`.repeat(100), { timestamp: now - i * 10_000 }));
			}
			const config = createLifecycleConfig({ keepRecent: 5, staleMinutes: 30 });

			const result = await applyLifecycle(messages, config);

			// Stale ones should be cleared, fresh ones preserved
			const toolResults = result.messages.filter((m) => m.role === "toolResult");
			const freshSurvivors = toolResults.filter((m) => {
				const c = m.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				return text.includes("fresh output") && !text.includes("[cleared]") && !text.includes("[degraded]");
			});
			expect(freshSurvivors.length).toBe(5);
		});

		it("should respect custom staleMinutes threshold", async () => {
			const messages: AgentMessage[] = [];
			const now = Date.now();
			// Result from 45 minutes ago
			messages.push(createUserMsg("q"));
			messages.push(createAssistantWithTools("a", [{ name: "bash" }]));
			messages.push(createToolResult("bash", "mid-aged output".repeat(100), { timestamp: now - 45 * 60_000 }));

			// With staleMinutes=60 → should NOT clear (45 < 60)
			const configLenient = createLifecycleConfig({ keepRecent: 5, staleMinutes: 60 });
			const resultLenient = await applyLifecycle(messages, configLenient);
			expect(resultLenient.clearedCount).toBe(0);

			// With staleMinutes=30 → SHOULD clear (45 > 30)
			const configStrict = createLifecycleConfig({ keepRecent: 5, staleMinutes: 30 });
			const resultStrict = await applyLifecycle([...messages], configStrict);
			expect(resultStrict.clearedCount).toBeGreaterThan(0);
		});

		it("should NOT clear results with timestamp=0 (M5 fix — treated as fresh)", async () => {
			const messages: AgentMessage[] = [];
			messages.push(createUserMsg("q"));
			messages.push(createAssistantWithTools("a", [{ name: "bash" }]));
			// timestamp=0 would be epoch (1970) without M5 guard → always cleared
			messages.push(createToolResult("bash", "output with ts=0".repeat(100), { timestamp: 0 }));
			const config = createLifecycleConfig({ keepRecent: 5, staleMinutes: 1 });

			const result = await applyLifecycle(messages, config);
			expect(result.clearedCount).toBe(0);
		});

		it("should NOT clear results with far-future timestamp (M5 fix)", async () => {
			const messages: AgentMessage[] = [];
			messages.push(createUserMsg("q"));
			messages.push(createAssistantWithTools("a", [{ name: "bash" }]));
			// Far future timestamp (> 1 hour from now)
			messages.push(createToolResult("bash", "future output".repeat(100), { timestamp: Date.now() + 999_999_999 }));
			const config = createLifecycleConfig({ keepRecent: 5, staleMinutes: 1 });

			const result = await applyLifecycle(messages, config);
			expect(result.clearedCount).toBe(0);
		});
	});

	// ====================================================================
	// Combined L1+L2 behavior
	// ====================================================================

	describe("Combined L1+L2 behavior", () => {
		it("should apply time rules first, then count rules to remaining", async () => {
			const messages: AgentMessage[] = [];
			const now = Date.now();
			// 4 stale + 6 fresh = 10 total, keepRecent=3
			for (let i = 0; i < 4; i++) {
				messages.push(createUserMsg(`stale_q${i}`));
				messages.push(createAssistantWithTools(`stale_a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `stale ${i}`.repeat(50), { timestamp: now - 2 * 60 * 60_000 }));
			}
			for (let i = 0; i < 6; i++) {
				messages.push(createUserMsg(`fresh_q${i}`));
				messages.push(createAssistantWithTools(`fresh_a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `fresh ${i}`.repeat(50), { timestamp: now - i * 5_000 }));
			}
			const config = createLifecycleConfig({ keepRecent: 3, staleMinutes: 30 });

			const result = await applyLifecycle(messages, config);

			// After time-clearing 4 stale, 6 fresh remain; then count keeps 3 most recent fresh
			const toolResults = result.messages.filter((m) => m.role === "toolResult");
			const survivingFresh = toolResults.filter((m) => {
				const c = m.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				return text.includes("fresh") && !text.includes("[cleared]") && !text.includes("[degraded]");
			});
			expect(survivingFresh.length).toBeLessThanOrEqual(3);
		});

		it("should estimate token reduction correctly", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 15; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `large output ${i}`.repeat(500)));
			}
			const config = createLifecycleConfig({ keepRecent: 5 });

			const result = await applyLifecycle(messages, config);

			expect(result.tokensBefore).toBeGreaterThan(0);
			expect(result.tokensAfter).toBeGreaterThanOrEqual(0);
			expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
			if (result.degradedCount > 0 || result.clearedCount > 0) {
				expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
			}
		});

		it("should handle empty message list gracefully", async () => {
			const config = createLifecycleConfig();

			const result = await applyLifecycle([], config);

			expect(result.messages.length).toBe(0);
			expect(result.degradedCount).toBe(0);
			expect(result.clearedCount).toBe(0);
			expect(result.tokensBefore).toBe(0);
			expect(result.tokensAfter).toBe(0);
		});

		it("should pass through non-toolResult messages unchanged", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				createAssistantWithTools("let me check", []),
				createUserMsg("thanks"),
			];
			const config = createLifecycleConfig();

			const result = await applyLifecycle(messages, config);

			expect(result.messages.length).toBe(3);
			expect(result.degradedCount).toBe(0);
			expect(result.clearedCount).toBe(0);
		});

		it("should be idempotent: running twice gives same result on second call", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 10; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `data ${i}`.repeat(200)));
			}
			const config = createLifecycleConfig({ keepRecent: 4 });

			const result1 = await applyLifecycle(messages, config);
			const result2 = await applyLifecycle(result1.messages, config);

			// Second run should be a no-op
			expect(result2.degradedCount).toBe(0);
			expect(result2.clearedCount).toBe(0);
			expect(result2.tokensAfter).toBe(result1.tokensAfter);
		});

		it("should preserve recent conversation context intact", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 8; i++) {
				messages.push(createUserMsg(`user msg ${i}`));
				messages.push(createAssistantWithTools(`assistant thinking ${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `result ${i}`.repeat(100)));
			}
			const config = createLifecycleConfig({ keepRecent: 5 });

			const result = await applyLifecycle(messages, config);

			// User and assistant messages should all survive
			const userMsgs = result.messages.filter((m) => m.role === "user");
			const assistantMsgs = result.messages.filter((m) => m.role === "assistant");
			expect(userMsgs.length).toBe(8);
			expect(assistantMsgs.length).toBe(8);
		});

		it("should include restoration info in stubs for debugging", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 10; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `important data ${i}`.repeat(300)));
			}
			const config = createLifecycleConfig({ keepRecent: 3 });

			const result = await applyLifecycle(messages, config);

			// Degraded/cleared results should have metadata for restoration
			const toolResults = result.messages.filter((m) => m.role === "toolResult");
			const degradedOrCleared = toolResults.filter((m) => {
				const c = m.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				return text.includes("[degraded]") || text.includes("[cleared]");
			});
			if (degradedOrCleared.length > 0) {
				for (const doc of degradedOrCleared) {
					// Should retain toolName and toolCallId for restoration
					expect(doc.toolName).toBeDefined();
					expect(doc.toolCallId).toBeDefined();
				}
			}
		});
	});

	// ====================================================================
	// Content-aware priority adjustment
	// ====================================================================

	describe("Content-aware priority adjustment", () => {
		let adjustPriorityByContent: (toolName: string, content: string) => ToolPriority;
		const getAdjustFn = async () => {
			try {
				const mod = await import("../../src/core/context-compression/lifecycle.js");
				adjustPriorityByContent = mod.adjustPriorityByContent;
			} catch {
				/* fallback */
			}
		};

		it("should boost error/stack trace output to CRITICAL", async () => {
			await getAdjustFn();
			const errorOutput = `Error: Cannot find module 'xxx'
    at Function.resolveFilename (node:internal/modules/loader.js...)
    at Module._resolveFilename (node:internal/modules/loader.js...)`;
			expect(adjustPriorityByContent("bash", errorOutput)).toBe(ToolPriority.CRITICAL);
		});

		it("should boost TypeError/ReferenceError to CRITICAL", async () => {
			await getAdjustFn();
			const typeError = `TypeError: Cannot read property 'x' of undefined
      at Object.<anonymous> (file.ts:42:15)`;
			expect(adjustPriorityByContent("bash", typeError)).toBe(ToolPriority.CRITICAL);
		});

		it("should boost exit-code-nonzero / failure output to IMPORTANT", async () => {
			await getAdjustFn();
			const failOutput = `npm test
  FAIL  ./src/component.test.ts
  Tests: 12 failed, 5 passed
  Exit code: 1`;
			expect(adjustPriorityByContent("bash", failOutput)).toBe(ToolPriority.IMPORTANT);
		});

		it("should downgrade pure file listing to DISCARDABLE", async () => {
			await getAdjustFn();
			const listing = `src/index.ts
src/App.ts
src/utils.ts
components/Button.ts
models/User.ts`;
			expect(adjustPriorityByContent("bash", listing)).toBe(ToolPriority.DISCARDABLE);
		});

		it("should downgrade build success logs to DISCARDABLE", async () => {
			await getAdjustFn();
			const buildLog = `Building...
✓ Built in 2.3s
Output size: 1.2MB
Done.`;
			expect(adjustPriorityByContent("bash", buildLog)).toBe(ToolPriority.DISCARDABLE);
		});

		it("should downgrade large grep matches with no errors to DISCARDABLE", async () => {
			await getAdjustFn();
			const grepOutput = Array.from(
				{ length: 100 },
				(_, i) => `src/file${i}.ts:${i * 10}: import { foo } from 'bar'`,
			).join("\n");
			expect(adjustPriorityByContent("grep", grepOutput)).toBe(ToolPriority.DISCARDABLE);
		});

		it("should keep read file content at IMPORTANT (default)", async () => {
			await getAdjustFn();
			const code = `import React from "react";
export function App() {
  return <div>Hello</div>;
}`;
			expect(adjustPriorityByContent("read", code)).toBe(ToolPriority.IMPORTANT);
		});

		it("should detect debug/log patterns and downgrade them", async () => {
			await getAdjustFn();
			const log = `[DEBUG] 2024-01-01T12:00:00Z Request received
[INFO] Processing request /api/users
[VERBOSE] SQL query: SELECT * FROM users
[WARN] Slow query detected: 1200ms`;
			expect(adjustPriorityByContent("bash", log)).toBe(ToolPriority.DISCARDABLE);
		});

		it("should detect git diff with conflicts as CRITICAL", async () => {
			await getAdjustFn();
			const diff = `<<<<<<< HEAD
const x = 1;
=======
const x = 2;
>>>>>>> feature`;
			expect(adjustPriorityByContent("git_diff", diff)).toBe(ToolPriority.CRITICAL);
		});

		it("should treat empty/whitespace-only content as DISCARDABLE", async () => {
			await getAdjustFn();
			expect(adjustPriorityByContent("bash", "")).toBe(ToolPriority.DISCARDABLE);
			expect(adjustPriorityByContent("bash", "   \n  \n")).toBe(ToolPriority.DISCARDABLE);
		});

		it("should preserve explicit CRITICAL tools regardless of content", async () => {
			await getAdjustFn();
			const writeOutput = `written 3 files, modified 15 lines`;
			expect(adjustPriorityByContent("write", writeOutput)).toBe(ToolPriority.CRITICAL);
		});

		// M1: Narrowed CRITICAL_PATTERNS — keyword without assignment context should NOT trigger
		it("should NOT boost bare keyword mentions to CRITICAL (M1 fix)", async () => {
			await getAdjustFn();
			// These contain the words password/secret/token but NOT as credential assignments
			const bareKeyword = `checking if user provided a valid token
the password field is required in the form
this secret is used for encryption
api key management page`;
			expect(adjustPriorityByContent("bash", bareKeyword)).not.toBe(ToolPriority.CRITICAL);
		});

		// M1: Actual credential exposure SHOULD still trigger CRITICAL
		it("should boost actual credential assignments to CRITICAL (M1 fix)", async () => {
			await getAdjustFn();
			const credential = `DB_PASSWORD=supersecret123
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
API_KEY=ak_live_abcdef123456
token: ghp_xxxxxxxxxxxxxxxxxxxx`;
			expect(adjustPriorityByContent("bash", credential)).toBe(ToolPriority.CRITICAL);
		});
	});
});
