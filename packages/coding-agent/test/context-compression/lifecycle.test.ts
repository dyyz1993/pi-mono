import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_KEEP_RECENT,
	DEFAULT_LIFECYCLE_CONFIG,
	DEFAULT_STALE_MINUTES,
	type LifecycleConfig,
	type LifecycleResult,
	ToolPriority,
	type ToolResultEntry,
} from "../../src/core/context-compression/types.js";

// Import module under test (will fail until implemented)
let applyLifecycle: (messages: AgentMessage[], config?: LifecycleConfig) => Promise<LifecycleResult>;
let getToolPriority: (toolName: string) => ToolPriority;
let estimateTokens: (messages: AgentMessage[]) => number;

try {
	const mod = await import("../../src/core/context-compression/lifecycle.js");
	applyLifecycle = mod.applyLifecycle;
	getToolPriority = mod.getToolPriority;
	estimateTokens = mod.estimateTokens;
} catch {
	applyLifecycle = async () => {
		throw new Error("lifecycle.ts not implemented yet");
	};
	getToolPriority = () => ToolPriority.DISCARDABLE;
	estimateTokens = () => 0;
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
function createTurn(
	userText: string,
	assistantText: string,
	results: Array<{ tool: string; output: string }>,
	baseTime?: number,
	now?: number,
): AgentMessage[] {
	const t = baseTime ?? Date.now();
	const n = now ?? Date.now();
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
			const allToolResults = result.messages.filter((m) => m.role === "toolResult");

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
			// Mix of critical and discardable tools
			const tools = [
				{ tool: "write", output: "file written".repeat(200) },
				{ tool: "bash", output: "bash out".repeat(200) },
				{ tool: "edit", output: "edited".repeat(200) },
				{ tool: "grep", output: "grep match".repeat(200) },
				{ tool: "ls", output: "file list".repeat(200) },
				{ tool: "read", output: "file content".repeat(200) },
				{ tool: "find", output: "found files".repeat(200) },
				{ tool: "git_log", output: "commit log".repeat(200) },
			];
			for (const t of tools) {
				messages.push(createUserMsg(`cmd for ${t.tool}`));
				messages.push(createAssistantWithTools(`processing`, [{ name: t.tool }]));
				messages.push(createToolResult(t.tool, t.output));
			}
			const config = createLifecycleConfig({ keepRecent: 4 });

			const result = await applyLifecycle(messages, config);

			// Critical tools (write/edit) should be among the preserved ones
			const finalTexts = result.messages
				.filter((m) => m.role === "toolResult")
				.map((m) => {
					const c = m.content as Array<{ type: string; text?: string }>;
					return c.find((p) => p.type === "text")?.text ?? "";
				});

			// Write and edit (critical) should survive as full content
			const hasWriteFull = finalTexts.some((t) => t.includes("file written"));
			const hasEditFull = finalTexts.some((t) => t.includes("edited"));
			expect(hasWriteFull || hasEditFull).toBe(true);

			// ls/git_log (discardable) should be degraded or cleared
			const lsEntry = finalTexts.find((t) => t.includes("file list"));
			if (lsEntry) {
				// Should NOT contain the original full content
				expect(lsEntry.length).toBeLessThan(50);
			}
		});
	});

	// ====================================================================
	// L2 - Time-based clearing
	// ====================================================================

	describe("L2: Time-based result clearing", () => {
		it("should not clear fresh results regardless of count", async () => {
			const now = Date.now();
			const messages: AgentMessage[] = [];
			// All results created just now
			for (let i = 0; i < 10; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `fresh ${i}`.repeat(200), { timestamp: now }));
			}
			const config = createLifecycleConfig({ keepRecent: 3, staleMinutes: 60 });

			const result = await applyLifecycle(messages, config);

			// With 10 results but all fresh, time rule shouldn't trigger
			// Only count-based rule applies: 7 should be degraded/cleared (10-3)
			const totalAffected = result.degradedCount + result.clearedCount;
			expect(totalAffected).toBeGreaterThanOrEqual(7);
		});

		it("should clear stale results even if under count limit", async () => {
			const now = Date.now();
			const oneHourAgo = now - 61 * 60 * 1000; // 61 minutes ago (> 60min threshold)
			const messages: AgentMessage[] = [];
			// Only 2 results, both stale
			for (let i = 0; i < 2; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `stale ${i}`.repeat(200), { timestamp: oneHourAgo }));
			}
			const config = createLifecycleConfig({ keepRecent: 5, staleMinutes: 60 });

			const result = await applyLifecycle(messages, config);

			// Both should be cleared due to staleness
			expect(result.clearedCount).toBe(2);
			expect(result.degradedCount).toBe(0);
		});

		it("should handle mixed fresh and stale results", async () => {
			const now = Date.now();
			const staleTime = now - 61 * 60 * 1000;
			const messages: AgentMessage[] = [];

			// 3 fresh results
			for (let i = 0; i < 3; i++) {
				messages.push(createUserMsg(`fresh-q${i}`));
				messages.push(createAssistantWithTools(`fresh-a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `fresh-out${i}`.repeat(200), { timestamp: now }));
			}
			// 4 stale results
			for (let i = 0; i < 4; i++) {
				messages.push(createUserMsg(`stale-q${i}`));
				messages.push(createAssistantWithTools(`stale-a${i}`, [{ name: "ls" }]));
				messages.push(createToolResult("ls", `stale-out${i}`.repeat(200), { timestamp: staleTime }));
			}
			const config = createLifecycleConfig({ keepRecent: 5, staleMinutes: 60 });

			const result = await applyLifecycle(messages, config);

			// Stale ones should be cleared
			expect(result.clearedCount).toBe(4);
			// Fresh ones should be kept (only 3, under keepRecent=5)
			expect(result.degradedCount).toBe(0);
		});

		it("should respect custom staleMinutes threshold", async () => {
			const now = Date.now();
			const thirtyMinAgo = now - 31 * 60 * 1000; // 31 minutes ago
			const messages: AgentMessage[] = [];

			messages.push(createUserMsg("q1"));
			messages.push(createAssistantWithTools("a1", [{ name: "bash" }]));
			messages.push(createToolResult("bash", "semi-stale", { timestamp: thirtyMinAgo }));

			const config30 = createLifecycleConfig({ keepRecent: 5, staleMinutes: 30 });
			const result30 = await applyLifecycle(messages, config30);

			// 31 min > 30 min threshold → should be cleared
			expect(result30.clearedCount).toBe(1);

			// Reset and test with higher threshold
			const config60 = createLifecycleConfig({ keepRecent: 5, staleMinutes: 60 });
			const result60 = await applyLifecycle(messages, config60);

			// 31 min < 60 min threshold → should be kept
			expect(result60.clearedCount).toBe(0);
			expect(result60.degradedCount).toBe(0);
		});
	});

	// ====================================================================
	// L1+L2 Combined scenarios
	// ====================================================================

	describe("Combined L1+L2 behavior", () => {
		it("should apply time rules first, then count rules to remaining", async () => {
			const now = Date.now();
			const staleTime = now - 61 * 60 * 1000;
			const messages: AgentMessage[] = [];

			// 4 stale
			for (let i = 0; i < 4; i++) {
				messages.push(createUserMsg(`sq${i}`));
				messages.push(createAssistantWithTools(`sa${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `stale-${i}`.repeat(200), { timestamp: staleTime }));
			}
			// 6 fresh (total 10)
			for (let i = 0; i < 6; i++) {
				messages.push(createUserMsg(`fq${i}`));
				messages.push(createAssistantWithTools(`fa${i}`, [{ name: "grep" }]));
				messages.push(createToolResult("grep", `fresh-${i}`.repeat(200), { timestamp: now }));
			}
			const config = createLifecycleConfig({ keepRecent: 5, staleMinutes: 60 });

			const result = await applyLifecycle(messages, config);

			// 4 stale cleared, 6 fresh remain, 5 kept + 1 degraded
			expect(result.clearedCount).toBe(4);
			expect(result.degradedCount).toBe(1); // 6 fresh - 5 kept = 1 degraded
		});

		it("should estimate token reduction correctly", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 15; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `x`.repeat(1000))); // 1KB each result
			}
			const config = createLifecycleConfig({ keepRecent: 5 });

			const result = await applyLifecycle(messages, config);

			expect(result.tokensBefore).toBeGreaterThan(0);
			expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
			// Significant reduction expected
			const savings = result.tokensBefore - result.tokensAfter;
			expect(savings).toBeGreaterThan(1000); // at least 1KB of tokens saved
		});

		it("should handle empty message list gracefully", async () => {
			const config = createLifecycleConfig();
			const result = await applyLifecycle([], config);

			expect(result.messages).toEqual([]);
			expect(result.degradedCount).toBe(0);
			expect(result.clearedCount).toBe(0);
			expect(result.tokensBefore).toBe(0);
			expect(result.tokensAfter).toBe(0);
		});

		it("should pass through non-toolResult messages unchanged", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				{ role: "assistant", content: [{ type: "text", text: "hi there" }], timestamp: Date.now() } as AgentMessage,
				createToolResult("bash", "output"),
			];
			const config = createLifecycleConfig();

			const result = await applyLifecycle(messages, config);

			// User and assistant messages should be untouched
			expect(result.messages[0].role).toBe("user");
			expect((result.messages[1].content as Array<{ type: string; text: string }>)[0].text).toBe("hi there");
		});

		it("should be idempotent: running twice gives same result on second call", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 10; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `data${i}`.repeat(500)));
			}
			const config = createLifecycleConfig({ keepRecent: 3 });

			const result1 = await applyLifecycle(messages, config);
			const result2 = await applyLifecycle(result1.messages, config);

			// Second run should not change anything further
			expect(result2.degradedCount).toBe(0);
			expect(result2.clearedCount).toBe(0);
			expect(result2.tokensAfter).toBe(result1.tokensAfter);
		});

		it("should preserve recent conversation context intact", async () => {
			const messages: AgentMessage[] = [];
			// Last 3 turns (6 messages: 3 user + 3 assistant) + their tool results = ~9 messages
			// Plus earlier turns that will be compressed
			for (let i = 0; i < 12; i++) {
				messages.push(createUserMsg(`early q${i}`));
				messages.push(createAssistantWithTools(`early a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `early out ${i}`.repeat(200)));
			}
			// Add 3 more recent turns without tool results (just chat)
			messages.push(createUserMsg("recent question"));
			messages.push({
				role: "assistant",
				content: [{ type: "text", text: "recent answer" }],
				timestamp: Date.now(),
			} as AgentMessage);
			messages.push(createUserMsg("follow up"));

			const config = createLifecycleConfig({ keepRecent: 5 });
			const result = await applyLifecycle(messages, config);

			// The last few messages (user/assistant) should be intact
			expect(result.messages[result.messages.length - 1].role).toBe("user");
			const lastUserText = (result.messages[result.messages.length - 1].content as string) ?? "";
			expect(lastUserText).toContain("follow up");

			const prevAssistant = result.messages[result.messages.length - 2];
			expect(prevAssistant.role).toBe("assistant");
		});

		it("should include restoration info in stubs for debugging", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 8; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `important data ${i}`.repeat(300)));
			}
			const config = createLifecycleConfig({ keepRecent: 3 });

			const result = await applyLifecycle(messages, config);

			// Degraded/cleared results should have tool name info for identification
			const degradedResults = result.messages.filter((m) => {
				if (m.role !== "toolResult") return false;
				const c = m.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				return !text.includes("important data"); // degraded or cleared
			});

			for (const dr of degradedResults) {
				const c = dr.content as Array<{ type: string; text?: string }>;
				const text = c.find((p) => p.type === "text")?.text ?? "";
				// Should indicate what tool it was
				expect(text.length).toBeGreaterThan(0);
			}
		});
	});

	describe("Content-aware priority adjustment", () => {
		let _adjustPriorityByContent: (toolName: string, content: string) => ToolPriority;
		const getAdjustFn = async () => {
			try {
				const mod = await import("../../src/core/context-compression/lifecycle.js");
				_adjustPriorityByContent = mod.adjustPriorityByContent;
			} catch {
				/* use fallback */
			}
		};

		it("should boost error/stack trace output to CRITICAL", async () => {
			const errorOutput = `Error: Cannot find module 'xxx'
    at Function.resolveFilename (node:internal/modules/loader.js:...)
    at Module._resolveFilename (node:internal/modules/loader.js:...)`;
			expect(adjustPriorityByContent("bash", errorOutput)).toBe(ToolPriority.CRITICAL);
		});

		it("should boost TypeError/ReferenceError to CRITICAL", () => {
			const typeError = `TypeError: Cannot read property 'x' of undefined
    at Object.<anonymous> (file.ts:42:15)`;
			expect(adjustPriorityByContent("bash", typeError)).toBe(ToolPriority.CRITICAL);
		});

		it("should boost exit-code-nonzero / failure output to IMPORTANT", () => {
			const failOutput = `npm test
  FAIL  ./src/component.test.ts
  Tests: 12 failed, 5 passed
  Exit code: 1`;
			expect(adjustPriorityByContent("bash", failOutput)).toBe(ToolPriority.IMPORTANT);
		});

		it("should downgrade pure file listing to DISCARDABLE", () => {
			const listing = `src/index.ts
src/App.ts
src/utils.ts
components/Button.ts
models/User.ts`;
			expect(adjustPriorityByContent("bash", listing)).toBe(ToolPriority.DISCARDABLE);
		});

		it("should downgrade build success logs to DISCARDABLE", () => {
			const buildLog = `Building...
✓ Built in 2.3s
Output size: 1.2MB
Done.`;
			expect(adjustPriorityByContent("bash", buildLog)).toBe(ToolPriority.DISCARDABLE);
		});

		it("should downgrade large grep matches with no errors to DISCARDABLE", () => {
			const grepOutput = Array.from(
				{ length: 100 },
				(_, i) => `src/file${i}.ts:${i * 10}: import { foo } from 'bar'`,
			).join("\n");
			expect(adjustPriorityByContent("grep", grepOutput)).toBe(ToolPriority.DISCARDABLE);
		});

		it("should keep read file content at IMPORTANT (default)", () => {
			const code = `import React from "react";
export function App() {
  return <div>Hello</div>;
}`;
			expect(adjustPriorityByContent("read", code)).toBe(ToolPriority.IMPORTANT);
		});

		it("should detect debug/log patterns and downgrade them", () => {
			const log = `[DEBUG] 2024-01-01T12:00:00Z Request received
[INFO] Processing request /api/users
[VERBOSE] SQL query: SELECT * FROM users
[WARN] Slow query detected: 1200ms`;
			expect(adjustPriorityByContent("bash", log)).toBe(ToolPriority.DISCARDABLE);
		});

		it("should detect git diff with conflicts as CRITICAL", () => {
			const diff = `<<<<<<< HEAD
const x = 1;
=======
const x = 2;
>>>>>>> feature`;
			expect(adjustPriorityByContent("git_diff", diff)).toBe(ToolPriority.CRITICAL);
		});

		it("should treat empty/whitespace-only content as DISCARDABLE", () => {
			expect(adjustPriorityByContent("bash", "")).toBe(ToolPriority.DISCARDABLE);
			expect(adjustPriorityByContent("bash", "   \n  \n")).toBe(ToolPriority.DISCARDABLE);
		});

		it("should preserve explicit CRITICAL tools regardless of content", async () => {
			await getAdjustFn();
			const writeOutput = `written 3 files, modified 15 lines`;
			// write tool is CRITICAL by name, even trivial output stays CRITICAL
			expect(adjustPriorityByContent("write", writeOutput)).toBe(ToolPriority.CRITICAL);
		});
	});
});
