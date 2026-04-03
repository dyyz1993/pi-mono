/**
 * Lossless Memory Extension for Pi Coding Agent
 *
 * A DAG-based lossless context management system inspired by Lossless Claw.
 * Provides hierarchical summarization, full-text search, and memory tracing.
 *
 * @module lossless-memory
 */

import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DAGManager } from "./dag-manager.js";
import { MemoryDatabase } from "./database.js";
import { ExpandTool } from "./expand-tool.js";
import { SearchTool, StatsTool } from "./search-tool.js";
import { SummaryGenerator } from "./summary-generator.js";
import type { LosslessMemoryConfig, MemoryNode } from "./types.js";

const TRACE_FILE = "/tmp/lossless-context-trace.jsonl";

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LosslessMemoryConfig = {
	enabled: true,
	database: {
		path: "~/.pi/agent/lossless-memory.db",
		enableFTS5: true,
		enableVectors: false,
	},
	summary: {
		provider: "openai",
		model: "gpt-4o-mini",
		maxTokens: 300,
		compressionRatio: 8,
	},
	search: {
		keywordWeight: 0.7,
		semanticWeight: 0.3,
		defaultLimit: 5,
	},
	performance: {
		cacheEmbeddings: true,
		batchSize: 32,
		lazyLoad: true,
	},
};

// ============================================================================
// Extension State
// ============================================================================

interface ExtensionState {
	db: MemoryDatabase | null;
	dag: DAGManager | null;
	summaryGenerator: SummaryGenerator | null;
	searchTool: SearchTool | null;
	statsTool: StatsTool | null;
	expandTool: ExpandTool | null;
	initialized: boolean;
	currentSessionId: string | null;
}

// ============================================================================
// Extension Entry Point
// ============================================================================

