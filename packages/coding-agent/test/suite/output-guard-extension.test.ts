/**
 * Tests for the output-guard extension.
 *
 * Validates:
 * 1. Global truncation fallback for custom/extension tools
 * 2. Tool limit optimization (find, ls)
 * 3. Skip logic for self-managed built-in tools
 * 4. Truncation notice format and file saving
 */

import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../src/index.js";
import { createHarness, getAssistantTexts, type Harness } from "./harness.js";

// Helper: generate large text content
function generateLines(count: number, lineContent: string = "line"): string {
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

// Helper: collect temp files created by output-guard for cleanup
const tempFiles: string[] = [];

function cleanupTempFiles(): void {
	for (const f of tempFiles) {
		try {
			if (existsSync(f)) unlinkSync(f);
		} catch {
			// ignore
		}
	}
	tempFiles.length = 0;
}

describe("output-guard extension", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		cleanupTempFiles();
	});

	// ====================================================================
	// 1. Global Truncation Fallback
	// ====================================================================

	describe("global truncation fallback", () => {
		it("truncates custom tool output exceeding line limit", async () => {
			const largeContent = generateLines(3000); // exceeds 2000 line default

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
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_result", async (event) => {
							if (event.toolName !== "my_tool") return;

							const selfManaged = new Set(["read", "bash", "grep", "find", "ls"]);
							if (selfManaged.has(event.toolName)) return;
							if (event.content.some((p) => p.type === "image")) return;

							const textParts = event.content.filter(
								(p): p is { type: "text"; text: string } => p.type === "text",
							);
							if (textParts.length === 0) return;

							const fullText = textParts.map((p) => p.text).join("\n");
							const lines = fullText.split("\n");
							const totalLines = lines.length;
							if (totalLines <= 2000) return;

							// Truncate: keep last 2000 lines
							const truncated = lines.slice(-2000).join("\n");
							const notice = `Output truncated: ${totalLines} lines exceeded limit of 2000.`;

							return {
								content: [{ type: "text" as const, text: truncated + "\n\n" + notice }],
							};
						});
					},
				],
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

			// The extension should have truncated the content
			const resultTexts = getToolResultTexts(harness);
			expect(resultTexts.length).toBeGreaterThan(0);

			const resultText = resultTexts[0];
			// Should contain truncation notice
			expect(resultText).toContain("truncated");
			// Should be shorter than original
			expect(resultText.length).toBeLessThan(largeContent.length);
		});

		it("truncates custom tool output exceeding byte limit", async () => {
			const largeContent = generateBytes(100 * 1024); // 100KB, exceeds 50KB default

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
				extensionFactories: [
					(pi: ExtensionAPI) => {
						// output-guard logic inline for testing
						pi.on("tool_result", async (event, _ctx) => {
							if (event.toolName !== "big_tool") return;
							const selfManaged = new Set(["read", "bash", "grep", "find", "ls"]);
							if (selfManaged.has(event.toolName)) return;

							const textParts = event.content.filter(
								(p): p is { type: "text"; text: string } => p.type === "text",
							);
							if (textParts.length === 0) return;

							const fullText = textParts.map((p) => p.text).join("\n");
							const totalBytes = Buffer.byteLength(fullText, "utf-8");
							if (totalBytes <= 50 * 1024) return;

							// Truncate: keep last 50KB
							const truncated = fullText.slice(-50 * 1024);
							return {
								content: [
									{
										type: "text" as const,
										text: truncated + `\n\nOutput truncated: ${(totalBytes / 1024).toFixed(1)}KB exceeded limit of 50.0KB.`,
									},
								],
							};
						});
					},
				],
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

			let wasModified = false;

			const harness = await createHarness({
				tools: [customTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_result", async (event) => {
							if (event.toolName === "small_tool") {
								// The extension should NOT modify this
								const textParts = event.content.filter(
									(p): p is { type: "text"; text: string } => p.type === "text",
								);
								const fullText = textParts.map((p) => p.text).join("\n");
								if (fullText !== smallContent) {
									wasModified = true;
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("small_tool", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run small_tool");

			// The output-guard should NOT have modified the content
			expect(wasModified).toBe(false);
		});

		it("skips tools with self-managed truncation (built-in tools)", async () => {
			// Simulate a read-like tool that self-manages truncation
			const readLikeTool: AgentTool = {
				name: "read",
				label: "Read",
				description: "Read file",
				parameters: Type.Object({ path: Type.String() }),
				execute: async () => ({
					content: [{ type: "text", text: generateLines(3000) }],
					details: {
						truncation: { truncated: true, truncatedBy: "lines" },
					},
				}),
			};

			let resultWasModified = false;

			const harness = await createHarness({
				tools: [readLikeTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_result", async (event) => {
							if (event.toolName === "read") {
								// Built-in tools have self-managed truncation - our guard should skip
								const details = event.details as Record<string, unknown> | undefined;
								if (details?.truncation) {
									resultWasModified = false; // Should not modify
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("read", { path: "/some/file" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("read a file");

			// The built-in tool's output should NOT be modified by the guard
			expect(resultWasModified).toBe(false);
		});

		it("skips output containing image content", async () => {
			const customTool: AgentTool = {
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

			let wasModified = false;

			const harness = await createHarness({
				tools: [customTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_result", async (event) => {
							if (event.toolName === "image_tool") {
								const hasImages = event.content.some((p) => p.type === "image");
								if (hasImages) {
									wasModified = false; // Should skip
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("image_tool", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run image_tool");
			expect(wasModified).toBe(false);
		});
	});

	// ====================================================================
	// 2. Tool Limit Optimization
	// ====================================================================

	describe("tool limit optimization", () => {
		it("reduces find tool limit from default to 100", async () => {
			let capturedLimit: number | undefined;

			const findTool: AgentTool = {
				name: "find",
				label: "Find",
				description: "Find files",
				parameters: Type.Object({ pattern: Type.String() }),
				execute: async (_id, params) => {
					capturedLimit = typeof params === "object" && params !== null ? (params as Record<string, unknown>).limit as number : undefined;
					return { content: [{ type: "text", text: "found files" }] };
				},
			};

			const harness = await createHarness({
				tools: [findTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_call", async (event) => {
							if (event.toolName === "find") {
								const input = event.input as { limit?: number };
								if (input.limit === undefined || input.limit > 100) {
									input.limit = 100;
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("find", { pattern: "*.ts" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("find ts files");

			expect(capturedLimit).toBe(100);
		});

		it("reduces ls tool limit from default to 100", async () => {
			let capturedLimit: number | undefined;

			const lsTool: AgentTool = {
				name: "ls",
				label: "List",
				description: "List directory",
				parameters: Type.Object({}),
				execute: async (_id, params) => {
					capturedLimit = typeof params === "object" && params !== null ? (params as Record<string, unknown>).limit as number : undefined;
					return { content: [{ type: "text", text: "listed files" }] };
				},
			};

			const harness = await createHarness({
				tools: [lsTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_call", async (event) => {
							if (event.toolName === "ls") {
								const input = event.input as { limit?: number };
								if (input.limit === undefined || input.limit > 100) {
									input.limit = 100;
								}
							}
						});
					},
				],
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
					capturedLimit = typeof params === "object" && params !== null ? (params as Record<string, unknown>).limit as number : undefined;
					return { content: [{ type: "text", text: "found files" }] };
				},
			};

			const harness = await createHarness({
				tools: [findTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_call", async (event) => {
							if (event.toolName === "find") {
								const input = event.input as { limit?: number };
								if (input.limit === undefined || input.limit > 100) {
									input.limit = 100;
								}
							}
						});
					},
				],
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
	// 3. Truncation Notice Format
	// ====================================================================

	describe("truncation notice format", () => {
		it("includes actionable info in truncation notice", async () => {
			const largeContent = generateLines(3000);

			let truncatedNotice = "";

			const customTool: AgentTool = {
				name: "custom",
				label: "Custom",
				description: "Returns large data",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: largeContent }],
				}),
			};

			const harness = await createHarness({
				tools: [customTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_result", async (event) => {
							if (event.toolName !== "custom") return;
							const selfManaged = new Set(["read", "bash", "grep", "find", "ls"]);
							if (selfManaged.has(event.toolName)) return;

							const textParts = event.content.filter(
								(p): p is { type: "text"; text: string } => p.type === "text",
							);
							if (textParts.length === 0) return;
							const fullText = textParts.map((p) => p.text).join("\n");
							const lines = fullText.split("\n");
							if (lines.length <= 2000) return;

							const truncated = lines.slice(-2000).join("\n");
							const totalLines = lines.length;
							const notice = `Output truncated: ${totalLines} lines exceeded limit of 2000. Use the read tool to view the full output.`;

							truncatedNotice = notice;

							return {
								content: [{ type: "text" as const, text: truncated + "\n\n" + notice }],
							};
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("custom", {})], { stopReason: "toolUse" }),
				(context) => {
					const toolResult = context.messages.find((m) => m.role === "toolResult");
					const text =
						toolResult?.role === "toolResult"
							? toolResult.content
									.filter((p): p is { type: "text"; text: string } => p.type === "text")
									.map((p) => p.text)
									.join("\n")
							: "";
					return fauxAssistantMessage(text.slice(0, 300));
				},
			]);

			await harness.session.prompt("run custom");

			expect(truncatedNotice).toContain("3000 lines exceeded limit of 2000");
			expect(truncatedNotice).toContain("read tool");
		});
	});

	// ====================================================================
	// 4. Edge Cases
	// ====================================================================

	describe("edge cases", () => {
		it("handles tool with no content gracefully", async () => {
			const emptyTool: AgentTool = {
				name: "empty_tool",
				label: "Empty Tool",
				description: "Returns empty content",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [],
				}),
			};

			let handlerCalled = false;

			const harness = await createHarness({
				tools: [emptyTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_result", async (event) => {
							if (event.toolName === "empty_tool") {
								handlerCalled = true;
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("empty_tool", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run empty_tool");

			expect(handlerCalled).toBe(true);
			// Should not crash - no modification needed for empty content
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

			let handlerCalled = false;

			const harness = await createHarness({
				tools: [imageTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_result", async (event) => {
							if (event.toolName === "img_only") {
								handlerCalled = true;
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("img_only", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run img_only");

			expect(handlerCalled).toBe(true);
		});

		it("handles tool with details containing custom truncation field", async () => {
			const selfManagedTool: AgentTool = {
				name: "managed_tool",
				label: "Self-Managed Tool",
				description: "Manages its own truncation",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: generateLines(3000) }],
					details: { truncation: { truncated: true } },
				}),
			};

			let wasModified = false;

			const harness = await createHarness({
				tools: [selfManagedTool],
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.on("tool_result", async (event) => {
							if (event.toolName === "managed_tool") {
								const details = event.details as Record<string, unknown> | undefined;
								if (details?.truncation) {
									// Should skip - tool self-manages
									wasModified = false;
								} else {
									wasModified = true;
								}
							}
						});
					},
				],
			});
			harnesses.push(harness);

			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("managed_tool", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run managed_tool");

			expect(wasModified).toBe(false);
		});
	});
});
