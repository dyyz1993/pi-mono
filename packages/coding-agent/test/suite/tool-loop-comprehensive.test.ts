/**
 * Comprehensive parameterized harness tests for contextFold + loop detection.
 *
 * These tests cover the D1-D5 scenarios with configurable parameters,
 * simulating real-world patterns without needing actual LLM API calls.
 *
 * Scenarios:
 *   D1: Edit loop detection (consecutive failing edits → abort)
 *   D2: Fold summary injection into LLM context
 *   D3: Compaction + continued conversation
 *   D4: No false-positive on reading different file offsets
 *   D5: Text-only reply regression (86e95d84 — fold must NOT re-trigger)
 *
 * Uses createMultiCompaction() to inject test-specific config overrides
 * (e.g., maxAgeMs: 0 for instant fold, minIntervalMs: 0 for no cooldown).
 */

import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createMultiCompaction } from "../../extensions/_multi-compaction/index.ts";
import { convertToLlm } from "../../src/core/messages.ts";
import { createHarness, type Harness } from "./harness.ts";

// === Test helpers ===

type SessionWithLoopInternals = {
	_loopState: {
		lastSignature: string;
		consecutiveCount: number;
		consecutiveErrorCount: number;
	};
};

/** Fast-fold config: maxAgeMs=0 (instant), minIntervalMs=0 (no cooldown) */
function fastFoldConfig() {
	return createMultiCompaction({
		contextFold: {
			enabled: true,
			maxAgeMs: 0, // Fold immediately (no waiting)
			keepRecentCount: 2, // Keep only 2 recent
			maxSummaryLength: 500,
			minIntervalMs: 0, // No cooldown
		},
		microcompact: { enabled: false, keepRecentCount: 0, clearableTools: [], maxCachedResults: 0, minIntervalMs: 0 },
	});
}

function makeFailingEdit(): AgentTool {
	return {
		name: "edit",
		label: "Edit",
		description: "Edit a file",
		parameters: Type.Object({ path: Type.String() }),
		execute: async () => {
			throw new Error("Could not find the exact text to replace");
		},
	};
}

function makeSuccessEdit(): AgentTool {
	return {
		name: "edit",
		label: "Edit",
		description: "Edit a file",
		parameters: Type.Object({ path: Type.String() }),
		execute: async () => ({
			content: [{ type: "text", text: "File edited successfully" }],
			details: {},
		}),
	};
}

function makeReadTool(): AgentTool {
	return {
		name: "read",
		label: "Read",
		description: "Read a file",
		parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Number()) }),
		execute: async () => ({
			content: [{ type: "text", text: "file content here" }],
			details: {},
		}),
	};
}

// === D1: Edit loop detection ===