export default function (pi: ExtensionAPI) {
	const state: ExtensionState = {
		db: null,
		dag: null,
		summaryGenerator: null,
		searchTool: null,
		statsTool: null,
		expandTool: null,
		initialized: false,
		currentSessionId: null,
	};

	// ============================================================================
	// Initialization
	// ============================================================================

	/**
	 * Initialize the extension
	 */
	async function initialize(): Promise<void> {
		if (state.initialized) {
			return;
		}

		try {
			// Load configuration from settings or use defaults
			const config = loadConfig();

			if (!config.enabled) {
				pi.on("session_start", async (_event, ctx) => {
					ctx.ui.notify("Lossless Memory 扩展已禁用", "info");
				});
				return;
			}

			// Initialize database
			state.db = new MemoryDatabase(config);
			const dbResult = state.db.initialize();

			if (!dbResult.success) {
				throw new Error(`数据库初始化失败：${dbResult.error}`);
			}

			// Initialize DAG manager
			state.dag = new DAGManager(state.db, config);

			// Initialize summary generator
			state.summaryGenerator = new SummaryGenerator(pi, {
				provider: config.summary.provider,
				model: config.summary.model,
				maxTokens: config.summary.maxTokens,
				systemPrompt: "你是一个专业的对话摘要助手。你的任务是将长对话压缩成简洁的摘要，保留所有关键信息。",
				compressionRules: {
					1: { compressEvery: 8, targetTokens: 200 },
					2: { compressEvery: 4, targetTokens: 300 },
					3: { compressEvery: 4, targetTokens: 500 },
					4: { compressEvery: 4, targetTokens: 800 },
				},
			});

			// Initialize tools
			state.searchTool = new SearchTool(pi, state.db, state.dag, config);
			state.statsTool = new StatsTool(pi, state.db, state.dag);
			state.expandTool = new ExpandTool(pi, state.db, state.dag);

			// Register tools
			state.searchTool.register();
			state.statsTool.register();
			state.expandTool.register();

			state.initialized = true;

			// Clear trace file
			try {
				if (fs.existsSync(TRACE_FILE)) {
					fs.unlinkSync(TRACE_FILE);
				}
			} catch {}

			pi.on("session_start", async (_event, ctx) => {
				await onSessionStart(ctx);
			});

			pi.on("session_before_compact", async (event, ctx) => {
				return await onSessionBeforeCompact(event, ctx);
			});

			// Context event with tracing
			let traceTurn = 0;
			pi.on("context", async (event, ctx) => {
				traceTurn++;

				// Trace context for debugging
				const totalTokens = event.messages.reduce((sum, m) => {
					const text = typeof m.content === "string" ? m.content : m.content?.[0]?.text || "";
					return sum + Math.ceil(text.length / 4);
				}, 0);

				const trace = {
					turn: traceTurn,
					timestamp: new Date().toISOString(),
					messages: event.messages.length,
					totalTokens,
					modelContextWindow: ctx.model?.contextWindow || 200000,
				};

				fs.appendFileSync(TRACE_FILE, `${JSON.stringify(trace)}\n`);
				console.log(`[LosslessMemory] Turn ${traceTurn}: ${event.messages.length} msgs, ${totalTokens} tokens`);

				return await onContext(event, ctx);
			});

			pi.on("session_shutdown", async (_event, ctx) => {
				await onSessionShutdown(ctx);
			});

			// Register commands
			registerCommands(pi);

			pi.on("session_start", async (_event, ctx) => {
				ctx.ui.notify("Lossless Memory 已加载", "info");
				ctx.ui.setStatus("lossless-memory", "记忆：就绪");
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("[LosslessMemory] 初始化失败:", errorMessage);
			pi.on("session_start", async (_event, ctx) => {
				ctx.ui.notify(`Lossless Memory 初始化失败：${errorMessage}`, "error");
			});
		}
	}

	/**
	 * Load configuration from settings or use defaults
	 */
	function loadConfig(): LosslessMemoryConfig {
		// In a real implementation, this would read from settings.json
		// For now, use defaults
		return DEFAULT_CONFIG;
	}

	// ============================================================================
	// Event Handlers
	// ============================================================================

	/**
	 * Handle session start event
	 */
	async function onSessionStart(ctx: any): Promise<void> {
		if (!state.dag) return;

		const sessionId = ctx.sessionManager?.getSessionFile?.() || `session-${Date.now()}`;
		state.currentSessionId = sessionId;

		// Initialize DAG for this session
		await state.dag.initializeForSession(sessionId);

		// Update session index
		const stats = state.dag.getStats();
		state.db?.upsertSessionIndex(sessionId, sessionId, stats.nodeCount, stats.totalTokens);

		// Update UI
		ctx.ui.setStatus("lossless-memory", `记忆：L${stats.maxLevel} | ${stats.nodeCount}节点`);

		// Show startup notification if there's existing data
		if (stats.nodeCount > 0) {
			ctx.ui.notify(`已加载 ${stats.nodeCount} 个记忆节点`, "info");
		}
	}

	/**
	 * Handle session_before_compact event
	 */
	async function onSessionBeforeCompact(event: any, ctx: any): Promise<any> {
		if (!state.dag || !state.summaryGenerator) {
			return;
		}

		const { preparation, customInstructions } = event;

		try {
			// Prepare entries for summarization
			const entriesToSummarize = preparation.entriesToSummarize.map((e: any) => ({
				id: e.id,
				role: e.role,
				content: e.content,
				timestamp: e.timestamp,
			}));

			// Generate summary
			const summaryOutput = await state.summaryGenerator.generateSummary({
				entries: entriesToSummarize,
				customInstructions,
			});

			// Create DAG node
			const _node = await state.dag.createSummaryNode(
				entriesToSummarize,
				summaryOutput.summary,
				1, // Start with L1 summary
			);

			// Update session index
			const stats = state.dag.getStats();
			state.db?.upsertSessionIndex(
				state.currentSessionId || "unknown",
				state.currentSessionId || "unknown",
				stats.nodeCount,
				stats.totalTokens,
			);

			// Update UI
			ctx.ui.setStatus("lossless-memory", `记忆：L${stats.maxLevel} | ${stats.nodeCount}节点 | 新增摘要`);

			// Return compaction result
			return {
				compaction: {
					summary: summaryOutput.summary,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
				},
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("[LosslessMemory] 压缩失败:", errorMessage);

			// Return empty compaction to let pi handle it normally
			return;
		}
	}

	/**
	 * Handle context event (modify messages sent to LLM)
	 */
	async function onContext(event: any, ctx: any): Promise<any> {
		if (!state.dag) {
			return { messages: event.messages };
		}

		const messages = event.messages;
		const modelContextWindow = ctx.model?.contextWindow ?? 100000;

		// Estimate current token usage
		const currentTokens = messages.reduce((sum: number, m: any) => {
			const text = typeof m.content === "string" ? m.content : m.content?.[0]?.text || "";
			return sum + Math.ceil(text.length / 4);
		}, 0);

		// TEST MODE: Use 0.005% threshold for testing (normally 80% = 0.8)
		// This will trigger context modification very early
		const TEST_THRESHOLD = 0.00005; // 0.005%
		const _NORMAL_THRESHOLD = 0.8; // 80%
		const threshold = TEST_THRESHOLD; // Change to NORMAL_THRESHOLD for production

		// If we're approaching the limit, use summaries
		if (currentTokens > modelContextWindow * threshold) {
			console.log(`[LosslessMemory] 触发上下文修改！${currentTokens} > ${modelContextWindow * threshold}`);
			try {
				// Get root summaries (highest level)
				const rootNodes = state.dag.getRootNodes();

				if (rootNodes.length > 0) {
					// Keep recent messages, replace old ones with summaries
					const recentMessages = messages.slice(-15); // Keep last 15 messages

					// Prepend summaries
					const summaryMessages = rootNodes.map((node: MemoryNode) => ({
						role: "system" as const,
						content: [{ type: "text" as const, text: `历史摘要：${node.content}` }],
					}));

					console.log(
						`[LosslessMemory] 修改前：${messages.length} 条，修改后：${summaryMessages.length + recentMessages.length} 条`,
					);

					return {
						messages: [...summaryMessages, ...recentMessages],
					};
				}
			} catch (error) {
				console.error("[LosslessMemory] 上下文装配失败:", error);
			}
		}

		return { messages };
	}

	// ============================================================================
	// Session Shutdown Handler
	// ============================================================================

	/**
	 * Handle session shutdown event
	 */
	async function _onSessionShutdown(_ctx: any): Promise<void> {
		// If we're approaching the limit, use summaries
		if (currentTokens > modelContextWindow * 0.8) {
			try {
				// Get root summaries (highest level)
				const rootNodes = state.dag.getRootNodes();

				if (rootNodes.length > 0) {
					// Keep recent messages, replace old ones with summaries
					const recentMessages = messages.slice(-15); // Keep last 15 messages

					// Prepend summaries
					const summaryMessages = rootNodes.map((node: MemoryNode) => ({
						role: "system" as const,
						content: [{ type: "text" as const, text: `历史摘要：${node.content}` }],
					}));

					return {
						messages: [...summaryMessages, ...recentMessages],
					};
				}
			} catch (error) {
				console.error("[LosslessMemory] 上下文装配失败:", error);
			}
		}

		return { messages };
	}

	/**
	 * Handle session shutdown event
	 */
	async function onSessionShutdown(ctx: any): Promise<void> {
		// Update session index before closing
		if (state.dag && state.currentSessionId) {
			const stats = state.dag.getStats();
			state.db?.upsertSessionIndex(
				state.currentSessionId,
				state.currentSessionId,
				stats.nodeCount,
				stats.totalTokens,
			);
		}

		// Clear session state
		if (state.dag) {
			state.dag.clearSession();
		}

		state.currentSessionId = null;
		ctx.ui.setStatus("lossless-memory", undefined);
	}

	// ============================================================================
	// Commands
	// ============================================================================

	/**
	 * Register extension commands
	 */
	function registerCommands(pi: ExtensionAPI): void {
		// Context size command
		pi.registerCommand("context-size", {
			description: "显示当前上下文大小和使用情况",
			handler: async (_args, ctx) => {
				const entries = ctx.sessionManager.getEntries();
				const usage = ctx.getContextUsage();

				let output = `上下文使用情况:\n\n`;
				output += `总条目数：${entries.length}\n`;

				// Count by type
				const userCount = entries.filter((e: any) => e.type === "message" && e.message?.role === "user").length;
				const assistantCount = entries.filter(
					(e: any) => e.type === "message" && e.message?.role === "assistant",
				).length;
				const toolCount = entries.filter(
					(e: any) => e.type === "message" && e.message?.role === "toolResult",
				).length;
				const customCount = entries.filter((e: any) => e.type === "custom").length;

				output += `  用户消息：${userCount}\n`;
				output += `  助手消息：${assistantCount}\n`;
				output += `  工具结果：${toolCount}\n`;
				output += `  自定义条目：${customCount}\n`;
				output += `\n`;

				if (usage) {
					output += `Token 使用:\n`;
					output += `  当前：${usage.tokens ?? "未知"}\n`;
					output += `  窗口：${usage.contextWindow}\n`;
					if (usage.percent !== null) {
						output += `  使用率：${usage.percent.toFixed(1)}%\n`;

						// Visual bar
						const barLength = 30;
						const filled = Math.round((usage.percent / 100) * barLength);
						const bar = "█".repeat(filled) + "░".repeat(barLength - filled);
						output += `  [${bar}]\n`;

						if (usage.percent > 90) {
							output += `\n⚠️ 警告：上下文接近上限！\n`;
						} else if (usage.percent > 80) {
							output += `\n！注意：上下文使用率较高\n`;
						}
					}
				} else {
					output += `Token 使用：未知 (可能在非流式模式)\n`;
				}

				ctx.ui.notify(output, "info");
			},
		});

		// Context trace command
		pi.registerCommand("context-trace", {
			description: "查看上下文跟踪记录",
			handler: async (_args, ctx) => {
				if (!fs.existsSync(TRACE_FILE)) {
					ctx.ui.notify("暂无跟踪记录，先进行对话", "info");
					return;
				}

				const lines = fs.readFileSync(TRACE_FILE, "utf-8").trim().split("\n");
				if (lines.length === 0) {
					ctx.ui.notify("暂无跟踪记录", "info");
					return;
				}

				let output = `上下文跟踪 (${lines.length} 轮):\n\n`;

				// Show last 5 turns
				const lastTurns = lines.slice(-5).map((l) => JSON.parse(l));
				for (const trace of lastTurns) {
					output += `第 ${trace.turn} 轮：${trace.messages} 条消息，${trace.totalTokens} tokens (${((trace.totalTokens / trace.modelContextWindow) * 100).toFixed(1)}%)\n`;
				}

				output += `\n完整记录：${TRACE_FILE}`;
				ctx.ui.notify(output, "info");
			},
		});

		// Context export command
		pi.registerCommand("context-export", {
			description: "导出完整上下文跟踪",
			handler: async (_args, ctx) => {
				if (!fs.existsSync(TRACE_FILE)) {
					ctx.ui.notify("暂无跟踪记录", "info");
					return;
				}

				const content = fs.readFileSync(TRACE_FILE, "utf-8");
				ctx.ui.notify(`跟踪数据：${TRACE_FILE}\n\n${content}`, "info");
			},
		});

		// Memory search command
		pi.registerCommand("lossless-search", {
			description: "搜索历史记忆",
			getArgumentCompletions: (_prefix: string) => {
				return null; // No completions for now
			},
			handler: async (args, ctx) => {
				if (!args || args.trim() === "") {
					ctx.ui.notify("用法：/lossless-search <关键词>", "warning");
					return;
				}

				const results = await state.searchTool?.quickSearch(args.trim(), 3);
				if (results) {
					ctx.ui.notify(results, "info");
				}
			},
		});

		// Memory stats command
		pi.registerCommand("lossless-stats", {
			description: "查看记忆统计",
			handler: async (_args, ctx) => {
				if (!state.dag) {
					ctx.ui.notify("记忆系统未初始化", "error");
					return;
				}

				const stats = state.dag.getStats();
				let text = `记忆统计:\n`;
				text += `节点数：${stats.nodeCount}\n`;
				text += `最大层级：L${stats.maxLevel}\n`;
				text += `根节点：${stats.rootCount}\n`;
				text += `总 Token: ${stats.totalTokens}\n`;
				text += `条目覆盖：${stats.entryCoverage}`;

				ctx.ui.notify(text, "info");
			},
		});

		// Memory clear command
		pi.registerCommand("lossless-clear", {
			description: "清除当前会话的记忆数据",
			handler: async (_args, ctx) => {
				const confirmed = await ctx.ui.confirm("清除记忆", "确定要清除当前会话的所有记忆数据吗？此操作不可恢复。");

				if (!confirmed) {
					ctx.ui.notify("已取消", "info");
					return;
				}

				if (state.dag) {
					state.dag.deleteSession();
					ctx.ui.notify("记忆已清除", "info");
					ctx.ui.setStatus("lossless-memory", "记忆：已清除");
				}
			},
		});
	}

	// ============================================================================
	// Utilities
	// ============================================================================

	/**
	 * Estimate tokens for a message
	 */
	function _estimateMessageTokens(message: any): number {
		const content = typeof message.content === "string" ? message.content : message.content?.[0]?.text || "";

		const avgCharPerToken = content.match(/[\u4e00-\u9fa5]/) ? 2 : 4;
		return Math.ceil(content.length / avgCharPerToken);
	}

	// ============================================================================
	// Start Initialization
	// ============================================================================

	// Initialize on session start
	initialize();
}
