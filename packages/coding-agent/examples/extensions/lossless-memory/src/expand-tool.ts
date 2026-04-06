/**
 * Expand Tool for Lossless Memory Extension
 *
 * Implements pi_memory_expand tool for expanding summary nodes to original messages.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { DAGManager } from "./dag-manager.js";
import type { MemoryDatabase } from "./database.js";
import type { ExpandToolInput, ExpandToolOutput } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_MAX_DEPTH = 5;

// ============================================================================
// Expand Tool Class
// ============================================================================

export class ExpandTool {
	private pi: ExtensionAPI;
	private dag: DAGManager;
	private db: MemoryDatabase;

	constructor(pi: ExtensionAPI, db: MemoryDatabase, dag: DAGManager) {
		this.pi = pi;
		this.db = db;
		this.dag = dag;
	}

	// ============================================================================
	// Tool Registration
	// ============================================================================

	/**
	 * Register the expand tool with pi
	 */
	register(): void {
		this.pi.registerTool({
			name: "pi_memory_expand",
			label: "展开记忆摘要",
			description: "将摘要节点沿 DAG 链路向下展开，恢复原始消息详情（默认最多 2000 tokens）",
			parameters: Type.Object({
				nodeId: Type.String({ description: "摘要节点 ID" }),
				maxDepth: Type.Optional(Type.Number({ description: "最大展开深度", default: 5 })),
				maxTokens: Type.Optional(Type.Number({ description: "最大输出 token 数", default: 2000 })),
			}),
			renderCall: (args, theme) => {
				const { Text } = require("@mariozechner/pi-tui") as typeof import("@mariozechner/pi-tui");
				let text = theme.fg("toolTitle", theme.bold("pi_memory_expand "));
				text += theme.fg("muted", `${args.nodeId.slice(0, 8)}...`);
				if (args.maxDepth) {
					text += theme.fg("dim", ` (深度:${args.maxDepth})`);
				}
				return new Text(text, 0, 0);
			},
			renderResult: (result, { expanded, isPartial }, theme) => {
				const { Text } = require("@mariozechner/pi-tui") as typeof import("@mariozechner/pi-tui");

				if (isPartial) {
					return new Text(theme.fg("warning", "展开中..."), 0, 0);
				}

				const output = result.details as ExpandToolOutput | undefined;
				if (!output || !output.expanded) {
					return new Text(theme.fg("error", "展开失败"), 0, 0);
				}

				let text = theme.fg("success", `✓ 已展开 ${output.originalMessages.length} 条原始消息`);

				if (output.truncated) {
					text += theme.fg("warning", ` (已截断，共${output.totalTokens} tokens)`);
				} else {
					text += theme.fg("dim", ` (${output.totalTokens} tokens)`);
				}

				if (expanded && output.originalMessages.length > 0) {
					text += "\n\n";
					for (const msg of output.originalMessages.slice(0, 5)) {
						text += theme.fg("dim", `├─ [${msg.role}] ${msg.content.slice(0, 60)}...\n`);
					}
					if (output.originalMessages.length > 5) {
						text += theme.fg("muted", `   ... 还有 ${output.originalMessages.length - 5} 条\n`);
					}
				}

				return new Text(text, 0, 0);
			},
			execute: this.execute.bind(this),
		});
	}

	// ============================================================================
	// Tool Execution
	// ============================================================================

	/**
	 * Execute the expand tool
	 */
	async execute(
		_toolCallId: string,
		params: ExpandToolInput,
		_signal: AbortSignal | undefined,
		_onUpdate: any,
		_ctx: any,
	): Promise<any> {
		const { nodeId, maxDepth = DEFAULT_MAX_DEPTH, maxTokens = DEFAULT_MAX_TOKENS } = params;

		try {
			// Get the node
			const node = this.dag.getNode(nodeId);
			if (!node) {
				return {
					content: [
						{
							type: "text",
							text: `未找到节点：${nodeId}`,
							isError: true,
						},
					],
				};
			}

			// Trace down to original messages
			const originalNodes = await this.dag.traceToOriginals(nodeId, maxDepth);

			if (originalNodes.length === 0) {
				// This node might already be an original message
				return {
					content: [
						{
							type: "text",
							text: `节点 ${nodeId} 没有子节点，可能已经是原始消息。\n\n内容:\n${node.content}`,
						},
					],
					details: {
						nodeId,
						expanded: true,
						originalMessages: [
							{
								entryId: node.sessionEntryIds[0] || "unknown",
								role: "unknown",
								content: node.content,
							},
						],
						truncated: false,
						totalTokens: node.tokenCount,
					} as ExpandToolOutput,
				};
			}

			// Build original messages list
			const originalMessages = originalNodes.map((n) => ({
				entryId: n.sessionEntryIds[0] || "unknown",
				role: this.guessRole(n.content),
				content: n.content,
			}));

			// Calculate total tokens
			const totalTokens = originalMessages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);

			// Check if truncation is needed
			let truncated = false;
			let displayMessages = originalMessages;

			if (totalTokens > maxTokens) {
				truncated = true;
				// Keep messages from the end (most recent)
				let currentTokens = 0;
				displayMessages = [];

				for (let i = originalMessages.length - 1; i >= 0; i--) {
					const msgTokens = this.estimateTokens(originalMessages[i].content);
					if (currentTokens + msgTokens <= maxTokens) {
						displayMessages.unshift(originalMessages[i]);
						currentTokens += msgTokens;
					} else {
						break;
					}
				}
			}

			// Build response text
			let responseText = `展开节点 ${nodeId.slice(0, 8)}... 的原始消息:\n\n`;
			responseText += `摘要层级：L${node.level}\n`;
			responseText += `找到原始节点：${originalNodes.length} 个\n`;
			responseText += `总 Token 数：${totalTokens}\n`;

			if (truncated) {
				responseText += `显示 Token 数：${displayMessages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0)} (已截断)\n`;
			}

			responseText += `\n---\n\n`;

			for (let i = 0; i < displayMessages.length; i++) {
				const msg = displayMessages[i];
				responseText += `[${i + 1}] [${msg.role}]\n`;
				responseText += `${msg.content}\n\n`;
				responseText += `---\n\n`;
			}

			if (truncated) {
				responseText += `\n[输出已截断，共 ${originalMessages.length - displayMessages.length} 条消息未显示]`;
			}

			if (originalNodes.length > 0) {
				responseText += `\n\n提示：`;
				responseText += `\n- 使用会话 ID 查看具体条目：/session`;
				responseText += `\n- 节点关联条目：${originalNodes[0].sessionEntryIds.join(", ")}`;
			}

			return {
				content: [
					{
						type: "text",
						text: responseText,
					},
				],
				details: {
					nodeId,
					expanded: true,
					originalMessages: displayMessages,
					truncated,
					totalTokens: displayMessages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0),
				} as ExpandToolOutput,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				content: [
					{
						type: "text",
						text: `展开失败：${errorMessage}`,
						isError: true,
					},
				],
			};
		}
	}

	// ============================================================================
	// Utilities
	// ============================================================================

	/**
	 * Guess message role from content
	 */
	private guessRole(content: string): string {
		const lower = content.toLowerCase();
		if (lower.startsWith("[用户]") || lower.startsWith("user:")) {
			return "user";
		}
		if (lower.startsWith("[助手]") || lower.startsWith("assistant:")) {
			return "assistant";
		}
		if (lower.startsWith("[工具]") || lower.startsWith("tool:") || lower.includes("工具执行")) {
			return "toolResult";
		}
		return "unknown";
	}

	/**
	 * Estimate token count
	 */
	private estimateTokens(text: string): number {
		// Rough estimation: 1 token ≈ 4 characters for English, 2 for Chinese
		const avgCharPerToken = text.match(/[\u4e00-\u9fa5]/) ? 2 : 4;
		return Math.ceil(text.length / avgCharPerToken);
	}

	// ============================================================================
	// Quick Expand (for internal use)
	// ============================================================================

	/**
	 * Quick expand without tool call overhead
	 */
	async quickExpand(nodeId: string, maxTokens: number = 1000): Promise<string> {
		try {
			const node = this.dag.getNode(nodeId);
			if (!node) {
				return `节点不存在：${nodeId}`;
			}

			// If it's already a leaf node, return content
			if (node.childIds.length === 0) {
				return this.truncateText(node.content, maxTokens);
			}

			// Trace to originals
			const originals = await this.dag.traceToOriginals(nodeId, 3);

			if (originals.length === 0) {
				return this.truncateText(node.content, maxTokens);
			}

			// Concatenate original messages
			const content = originals.map((o) => o.content).join("\n\n");
			return this.truncateText(content, maxTokens);
		} catch (error) {
			return `展开出错：${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Truncate text to token limit
	 */
	private truncateText(text: string, maxTokens: number): string {
		const tokens = this.estimateTokens(text);
		if (tokens <= maxTokens) {
			return text;
		}

		// Simple character-based truncation
		const avgCharPerToken = text.match(/[\u4e00-\u9fa5]/) ? 2 : 4;
		const maxChars = maxTokens * avgCharPerToken;

		if (text.length <= maxChars) {
			return text;
		}

		return `${text.slice(0, maxChars)}\n\n[内容已截断...]`;
	}
}
