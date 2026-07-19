/**
 * Stress test for the multi-compaction system.
 *
 * Simulates long-running sessions with:
 * - 200+ turns of conversation
 * - Repeated compaction cycles
 * - Mixed message types (user, assistant, toolResult with varying sizes)
 * - Memory usage tracking
 * - Full pipeline (L0→L1→L2→compact→recovery) under pressure
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type ToolResultMessage,
} from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../extensions/_multi-compaction/config.ts";
import multiCompaction, { createMultiCompaction } from "../../extensions/_multi-compaction/index.ts";
import type { ExtensionRunner } from "../../src/core/extensions/index.ts";
import { createHarness, type Harness } from "./harness.ts";

type SessionWithCompactionInternals = {
	_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
	_consecutiveAutoCompactFailures: number;
};

function createUsage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function useSummaryStreamFn(harness: Harness, summary: string): () => number {
	let callCount = 0;
	harness.session.agent.streamFn = (model) => {
		callCount++;
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message: AssistantMessage = {
				...fauxAssistantMessage(summary),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: createUsage(10),
			};
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
	return () => callCount;
}

// Large tool result content (simulating file reads)
function largeContent(seed: number, sizeKb: number): string {
	const base = `File content seed=${seed}:\n`;
	const padding = "x".repeat(sizeKb * 1024 - base.length);
	return base + padding;
}

function createToolResultMsg(toolName: string, content: string, isError = false): ToolResultMessage {
	return {
		role: "toolResult",
		toolName,
		toolCallId: `tc-${Math.random().toString(36).slice(2, 8)}`,
		content: [{ type: "text", text: content }],
		isError,
		timestamp: Date.now(),
	};
}

/**
 * Append a valid (assistant toolCall + toolResult) pair to the session.
 * Without the assistant toolCall, sanitizeToolProtocolEntries would strip
 * the toolResult as an orphan, breaking microcompact stress tests.
 */
function appendToolResultPair(harness: Harness, toolName: string, content: string, isError = false): void {
	const model = harness.getModel();
	const toolCallId = `tc-${Math.random().toString(36).slice(2, 8)}`;
	const ts = Date.now();
	harness.sessionManager.appendMessage({
		role: "assistant",
		content: [
			{ type: "text", text: `Calling ${toolName}` },
			{ type: "toolCall", id: toolCallId, name: toolName, arguments: {} },
		],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(10),
		stopReason: "toolUse",
		timestamp: ts - 1,
	} as AssistantMessage);
	harness.sessionManager.appendMessage({
		role: "toolResult",
		toolName,
		toolCallId,
		content: [{ type: "text", text: content }],
		isError,
		timestamp: ts,
	});
}