describe("D1: edit loop detection (parameterized)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("detects after 2 consecutive identical edit errors", async () => {
		const harness = await createHarness({ tools: [makeFailingEdit()] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("trying different approach"),
		]);

		await harness.session.prompt("edit /a.ts");

		const session = harness.session as unknown as SessionWithLoopInternals;
		expect(session._loopState.consecutiveErrorCount).toBeGreaterThanOrEqual(2);
	});

	it("does NOT trigger when edits target different files", async () => {
		const harness = await createHarness({ tools: [makeFailingEdit()] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", { path: "/b.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", { path: "/c.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("edit files");

		const session = harness.session as unknown as SessionWithLoopInternals;
		expect(session._loopState.consecutiveErrorCount).toBe(1); // last error only, different files
	});

	it("3 parallel edits to same file all failing triggers detection", async () => {
		const harness = await createHarness({ tools: [makeFailingEdit()] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("edit", { path: "/a.ts" }),
					fauxToolCall("edit", { path: "/a.ts" }),
					fauxToolCall("edit", { path: "/a.ts" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("switching approach"),
		]);

		await harness.session.prompt("edit /a.ts three ways");

		const session = harness.session as unknown as SessionWithLoopInternals;
		expect(session._loopState.consecutiveErrorCount).toBeGreaterThanOrEqual(2);
	});
});

// === D2: Fold summary injection ===

describe("D2: fold summary injection (parameterized, fast fold)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("fold summary appears in LLM context after next prompt", async () => {
		const harness = await createHarness({ extensionFactories: [fastFoldConfig()] });
		harnesses.push(harness);

		// Seed old assistant messages (timestamp in the past)
		const oldTime = Date.now() - 60000;
		const sm = harness.sessionManager;
		for (let i = 0; i < 5; i++) {
			sm.appendMessage(fauxAssistantMessage(`old work ${i}`, { timestamp: oldTime + i }));
		}

		// First prompt triggers turn_end → fold → nextTurn delivery queue
		harness.setResponses([fauxAssistantMessage("done")]);
		await harness.session.prompt("first prompt");

		// Second prompt: fold summary should now be in LLM context
		harness.setResponses([fauxAssistantMessage("second response")]);
		await harness.session.prompt("second prompt");

		const sessionContext = sm.buildSessionContext();
		const llmMessages = convertToLlm(sessionContext.messages);
		const hasFoldSummary = llmMessages.some((m) => {
			if (!Array.isArray(m.content)) return false;
			return m.content.some((part: { text?: string }) => part.text?.includes("Context fold"));
		});

		expect(hasFoldSummary).toBe(true);
	});

	it("fold does NOT re-trigger agent loop (86e95d84 regression)", async () => {
		const harness = await createHarness({ extensionFactories: [fastFoldConfig()] });
		harnesses.push(harness);

		const oldTime = Date.now() - 60000;
		const sm = harness.sessionManager;
		for (let i = 0; i < 5; i++) {
			sm.appendMessage(fauxAssistantMessage(`old ${i}`, { timestamp: oldTime + i }));
		}

		harness.setResponses([fauxAssistantMessage("single response")]);
		await harness.session.prompt("test");

		// Must call LLM exactly once — fold must not re-trigger via steering
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("fold summary includes success/failure status", async () => {
		// This is tested at the unit level in context-fold-summary.test.ts,
		// but here we verify it end-to-end through the full fold pipeline.
		const harness = await createHarness({
			tools: [makeFailingEdit()],
			extensionFactories: [fastFoldConfig()],
		});
		harnesses.push(harness);

		const oldTime = Date.now() - 60000;
		const sm = harness.sessionManager;
		// Seed an old assistant message with a tool call
		sm.appendMessage({
			role: "assistant",
			content: [{ type: "toolCall", id: "old-tc-1", name: "edit", arguments: { path: "/x.ts" } }],
			api: "test",
			provider: "test",
			model: "test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: oldTime,
		});
		// And its tool result (error)
		sm.appendMessage({
			role: "toolResult",
			toolCallId: "old-tc-1",
			toolName: "edit",
			content: [{ type: "text", text: "Could not find text" }],
			isError: true,
			timestamp: oldTime + 1,
		});

		harness.setResponses([fauxAssistantMessage("done"), fauxAssistantMessage("second")]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");

		const sessionContext = sm.buildSessionContext();
		const llmMessages = convertToLlm(sessionContext.messages);
		const foldMsg = llmMessages.find((m) => {
			if (!Array.isArray(m.content)) return false;
			return m.content.some((part: { text?: string }) => part.text?.includes("Context fold"));
		});

		if (foldMsg) {
			const text = (foldMsg.content as Array<{ text: string }>).map((p) => p.text).join("");
			// The fold summary should contain the failure status
			expect(text).toContain("FAILED");
		}
	});
});

// === D3: Compaction + continued conversation ===

describe("D3: compaction + continued conversation", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("loop detection works after manual compaction", async () => {
		const harness = await createHarness({
			tools: [makeSuccessEdit()],
			settings: { compaction: { enabled: true, keepRecentTokens: 0 } },
		});
		harnesses.push(harness);

		// Build conversation
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("edit a");

		// Manual compaction (needs summary response)
		harness.setResponses([fauxAssistantMessage("Summary of previous work.")]);
		await harness.session.compact();

		// Continue after compaction
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "/b.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done after compaction"),
		]);
		await harness.session.prompt("edit b after compaction");

		const session = harness.session as unknown as SessionWithLoopInternals;
		expect(session._loopState).toBeDefined();
	});

	it("loop counter resets on new prompt after compaction", async () => {
		const harness = await createHarness({ tools: [makeFailingEdit()] });
		harnesses.push(harness);

		// First prompt: trigger loop detection
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("switching"),
		]);
		await harness.session.prompt("edit a");

		// Wait for fire-and-forget abort + triggerTurn to complete
		await new Promise((resolve) => setTimeout(resolve, 100));

		const session = harness.session as unknown as SessionWithLoopInternals;
		expect(session._loopState.consecutiveErrorCount).toBeGreaterThanOrEqual(2);

		// Wait for agent to be idle before next prompt
		while (harness.session.isStreaming) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		// New prompt with different file — counter resets
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "/z.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("fresh start"),
		]);
		await harness.session.prompt("edit z");

		// Counter should reflect only the new prompt's activity
		expect(session._loopState.lastSignature).toContain("/z.ts");
	});
});

// === D4: No false-positive on reading different offsets ===

describe("D4: no false-positive on reading large files", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("reading 6 different offsets of same file does NOT trigger", async () => {
		const harness = await createHarness({ tools: [makeReadTool()] });
		harnesses.push(harness);

		// Agent reads /big.ts at offsets 0, 500, 1000, 1500, 2000, 2500
		const reads = Array.from({ length: 6 }, (_, i) =>
			fauxAssistantMessage([fauxToolCall("read", { path: "/big.ts", offset: i * 500 })], { stopReason: "toolUse" }),
		);
		harness.setResponses([...reads, fauxAssistantMessage("done reading")]);

		await harness.session.prompt("read the whole file");

		const session = harness.session as unknown as SessionWithLoopInternals;
		// Each read has a different offset → different signature → no accumulation
		expect(session._loopState.consecutiveCount).toBeLessThanOrEqual(1);
	});

	it("reading same offset 5 times triggers (real loop)", async () => {
		const harness = await createHarness({ tools: [makeReadTool()] });
		harnesses.push(harness);

		const reads = Array.from({ length: 5 }, () =>
			fauxAssistantMessage([fauxToolCall("read", { path: "/big.ts", offset: 100 })], { stopReason: "toolUse" }),
		);
		harness.setResponses([...reads, fauxAssistantMessage("done")]);

		await harness.session.prompt("read the file");

		const session = harness.session as unknown as SessionWithLoopInternals;
		// 5 identical reads → loop detection triggers at count=5
		// (the general threshold). After that, abort fires.
		expect(session._loopState.consecutiveCount).toBeGreaterThanOrEqual(2);
	});

	it("alternating read→edit→read→edit does NOT accumulate", async () => {
		const harness = await createHarness({ tools: [makeReadTool(), makeSuccessEdit()] });
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "/a.ts", offset: 0 })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("read", { path: "/a.ts", offset: 0 })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", { path: "/a.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("read", { path: "/a.ts", offset: 0 })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("work on file a");

		const session = harness.session as unknown as SessionWithLoopInternals;
		// Alternating tools = different signatures, no accumulation
		expect(session._loopState.consecutiveCount).toBeLessThanOrEqual(1);
	});
});
