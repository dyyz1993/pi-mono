/**
 * L3: Zero-cost Structured Summary - TDD Tests
 *
 * Tests deterministic structured extraction from tool results
 * without any LLM calls. Pure pattern-based summarization.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_SUMMARY_CONFIG,
	type StructuredNote,
	type SummaryConfig,
} from "../../src/core/context-compression/types.js";

// Dynamic import for the module under test (handles compile errors gracefully)
let summarizeToolResult: (toolName: string, content: string, config?: SummaryConfig) => StructuredNote;
let applySummary: (
	messages: AgentMessage[],
	config?: SummaryConfig,
) => Promise<{ messages: AgentMessage[]; summarizedCount: number; tokensBefore: number; tokensAfter: number }>;

try {
	const mod = await import("../../src/core/context-compression/summary.js");
	summarizeToolResult = mod.summarizeToolResult;
	applySummary = mod.applySummary;
} catch {
	summarizeToolResult = () => {
		throw new Error("summary.ts not implemented yet");
	};
	applySummary = async () => {
		throw new Error("summary.ts not implemented yet");
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

function createConfig(overrides?: Partial<SummaryConfig>): SummaryConfig {
	return { ...DEFAULT_SUMMARY_CONFIG, ...overrides };
}

// ============================================================================
// Tests
// ============================================================================

describe("L3: Zero-cost Structured Summary", () => {
	describe("summarizeToolResult - single result extraction", () => {
		it("should extract headline and metadata from read results", () => {
			const content = `import React from "react";
export function App() {
  return <div>Hello</div>;
}
export default App;`;
			const note = summarizeToolResult("read", content);

			expect(note.headline).toContain("read");
			expect(note.originalSize).toBe(Buffer.byteLength(content, "utf-8"));
			expect(note.metadata).toBeDefined();
			expect(note.formatted).toContain("[summarized]");
		});

		it("should handle grep results with match counting", () => {
			const lines = [];
			for (let i = 0; i < 50; i++) {
				lines.push(`src/file${Math.floor(i / 10)}.ts:${i + 1}: match ${i}`);
			}
			const content = lines.join("\n");
			const note = summarizeToolResult("grep", content);

			expect(note.headline).toContain("grep");
			expect(note.metadata.matchCount || note.metadata.matches).toBeDefined();
			expect(note.samples.length).toBeGreaterThan(0);
			expect(note.samples.length).toBeLessThanOrEqual(createConfig().maxLines);
		});

		it("should handle bash results with exit code detection", () => {
			const content = `Building...
Done in 2.3s
Output size: 1.2MB`;
			const note = summarizeToolResult("bash", content);

			expect(note.headline).toContain("bash");
			expect(note.formatted.length).toBeLessThan(content.length);
		});

		it("should handle glob/find results with file listing", () => {
			const files = [];
			for (let i = 0; i < 100; i++) {
				files.push(`src/components/Component${i}.tsx`);
			}
			const content = files.join("\n");
			const note = summarizeToolResult("glob", content);

			expect(note.metadata.fileCount || note.metadata.count).toBeDefined();
			expect(note.formatted.length).toBeLessThan(content.length);
		});

		it("should handle git log output with commit extraction", () => {
			const content = `abc1234 (HEAD -> main) Fix login bug
def5678 Add user profile
ghi9012 Refactor auth module
jkl3456 Update dependencies`;
			const note = summarizeToolResult("git_log", content);

			expect(note.headline).toContain("git_log");
			expect(note.metadata.commitCount || note.metadata.commits).toBeDefined();
		});

		it("should handle git diff output with stats extraction", () => {
			const content = `diff --git a/src/app.ts b/src/app.ts
index abc123..def456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,7 @@ import { foo } from "./foo";
+import { bar } from "./bar";
 
 export function run() {
-  console.log("old");
+  console.log("new");
   return true;
 }
 `;
			const note = summarizeToolResult("git_diff", content);

			expect(note.headline).toContain("git_diff");
			expect(note.metadata.filesChanged || note.metadata.files).toBeDefined();
		});

		it("should produce summary significantly smaller than original for large content", () => {
			const lines = [];
			for (let i = 0; i < 500; i++) {
				lines.push(`Line ${i}: This is a long line of content that represents typical tool output data`);
			}
			const content = lines.join("\n");
			const note = summarizeToolResult("bash", content);

			// Summary should be at least 80% smaller
			const reduction = 1 - note.formatted.length / content.length;
			expect(reduction).toBeGreaterThan(0.8);
		});

		it("should preserve key information in samples (head+tail)", () => {
			const lines = [];
			for (let i = 0; i < 100; i++) {
				lines.push(`line ${i}: content_${i}`);
			}
			const content = lines.join("\n");
			const config = createConfig({ maxLines: 10 });
			const note = summarizeToolResult("read", content, config);

			// Should have first few and last few lines
			expect(note.samples.some((s) => s.includes("line 0"))).toBe(true);
			expect(note.samples.some((s) => s.includes("line 99"))).toBe(true);
			expect(note.samples.length).toBeLessThanOrEqual(config.maxLines);
		});

		it("should handle empty content gracefully", () => {
			const note = summarizeToolResult("bash", "");
			expect(note.headline).toBeDefined();
			expect(note.originalSize).toBe(0);
		});

		it("should handle single-line content without error", () => {
			const note = summarizeToolResult("bash", "hello world");
			expect(note.formatted).toBeDefined();
			expect(note.formatted.length).toBeGreaterThan(0);
		});
	});

	describe("applySummary - message-level summarization", () => {
		it("should summarize all toolResult messages in a conversation", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("read this file"),
				createAssistantWithTools("ok", [{ name: "read" }]),
				createToolResult("read", "line 1\nline 2\n".repeat(200)),
				createUserMsg("now search"),
				createAssistantWithTools("searching", [{ name: "grep" }]),
				createToolResult("grep", "match at line 10\n".repeat(100)),
			];

			const result = await applySummary(messages);

			expect(result.summarizedCount).toBe(2);
			expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
		});

		it("should skip non-toolResult messages", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("hello"),
				{ role: "assistant", content: [{ type: "text", text: "hi there" }] } as AgentMessage,
			];

			const result = await applySummary(messages);

			expect(result.summarizedCount).toBe(0);
			expect(result.messages).toHaveLength(2);
		});

		it("should skip already-summarized messages (idempotent)", async () => {
			const largeContent = "data\n".repeat(500);
			const messages: AgentMessage[] = [
				createUserMsg("run this"),
				createAssistantWithTools("running", [{ name: "bash" }]),
				createToolResult("bash", largeContent),
			];

			const result1 = await applySummary(messages);
			const result2 = await applySummary(result1.messages);

			expect(result2.summarizedCount).toBe(0);
			expect(result2.tokensAfter).toBe(result1.tokensAfter);
		});

		it("should respect enabled=false config", async () => {
			const messages: AgentMessage[] = [
				createUserMsg("do it"),
				createAssistantWithTools("ok", [{ name: "bash" }]),
				createToolResult("bash", "output\n".repeat(100)),
			];

			const result = await applySummary(messages, { ...createConfig(), enabled: false });

			expect(result.summarizedCount).toBe(0);
			expect(result.tokensAfter).toBe(result.tokensBefore);
		});

		it("should estimate token savings correctly", async () => {
			const messages: AgentMessage[] = [];
			for (let i = 0; i < 5; i++) {
				messages.push(createUserMsg(`q${i}`));
				messages.push(createAssistantWithTools(`a${i}`, [{ name: "bash" }]));
				messages.push(createToolResult("bash", `data${i}\n`.repeat(300)));
			}

			const result = await applySummary(messages);

			expect(result.tokensBefore).toBeGreaterThan(0);
			expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
			const savings = result.tokensBefore - result.tokensAfter;
			expect(savings).toBeGreaterThan(100); // Should save meaningful tokens
		});
	});
});
