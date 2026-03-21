/**
 * Search Tool for Lossless Memory Extension
 *
 * Implements pi_memory_search tool for keyword and semantic search.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { DAGManager } from "./dag-manager.js";
import type { MemoryDatabase } from "./database.js";
import type { LosslessMemoryConfig, SearchToolInput, SearchToolOutput } from "./types.js";

// ============================================================================
// Search Tool Class
// ============================================================================

export class SearchTool {
	private pi: ExtensionAPI;
	private db: MemoryDatabase;
	private dag: DAGManager;
	private config: LosslessMemoryConfig;

	constructor(pi: ExtensionAPI, db: MemoryDatabase, dag: DAGManager, config: LosslessMemoryConfig) {
		this.pi = pi;
		this.db = db;
		this.dag = dag;
		this.config = config;
	}

	// ============================================================================
	// Tool Registration
	// ============================================================================

	/**
	 * Register the search tool with pi
	 */
	register(): void {
		this.pi.registerTool({
			name: "pi_memory_search",
			label: "搜索历史记忆",
			description: "在历史对话中搜索关键词，返回相关摘要和原文链接。支持 FTS5 全文搜索和语义搜索。",
			parameters: Type.Object({
				query: Type.String({ description: "搜索关键词" }),
				maxResults: Type.Optional(Type.Number({ description: "最大结果数", default: 5 })),
				minLevel: Type.Optional(Type.Number({ description: "最小摘要层级 (0=原文，1=L1, 2=L2...)", default: 0 })),
				sessionId: Type.Optional(Type.String({ description: "会话 ID (可选，默认当前会话)" })),
			}),
			renderCall: (args, theme) => {
				const { Text } = require("@mariozechner/pi-tui") as typeof import("@mariozechner/pi-tui");
				let text = theme.fg("toolTitle", theme.bold("pi_memory_search "));
				text += theme.fg("muted", `"${args.query}"`);
				if (args.maxResults) {
					text += theme.fg("dim", ` (最多${args.maxResults}条)`);
				}
				return new Text(text, 0, 0);
			},
			renderResult: (result, { expanded, isPartial }, theme) => {
				const { Text } = require("@mariozechner/pi-tui") as typeof import("@mariozechner/pi-tui");

				if (isPartial) {
					return new Text(theme.fg("warning", "搜索中..."), 0, 0);
				}

				const output = result.details as SearchToolOutput | undefined;
				if (!output || output.totalFound === 0) {
					return new Text(theme.fg("muted", "未找到相关记忆"), 0, 0);
				}

				let text = theme.fg("success", `✓ 找到 ${output.totalFound} 个相关记忆`);

				if (expanded && output.results.length > 0) {
					text += "\n\n";
					for (const r of output.results) {
						text += theme.fg("accent", `├─ [L${r.level}] ${r.summary.slice(0, 80)}...\n`);
						text += theme.fg("dim", `   会话：${r.sessionId.slice(0, 8)}... | 分数：${r.score.toFixed(3)}\n`);
					}
					text += theme.fg("muted", "\n使用 pi_memory_expand 查看详细原文");
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
	 * Execute the search tool
	 */
	async execute(
		toolCallId: string,
		params: SearchToolInput,
		signal: AbortSignal | undefined,
		onUpdate: any,
		ctx: any,
	): Promise<any> {
		const { query, maxResults = 5, minLevel = 0, sessionId } = params;

		try {
			// Perform search
			const results = this.db.search({
				query,
				sessionId: sessionId || ctx.sessionManager?.getSessionFile?.(),
				limit: maxResults,
				minLevel,
			});

			if (results.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `未找到与 "${query}" 相关的记忆。`,
						},
					],
					details: {
						query,
						results: [],
						totalFound: 0,
					} as SearchToolOutput,
				};
			}

			// Format results
			const output: SearchToolOutput = {
				query,
				totalFound: results.length,
				results: results.map((r) => ({
					nodeId: r.node.id,
					level: r.node.level,
					summary: r.node.content.slice(0, 200) + (r.node.content.length > 200 ? "..." : ""),
					sessionId: r.node.sessionId,
					createdAt: r.node.createdAt,
					score: r.score.combined,
					entryIds: r.node.sessionEntryIds,
				})),
			};

			// Build response text
			let responseText = `找到 ${output.totalFound} 个相关记忆:\n\n`;

			for (let i = 0; i < output.results.length; i++) {
				const r = output.results[i];
				responseText += `---\n`;
				responseText += `[${i + 1}] 层级 L${r.level} (相关度：${r.score.toFixed(3)})\n`;
				responseText += `摘要：${r.summary}\n`;
				responseText += `关联条目：${r.entryIds.join(", ")}\n`;
				responseText += `会话：${r.sessionId}\n`;
				responseText += `时间：${new Date(r.createdAt).toLocaleString("zh-CN")}\n`;
				responseText += `使用 pi_memory_expand 节点 ID: ${r.nodeId} 查看详细原文\n\n`;
			}

			responseText += `\n提示：`;
			responseText += `\n- 使用 pi_memory_expand <nodeId> 展开摘要查看原始消息`;
			responseText += `\n- 使用 pi_memory_stats 查看记忆统计信息`;

			return {
				content: [
					{
						type: "text",
						text: responseText,
					},
				],
				details: output,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				content: [
					{
						type: "text",
						text: `搜索失败：${errorMessage}`,
						isError: true,
					},
				],
			};
		}
	}

	// ============================================================================
	// Additional Search Utilities
	// ============================================================================

	/**
	 * Quick search without tool call overhead
	 */
	async quickSearch(query: string, limit: number = 3): Promise<string> {
		try {
			const results = this.db.search({
				query,
				limit,
				minLevel: 1, // Prefer summaries over originals
			});

			if (results.length === 0) {
				return "未找到相关记忆。";
			}

			return results
				.map((r) => `[L${r.node.level}] ${r.node.content.slice(0, 100)}${r.node.content.length > 100 ? "..." : ""}`)
				.join("\n");
		} catch (error) {
			return "搜索出错：" + (error instanceof Error ? error.message : String(error));
		}
	}
}

// ============================================================================
// Stats Tool (Bonus)
// ============================================================================

export class StatsTool {
	private pi: ExtensionAPI;
	private db: MemoryDatabase;
	private dag: DAGManager;

	constructor(pi: ExtensionAPI, db: MemoryDatabase, dag: DAGManager) {
		this.pi = pi;
		this.db = db;
		this.dag = dag;
	}

	register(): void {
		this.pi.registerTool({
			name: "pi_memory_stats",
			label: "记忆统计",
			description: "查看当前会话的记忆 DAG 统计信息",
			parameters: Type.Object({}),
			renderCall: (args, theme) => {
				const { Text } = require("@mariozechner/pi-tui") as typeof import("@mariozechner/pi-tui");
				return new Text(theme.fg("toolTitle", theme.bold("pi_memory_stats")), 0, 0);
			},
			renderResult: (result, { expanded, isPartial }, theme) => {
				const { Text } = require("@mariozechner/pi-tui") as typeof import("@mariozechner/pi-tui");

				if (isPartial) {
					return new Text(theme.fg("warning", "加载中..."), 0, 0);
				}

				const details = result.details as any;
				if (!details) {
					return new Text(theme.fg("error", "获取统计失败"), 0, 0);
				}

				let text = theme.fg("success", "✓ 记忆统计\n");
				text += theme.fg(
					"dim",
					`${details.nodeCount} 节点 | ${details.maxLevel} 层 | ${details.totalTokens} tokens`,
				);

				return new Text(text, 0, 0);
			},
			execute: this.execute.bind(this),
		});
	}

	async execute(
		toolCallId: string,
		_params: any,
		_signal: AbortSignal | undefined,
		_onUpdate: any,
		ctx: any,
	): Promise<any> {
		try {
			const sessionId = ctx.sessionManager?.getSessionFile?.() || "unknown";
			const stats = this.dag.getStats();
			const dbStats = this.db.getStats();

			const rootNodes = this.dag.getRootNodes();
			const rootSummary = rootNodes.length > 0 ? rootNodes[0].content.slice(0, 100) + "..." : "无";

			const output = {
				sessionId,
				nodeCount: stats.nodeCount,
				maxLevel: stats.maxLevel,
				rootCount: stats.rootCount,
				totalTokens: stats.totalTokens,
				entryCoverage: stats.entryCoverage,
				rootSummary,
				dbNodeCount: dbStats.nodeCount,
				dbSessionCount: dbStats.sessionCount,
			};

			let responseText = `记忆 DAG 统计:\n\n`;
			responseText += `会话：${sessionId}\n`;
			responseText += `节点数：${output.nodeCount}\n`;
			responseText += `最大层级：L${output.maxLevel}\n`;
			responseText += `根节点数：${output.rootCount}\n`;
			responseText += `总 Token 数：${output.totalTokens}\n`;
			responseText += `条目覆盖率：${output.entryCoverage}\n`;
			responseText += `\n根摘要：${output.rootSummary}\n`;
			responseText += `\n数据库统计:`;
			responseText += `\n  总节点：${output.dbNodeCount}`;
			responseText += `\n  总会话：${output.dbSessionCount}`;

			return {
				content: [{ type: "text", text: responseText }],
				details: output,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `获取统计失败：${errorMessage}`, isError: true }],
			};
		}
	}
}
