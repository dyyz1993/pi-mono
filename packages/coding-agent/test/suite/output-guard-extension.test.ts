/**
 * Tests for the output-guard extension.
 *
 * Imports the REAL extension from extensions/output-guard/index.ts
 * and tests its actual behavior via the harness + faux provider.
 *
 * Validates:
 * 1. Global truncation fallback for custom/extension tools (via real extension)
 * 2. Tool limit optimization - find/ls limit capping (via real extension)
 * 3. Skip logic for self-managed built-in tools
 * 4. Edge cases: empty content, image content, self-managed details
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import outputGuardFactory from "../../extensions/output-guard/index.js";
import { createHarness, type Harness } from "./harness.js";

// Helper: generate large text content
function generateLines(count: number, lineContent = "line"): string {
	return Array.from({ length: count }, (_, i) => `${lineContent} ${i}`).join("\n");
}

function generateBytes(size: number): string {
	return "x".repeat(size);
}

// Helper: extract tool result text from session messages
function getToolResultTexts(harness: Harness): string[] {
	return harness.session.messages
		.filter((m) => m.role === "toolResult")
		.flatMap((m) =>
			m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text),
		);
}

describe("output-guard extension (real extension import)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	// ====================================================================
	// 1. Global Truncation Fallback (using real output-guard extension)
	// ====================================================================

	describe("global truncation fallback", () => {
		it("truncates custom tool output exceeding 2000 lines", async () => {
			const largeContent = generateLines(3000);

			const customTool: AgentTool = {
				name: "my_tool",
				label: "My Tool",
				description: "Returns lots of data",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: largeContent }],
				}),
			};

			const harness = await createHarness({
				tools: [customTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("my_tool", {})], { stopReason: "toolUse" }),
				(context) => {
					const toolResult = context.messages.find((m) => m.role === "toolResult");
					const text =
						toolResult?.role === "toolResult"
							? toolResult.content
									.filter((p): p is { type: "text"; text: string } => p.type === "text")
									.map((p) => p.text)
									.join("\n")
							: "";
					return fauxAssistantMessage(text.slice(0, 200));
				},
			]);

			await harness.session.prompt("run my_tool");

			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts.length).toBeGreaterThan(0);

			const resultText = resultTexts[0];
			// The real extension should have truncated the content
			expect(resultText).toContain("truncated");
			expect(resultText.length).toBeLessThan(largeContent.length);
			// Should contain actionable file path hint
			expect(resultText).toContain("Full output saved to:");
		});

		it("truncates custom tool output exceeding 50KB bytes", async () => {
			const largeContent = generateBytes(100 * 1024); // 100KB

			const customTool: AgentTool = {
				name: "big_tool",
				label: "Big Tool",
				description: "Returns lots of bytes",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: largeContent }],
				}),
			};

			const harness = await createHarness({
				tools: [customTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("big_tool", {})], { stopReason: "toolUse" }),
				(context) => {
					const toolResult = context.messages.find((m) => m.role === "toolResult");
					const text =
						toolResult?.role === "toolResult"
							? toolResult.content
									.filter((p): p is { type: "text"; text: string } => p.type === "text")
									.map((p) => p.text)
									.join("\n")
							: "";
					return fauxAssistantMessage(text.slice(0, 100));
				},
			]);

			await harness.session.prompt("run big_tool");

			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts.length).toBeGreaterThan(0);
			expect(resultTexts[0]).toContain("truncated");
			expect(resultTexts[0]).toContain("KB");
		});

		it("does NOT truncate output within limits", async () => {
			const smallContent = generateLines(100);

			const customTool: AgentTool = {
				name: "small_tool",
				label: "Small Tool",
				description: "Returns little data",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: smallContent }],
				}),
			};

			const harness = await createHarness({
				tools: [customTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("small_tool", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run small_tool");

			// Content should be unchanged
			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts[0]).toBe(smallContent);
		});

		it("saves truncated output to disk with correct structure", async () => {
			const largeContent = generateLines(3000);

			const customTool: AgentTool = {
				name: "disk_tool",
				label: "Disk Tool",
				description: "Returns lots of data",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: largeContent }],
				}),
			};

			const harness = await createHarness({
				tools: [customTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("disk_tool", {})], { stopReason: "toolUse" }),
				(context) => {
					const toolResult = context.messages.find((m) => m.role === "toolResult");
					const text =
						toolResult?.role === "toolResult"
							? toolResult.content
									.filter((p): p is { type: "text"; text: string } => p.type === "text")
									.map((p) => p.text)
									.join("\n")
							: "";
					return fauxAssistantMessage(text.slice(0, 500));
				},
			]);

			await harness.session.prompt("run disk_tool");

			const resultTexts = getToolResultTexts(harness);
			const resultText = resultTexts[0];

			// Should contain truncation notice
			expect(resultText).toContain("truncated");

			// The extension should have saved the full output somewhere.
			const pathMatch = resultText.match(/Full output saved to: (.+)/);
			expect(pathMatch).not.toBeNull();

			const savedPath = pathMatch![1].trim();

			// Check file exists BEFORE harness cleanup
			expect(savedPath).toMatch(/^\//); // Should be absolute path
			expect(existsSync(savedPath)).toBe(true);

			// Verify saved content is the original (not truncated)
			const { readFileSync } = await import("node:fs");
			const savedContent = readFileSync(savedPath, "utf-8");
			expect(savedContent).toBe(largeContent);
		});
	});

	// ====================================================================
	// 2. Tool Limit Optimization (using real output-guard extension)
	// ====================================================================

	describe("tool limit optimization", () => {
		it("caps find tool limit to 100", async () => {
			let capturedLimit: number | undefined;

			const findTool: AgentTool = {
				name: "find",
				label: "Find",
				description: "Find files",
				parameters: Type.Object({ pattern: Type.String() }),
				execute: async (_id, params) => {
					capturedLimit =
						typeof params === "object" && params !== null
							? ((params as Record<string, unknown>).limit as number)
							: undefined;
					return { content: [{ type: "text", text: "found files" }] };
				},
			};

			const harness = await createHarness({
				tools: [findTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("find", { pattern: "*.ts" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("find ts files");

			expect(capturedLimit).toBe(100);
		});

		it("caps ls tool limit to 100", async () => {
			let capturedLimit: number | undefined;

			const lsTool: AgentTool = {
				name: "ls",
				label: "List",
				description: "List directory",
				parameters: Type.Object({}),
				execute: async (_id, params) => {
					capturedLimit =
						typeof params === "object" && params !== null
							? ((params as Record<string, unknown>).limit as number)
							: undefined;
					return { content: [{ type: "text", text: "listed files" }] };
				},
			};

			const harness = await createHarness({
				tools: [lsTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("ls", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("list files");

			expect(capturedLimit).toBe(100);
		});

		it("respects explicit lower limits set by the model", async () => {
			let capturedLimit: number | undefined;

			const findTool: AgentTool = {
				name: "find",
				label: "Find",
				description: "Find files",
				parameters: Type.Object({ pattern: Type.String() }),
				execute: async (_id, params) => {
					capturedLimit =
						typeof params === "object" && params !== null
							? ((params as Record<string, unknown>).limit as number)
							: undefined;
					return { content: [{ type: "text", text: "found files" }] };
				},
			};

			const harness = await createHarness({
				tools: [findTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			// Model explicitly sets limit=50 (below our cap of 100)
			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("find", { pattern: "*.ts", limit: 50 })], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("find ts files with limit 50");

			// Should NOT override the explicit lower limit
			expect(capturedLimit).toBe(50);
		});
	});

	// ====================================================================
	// 3. Skip Logic (using real output-guard extension)
	// ====================================================================

	describe("skip logic", () => {
		it("skips built-in read tool (self-managed truncation)", async () => {
			const largeContent = generateLines(3000);

			// Simulate the real read tool which sets details.truncation
			const readTool: AgentTool = {
				name: "read",
				label: "Read",
				description: "Read file",
				parameters: Type.Object({ path: Type.String() }),
				execute: async () => ({
					content: [{ type: "text", text: largeContent }],
					details: {
						truncation: { truncated: true, truncatedBy: "lines" },
					},
				}),
			};

			const harness = await createHarness({
				tools: [readTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("read", { path: "/some/file" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("read a file");

			// The real extension should NOT have modified read tool's output
			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts[0]).toBe(largeContent);
		});

		it("skips output containing image content", async () => {
			const imageTool: AgentTool = {
				name: "image_tool",
				label: "Image Tool",
				description: "Returns image + text",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [
						{ type: "text", text: "Here is the image:" },
						{ type: "image", data: "base64data...", mimeType: "image/png" },
					],
				}),
			};

			const harness = await createHarness({
				tools: [imageTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("image_tool", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run image_tool");

			// Content should be unchanged (not truncated)
			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts[0]).toBe("Here is the image:");
		});

		it("skips tool with details.truncation field (custom tool opt-in)", async () => {
			const largeContent = generateLines(3000);

			const selfManagedTool: AgentTool = {
				name: "custom_managed",
				label: "Custom Managed",
				description: "Manages its own truncation",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: largeContent }],
					details: { truncation: { truncated: true } },
				}),
			};

			const harness = await createHarness({
				tools: [selfManagedTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("custom_managed", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run custom_managed");

			// Should NOT have been truncated
			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts[0]).toBe(largeContent);
		});
	});

	// ====================================================================
	// 4. Edge Cases (using real output-guard extension)
	// ====================================================================

	describe("edge cases", () => {
		it("handles tool with empty content without crashing", async () => {
			const emptyTool: AgentTool = {
				name: "empty_tool",
				label: "Empty Tool",
				description: "Returns empty content",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [],
				}),
			};

			const harness = await createHarness({
				tools: [emptyTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("empty_tool", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run empty_tool");

			// Should not crash
			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts.length).toBe(0);
		});

		it("handles tool returning only image content", async () => {
			const imageTool: AgentTool = {
				name: "img_only",
				label: "Image Only",
				description: "Returns only image",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "image", data: "base64...", mimeType: "image/png" }],
				}),
			};

			const harness = await createHarness({
				tools: [imageTool],
				extensionFactories: [outputGuardFactory],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("img_only", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run img_only");

			// Should not crash, no text results
			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts.length).toBe(0);
		});
	});
});