function createAssistantMsg(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai" as const,
		provider: "faux" as const,
		model: "faux-1",
		usage: createUsage(text.length),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("Multi-compaction stress tests", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		for (const dir of tempDirs) {
			try {
				rmSync(dir, { recursive: true });
			} catch {}
		}
		tempDirs.length = 0;
	});

	it("handles 200-turn conversation with repeated compaction cycles", async () => {
		const harness = await createHarness({
			extensionFactories: [multiCompaction],
			settings: { compaction: { keepRecentTokens: 500 } },
		});
		harnesses.push(harness);
		useSummaryStreamFn(harness, "Stress test summary with goal and progress info");

		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const startTime = Date.now();
		const memorySnapshots: { turn: number; entryCount: number; messageCount: number }[] = [];

		// Simulate 200 turns
		for (let turn = 0; turn < 200; turn++) {
			// User message
			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `Turn ${turn}: Please read and analyze the file` }],
				timestamp: Date.now(),
			});

			// Tool result (varying sizes: 1KB to 20KB)
			const sizeKb = (turn % 20) + 1;
			appendToolResultPair(harness, "read", largeContent(turn, sizeKb));

			// Assistant response
			harness.sessionManager.appendMessage(
				createAssistantMsg(
					`Analysis for turn ${turn}: The file contains structured data with ${sizeKb}KB of content.`,
				),
			);

			// Trigger compaction every 30 turns
			if (turn > 0 && turn % 30 === 0) {
				const result = await sessionInternals._runAutoCompaction("threshold", false);
				// Compaction should succeed
				expect(result).toBe(true);

				// Verify session state is consistent
				const entries = harness.sessionManager.getEntries();
				const compactionEntries = entries.filter((e) => e.type === "compaction");
				expect(compactionEntries.length).toBeGreaterThan(0);

				// Verify messages can be rebuilt
				const context = harness.sessionManager.buildSessionContext();
				expect(context.messages.length).toBeGreaterThan(0);
			}

			// Memory snapshot every 50 turns
			if (turn % 50 === 49) {
				const entries = harness.sessionManager.getEntries();
				const context = harness.sessionManager.buildSessionContext();
				memorySnapshots.push({
					turn,
					entryCount: entries.length,
					messageCount: context.messages.length,
				});
			}
		}

		const elapsed = Date.now() - startTime;

		// Final state verification
		const finalEntries = harness.sessionManager.getEntries();
		const finalContext = harness.sessionManager.buildSessionContext();
		const compactionEntries = finalEntries.filter((e) => e.type === "compaction");

		// Should have performed multiple compactions
		expect(compactionEntries.length).toBeGreaterThanOrEqual(5);

		// Context should be bounded (not growing unboundedly)
		expect(finalContext.messages.length).toBeLessThan(200);

		// Memory snapshots should show bounded growth
		for (let i = 1; i < memorySnapshots.length; i++) {
			const prev = memorySnapshots[i - 1]!;
			const curr = memorySnapshots[i]!;
			// Entries can grow (we're adding 3 per turn) but messages should be bounded
			expect(curr.messageCount).toBeLessThan(500);
		}

		// Should complete in reasonable time (< 30s for 200 turns)
		expect(elapsed).toBeLessThan(30_000);

		console.log(`[stress] 200 turns completed in ${elapsed}ms`);
		console.log(`[stress] Compactions: ${compactionEntries.length}`);
		console.log(`[stress] Final messages: ${finalContext.messages.length}`);
		console.log(`[stress] Final entries: ${finalEntries.length}`);
		console.log("[stress] Memory snapshots:", JSON.stringify(memorySnapshots, null, 2));
	});

	it("handles burst of 500 tool results followed by compaction", async () => {
		const harness = await createHarness({
			extensionFactories: [multiCompaction],
		});
		harnesses.push(harness);

		// Seed 500 tool results
		for (let i = 0; i < 500; i++) {
			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `read file ${i}` }],
				timestamp: Date.now() - (500 - i),
			});
			appendToolResultPair(harness, "read", `Content of file ${i}: ${"data ".repeat(100)}`);
		}

		const startTime = Date.now();
		const context = harness.sessionManager.buildSessionContext();
		const transformed = await harness.session.agent.transformContext!(context.messages);
		const elapsed = Date.now() - startTime;

		// Should handle 500 messages without hanging
		expect(elapsed).toBeLessThan(10_000);

		// Context hooks should have compacted many results
		const toolResults = transformed.filter((msg) => msg.role === "toolResult") as ToolResultMessage[];
		const compactedCount = toolResults.filter((tr) => {
			const text = tr.content[0]?.type === "text" ? tr.content[0].text : "";
			return text.includes("cleared") || text.includes("compacted");
		}).length;

		expect(compactedCount).toBeGreaterThan(0);

		console.log(`[stress] 500 tool results processed in ${elapsed}ms`);
		console.log(`[stress] Compacted: ${compactedCount}/${toolResults.length}`);
	});

	it("handles 50 consecutive compaction cycles without degradation", async () => {
		const harness = await createHarness({
			extensionFactories: [multiCompaction],
			settings: { compaction: { keepRecentTokens: 1 } },
		});
		harnesses.push(harness);
		useSummaryStreamFn(harness, "Repeated compaction summary");

		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const results: { cycle: number; success: boolean; messageCount: number }[] = [];

		for (let cycle = 0; cycle < 50; cycle++) {
			// Add some messages
			for (let j = 0; j < 5; j++) {
				harness.sessionManager.appendMessage({
					role: "user",
					content: [{ type: "text", text: `Cycle ${cycle} message ${j}` }],
					timestamp: Date.now(),
				});
				appendToolResultPair(harness, "read", `Result data for cycle ${cycle} msg ${j}: ${"x ".repeat(200)}`);
				harness.sessionManager.appendMessage(createAssistantMsg(`Cycle ${cycle} response ${j}`));
			}

			const success = await sessionInternals._runAutoCompaction("threshold", false);
			const context = harness.sessionManager.buildSessionContext();
			results.push({
				cycle,
				success,
				messageCount: context.messages.length,
			});
		}

		// All compaction cycles should succeed
		const failures = results.filter((r) => !r.success);
		expect(failures.length).toBe(0);

		// Message count should stay bounded across 50 cycles
		const maxMessages = Math.max(...results.map((r) => r.messageCount));
		expect(maxMessages).toBeLessThan(1000);

		// Consecutive failures should stay at 0
		expect(sessionInternals._consecutiveAutoCompactFailures).toBe(0);

		console.log(`[stress] 50 compaction cycles completed`);
		console.log(`[stress] Max message count: ${maxMessages}`);
		console.log(`[stress] Final message count: ${results[results.length - 1]!.messageCount}`);
	});

	it("handles alternating compact and overflow recovery", async () => {
		const harness = await createHarness({
			extensionFactories: [multiCompaction],
			settings: { compaction: { keepRecentTokens: 1 } },
		});
		harnesses.push(harness);
		useSummaryStreamFn(harness, "Alternating recovery summary");

		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		let thresholdCompactions = 0;
		let overflowCompactions = 0;

		for (let round = 0; round < 20; round++) {
			// Add messages
			for (let j = 0; j < 10; j++) {
				harness.sessionManager.appendMessage({
					role: "user",
					content: [{ type: "text", text: `Round ${round} prompt ${j}` }],
					timestamp: Date.now(),
				});
				appendToolResultPair(harness, "bash", `Output round ${round} cmd ${j}: ${"output ".repeat(100)}`);
				harness.sessionManager.appendMessage(createAssistantMsg(`Round ${round} response ${j}`));
			}

			// Alternate between threshold and overflow
			const reason = round % 2 === 0 ? "threshold" : "overflow";
			const willRetry = reason === "overflow";
			const success = await sessionInternals._runAutoCompaction(reason, willRetry);

			if (success) {
				if (reason === "threshold") thresholdCompactions++;
				else overflowCompactions++;
			}
		}

		expect(thresholdCompactions).toBeGreaterThan(0);
		expect(overflowCompactions).toBeGreaterThan(0);
		expect(sessionInternals._consecutiveAutoCompactFailures).toBe(0);

		console.log(`[stress] Threshold compactions: ${thresholdCompactions}`);
		console.log(`[stress] Overflow compactions: ${overflowCompactions}`);
	});

	it("determinism under repeated transformContext calls (cache safety)", async () => {
		const harness = await createHarness({
			extensionFactories: [
				createMultiCompaction({
					contextFold: { ...DEFAULT_CONFIG.contextFold, enabled: false },
					lineFold: { ...DEFAULT_CONFIG.lineFold, enabled: false },
					microcompact: { ...DEFAULT_CONFIG.microcompact, minIntervalMs: 0 },
					sessionMemory: { ...DEFAULT_CONFIG.sessionMemory, enabled: false },
					snipCompact: { ...DEFAULT_CONFIG.snipCompact, enabled: false },
					toolResultBudget: { ...DEFAULT_CONFIG.toolResultBudget, enabled: false },
				}),
			],
		});
		harnesses.push(harness);

		// Seed complex conversation
		for (let i = 0; i < 100; i++) {
			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `Message ${i}` }],
				timestamp: Date.now() - (100 - i),
			});
			appendToolResultPair(harness, "read", `File content ${i}: ${"data ".repeat(50)}`);
			harness.sessionManager.appendMessage(createAssistantMsg(`Response ${i}`));
		}

		const context = harness.sessionManager.buildSessionContext();
		const outputs: string[] = [];

		// Run transformContext 10 times on the same input
		for (let i = 0; i < 10; i++) {
			const transformed = await harness.session.agent.transformContext!(structuredClone(context.messages));
			outputs.push(JSON.stringify(transformed));
		}

		// All 10 outputs must be identical
		const uniqueOutputs = new Set(outputs);
		expect(uniqueOutputs.size).toBe(1);

		console.log(`[stress] Determinism check: ${uniqueOutputs.size === 1 ? "PASS" : "FAIL"}`);
		console.log(`[stress] Output size: ${outputs[0]!.length} chars`);
	});

	it("tool-result-budget with massive tool output under concurrent pressure", async () => {
		const tempDir = join("/tmp", `stress-budget-${Date.now()}`);
		tempDirs.push(tempDir);
		mkdirSync(tempDir, { recursive: true });

		const harness = await createHarness({
			extensionFactories: [multiCompaction],
		});
		harnesses.push(harness);

		// Create files that will be referenced
		for (let i = 0; i < 20; i++) {
			writeFileSync(join(tempDir, `file-${i}.txt`), "x".repeat(100 * 1024)); // 100KB each
		}

		// Seed massive tool results (20 * 100KB = 2MB total)
		for (let i = 0; i < 20; i++) {
			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `read file-${i}` }],
				timestamp: Date.now() - (20 - i),
			});
			appendToolResultPair(harness, "read", largeContent(i, 100));
		}

		const startTime = Date.now();
		const context = harness.sessionManager.buildSessionContext();
		const transformed = await harness.session.agent.transformContext!(context.messages);
		const elapsed = Date.now() - startTime;

		// Should handle 2MB of tool results
		expect(elapsed).toBeLessThan(15_000);

		// Verify output is bounded
		const totalOutputSize = JSON.stringify(transformed).length;
		expect(totalOutputSize).toBeLessThan(2 * 1024 * 1024); // Less than 2MB

		console.log(`[stress] 2MB tool results processed in ${elapsed}ms`);
		console.log(`[stress] Output size: ${(totalOutputSize / 1024).toFixed(0)}KB`);
	});

	it("circuit breaker activates and recovers correctly under sustained failures", async () => {
		const harness = await createHarness({
			extensionFactories: [multiCompaction],
			settings: { compaction: { keepRecentTokens: 100 } },
		});
		harnesses.push(harness);

		// Make streamFn always fail
		let failCount = 0;
		harness.session.agent.streamFn = () => {
			failCount++;
			throw new Error("Sustained failure");
		};

		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

		// Seed enough messages for compaction
		for (let i = 0; i < 20; i++) {
			harness.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `Message ${i}` }],
				timestamp: Date.now(),
			});
			harness.sessionManager.appendMessage(createAssistantMsg(`Response ${i}`));
		}

		// Try compaction 10 times — only first 3 should attempt LLM calls
		const results: boolean[] = [];
		for (let i = 0; i < 10; i++) {
			const result = await sessionInternals._runAutoCompaction("threshold", false);
			results.push(result);
		}

		// First 3 should fail (return false after LLM error), rest should skip (circuit breaker)
		expect(results.every((r) => r === false)).toBe(true);

		// Circuit breaker should have stopped LLM calls after 3 failures
		// Each failure attempt = 1 initial + 2 retries = 3 streamFn calls
		// 3 failures * 3 calls = 9 total, then circuit breaker kicks in for remaining 7
		expect(failCount).toBeLessThanOrEqual(9);
		expect(sessionInternals._consecutiveAutoCompactFailures).toBeGreaterThanOrEqual(3);

		// Now recover: make streamFn succeed
		let successCount = 0;
		harness.session.agent.streamFn = (model) => {
			successCount++;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				const message: AssistantMessage = {
					...fauxAssistantMessage("Recovery summary"),
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: createUsage(10),
				};
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		// Need to reset the failure counter for recovery
		sessionInternals._consecutiveAutoCompactFailures = 0;

		const recoveryResult = await sessionInternals._runAutoCompaction("threshold", false);
		expect(recoveryResult).toBe(true);
		expect(successCount).toBe(1);

		console.log(`[stress] Fail count before circuit breaker: ${failCount}`);
		console.log(`[stress] Recovery success: ${recoveryResult}`);
	});

	it("context-fold custom entries stay O(turns) not O(messages)", async () => {
		const harness = await createHarness({
			extensionFactories: [multiCompaction],
		});
		harnesses.push(harness);

		const model = harness.getModel();
		const runner = harness.session["_extensionRunner"] as ExtensionRunner;
		const now = Date.now();
		const turnCount = 50;

		// Simulate 50 turns, each with 5 assistant messages
		for (let turn = 0; turn < turnCount; turn++) {
			const oldTimestamp = now - (turnCount - turn) * 60 * 1000; // 1 hour ago → now

			for (let j = 0; j < 5; j++) {
				harness.sessionManager.appendMessage({
					role: "user",
					content: [{ type: "text", text: `Turn ${turn} prompt ${j}` }],
					timestamp: oldTimestamp + j * 10,
				});
				harness.sessionManager.appendMessage({
					role: "assistant",
					content: [{ type: "text", text: `Response turn ${turn} msg ${j}` }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: createUsage(50),
					stopReason: "stop",
					timestamp: oldTimestamp + j * 10 + 5,
				} as AssistantMessage);
			}

			// Trigger turn_end to activate context-fold
			await runner.emit({
				type: "turn_end",
				turnIndex: turn,
				message: { role: "user", content: [{ type: "text", text: "end turn" }], timestamp: now },
				toolResults: [],
			});
		}

		const entries = harness.sessionManager.getEntries();

		// Count compaction_fold custom entries
		const foldEntries = entries.filter(
			(e) => e.type === "custom" && (e as { customType?: string }).customType === "compaction_fold",
		);

		// Count all compaction-related custom entries
		const compactionCustomEntries = entries.filter((e) => {
			if (e.type !== "custom") return false;
			const ct = (e as { customType?: string }).customType ?? "";
			return ct.startsWith("compaction_");
		});

		// Count message entries
		const messageEntries = entries.filter((e) => e.type === "message");

		// Key assertion: fold entries should be O(turns), not O(messages)
		// With 50 turns and 5 messages each = 250 total assistant messages
		// Old behavior: ~250 fold entries (one per message)
		// New behavior: <= 50 fold entries (one batch per turn)
		expect(foldEntries.length).toBeLessThanOrEqual(turnCount);

		// Verify each fold entry has batch data
		for (const entry of foldEntries) {
			const data = (entry as { data?: { count?: number; folds?: unknown[] } }).data;
			expect(data).toBeDefined();
			expect(data!.count).toBeGreaterThan(0);
			expect(data!.folds).toBeDefined();
			expect(data!.folds!.length).toBe(data!.count);
		}

		// Verify total compaction custom entries are bounded
		expect(compactionCustomEntries.length).toBeLessThan(200);

		// Simulate serialized size estimate
		const totalSize = JSON.stringify(entries).length;
		const sizeKb = totalSize / 1024;

		// Session should be bounded (old behavior would be 10x+ larger)
		expect(sizeKb).toBeLessThan(500); // 500KB budget for 250 messages

		console.log(`[stress] ${turnCount} turns, ${messageEntries.length} messages`);
		console.log(`[stress] Fold entries: ${foldEntries.length} (batched, <= turns)`);
		console.log(`[stress] Total compaction custom: ${compactionCustomEntries.length}`);
		console.log(`[stress] Serialized size: ${sizeKb.toFixed(0)}KB`);
	});
});
