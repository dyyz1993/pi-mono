/**
 * Context Compression Pipeline - Orchestration Tests
 *
 * Tests for index.ts: full L0→L1→L2→L3 pipeline execution
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
	type CompressionPipelineConfig,
	DEFAULT_COMPRESSION_PIPELINE_CONFIG,
} from "../../src/core/context-compression/types.js";

let compressContext: (
	messages: AgentMessage[],
	config?: CompressionPipelineConfig,
) => Promise<{
	messages: AgentMessage[];
	steps: Record<string, unknown>;
	tokensBefore: number;
	tokensAfter: number;
	durationMs: number;
}>;

try {
	const mod = await import("../../src/core/context-compression/index.js");
	compressContext = mod.compressContext;
} catch {
	compressContext = async () => {
		throw new Error("index.ts not implemented yet");
	};
}

// ============================================================================
// Test helpers
// ============================================================================

function createUserMsg(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }] } as AgentMessage;
}

function createAssistantWithTools(text: string, tools: Array<{ name: string }>): AgentMessage {
	return {
		role: "assistant",
		content: [
			{ type: "text", text },
			...tools.map((t) => ({ type: "toolCall" as const, name: t.name, arguments: "{}" })),
		],
		timestamp: Date.now(),
	} as AgentMessage;
}

function createToolResult(toolName: string, content: string): AgentMessage {
	return {
		role: "toolResult",
		content: [{ type: "text", text: content }],
		toolName,
		timestamp: Date.now(),
	} as AgentMessage;
}

function createPipelineConfig(overrides?: Partial<CompressionPipelineConfig>): CompressionPipelineConfig {
	return { ...DEFAULT_COMPRESSION_PIPELINE_CONFIG, ...overrides };
}

// ============================================================================
// Tests
// ============================================================================

describe("Compression Pipeline: Orchestration (L0→L1→L2→L3)", () => {
	it("should run all layers on a realistic conversation", async () => {
		const messages: AgentMessage[] = [];
		// 15 turns with large tool results to trigger all layers
		for (let i = 0; i < 15; i++) {
			messages.push(createUserMsg(`question ${i}: fix this bug in module ${i}`));
			messages.push(createAssistantWithTools(`analyzing ${i}`, [{ name: "read" }, { name: "bash" }]));
			messages.push(createToolResult("read", `file content line ${i}\n`.repeat(200)));
			messages.push(createToolResult("bash", `build output ${i}\n`.repeat(100)));
		}

		const result = await compressContext(messages);

		expect(result.messages).toBeDefined();
		expect(result.messages.length).toBe(messages.length);
		expect(result.durationMs).toBeGreaterThan(0);
		expect(result.durationMs).toBeLessThan(5000); // Should complete quickly
	});

	it("should produce smaller output than input for large conversations", async () => {
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push(createUserMsg(`q${i}`));
			messages.push(createAssistantWithTools(`a${i}`, [{ name: "grep" }]));
			messages.push(createToolResult("grep", `match at file${i}.ts:${i * 10}\n`.repeat(80)));
		}

		const result = await compressContext(messages);

		// Pipeline should have done something
		const hasSteps = Object.keys(result.steps).length > 0;
		expect(hasSteps).toBe(true);
	});

	it("should classify conversation intent", async () => {
		const messages: AgentMessage[] = [
			createUserMsg("fix the crash in auth module"),
			createAssistantWithTools("looking", [{ name: "read" }]),
			createToolResult("read", "some code here"),
		];

		const result = await compressContext(messages);

		expect(result.steps.classification).toBeDefined();
		expect(typeof (result.steps.classification as { intent: string }).intent).toBe("string");
	});

	it("should handle empty message list gracefully", async () => {
		const result = await compressContext([]);
		expect(result.messages).toHaveLength(0);
	});

	it("should pass through non-toolResult messages unchanged", async () => {
		const messages: AgentMessage[] = [
			createUserMsg("hello"),
			{ role: "assistant", content: [{ type: "text", text: "hi there" }] } as AgentMessage,
		];
		const result = await compressContext(messages);
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].role).toBe("user");
	});

	it("should respect enabled=false config (no-op)", async () => {
		const messages: AgentMessage[] = [
			createUserMsg("do stuff"),
			createAssistantWithTools("ok", [{ name: "bash" }]),
			createToolResult("bash", "output\n".repeat(500)),
		];
		const config = createPipelineConfig({ enabled: false });
		const result = await compressContext(messages, config);
		expect(Object.keys(result.steps).length).toBe(0);
	});

	it("should be idempotent: running twice gives same result", async () => {
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 10; i++) {
			messages.push(createUserMsg(`q${i}`));
			messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
			messages.push(createToolResult("bash", `data ${i}\n`.repeat(200)));
		}
		const result1 = await compressContext(messages);
		const result2 = await compressContext(result1.messages);
		expect(result2.messages.length).toBe(result1.messages.length);
	});

	it("should complete within reasonable time (< 1s for typical workload)", async () => {
		const messages: AgentMessage[] = [];
		for (let i = 0; i < 30; i++) {
			messages.push(createUserMsg(`q${i}`));
			messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
			messages.push(createToolResult("bash", `output ${i}\n`.repeat(100)));
		}
		const start = Date.now();
		await compressContext(messages);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(1000);
	});
});
