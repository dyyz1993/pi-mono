/**
 * Context Compression Logger
 *
 * 详细记录压缩过程的每个阶段，便于分析和优化
 * 日志文件: ~/.pi/compression-logs/compression-YYYY-MM-DD.log
 */

import * as fs from "fs";
import { homedir } from "os";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export interface CompressionLogEntry {
	timestamp: string;
	sessionId: string;
	phase: "start" | "scoring" | "persistence" | "lifecycle" | "summary" | "end" | "error";
	message: string;
	details?: Record<string, unknown>;
}

export interface ToolResultLogEntry {
	messageIndex: number;
	toolName: string;
	strategy: string;
	score: number;
	breakdown: {
		base: number;
		size: number;
		age: number;
		repeat: number;
		content: number;
	};
	reason: string;
	contentPreview: string;
	originalSize: number;
	compressedSize: number;
	savedBytes: number;
}

export interface CompressionSessionLog {
	sessionId: string;
	startTime: string;
	intent?: string;
	intentConfidence?: number;
	tokensBefore: number;
	tokensAfter: number;
	savedTokens: number;
	savedPercent: string;
	durationMs: number;
	totalMessages: number;
	toolResultsProcessed: number;
	strategies: {
		protected: number;
		persist: number;
		summary: number;
		persist_short: number;
		drop: number;
	};
	toolResults: ToolResultLogEntry[];
	errors: string[];
}

// ============================================================================
// Logger Implementation
// ============================================================================

class CompressionLogger {
	private logDir: string;
	private currentLogFile: string;
	private sessionId: string;
	private sessionLog: CompressionSessionLog | null = null;
	private enabled: boolean;

	constructor() {
		this.logDir = path.join(homedir(), ".pi", "compression-logs");
		this.currentLogFile = "";
		this.sessionId = "";
		this.enabled = true;
		this.ensureLogDir();
	}

	private ensureLogDir(): void {
		try {
			if (!fs.existsSync(this.logDir)) {
				fs.mkdirSync(this.logDir, { recursive: true });
			}
		} catch (error) {
			console.error("[CompressionLogger] Failed to create log directory:", error);
			this.enabled = false;
		}
	}

	private getLogFileName(): string {
		const now = new Date();
		const dateStr = now.toISOString().split("T")[0];
		return path.join(this.logDir, `compression-${dateStr}.log`);
	}

	private formatTimestamp(): string {
		return new Date().toISOString();
	}

	private formatEntry(entry: CompressionLogEntry): string {
		const header = `[${entry.timestamp}] [${entry.sessionId}] [${entry.phase.toUpperCase()}]`;
		let line = `${header} ${entry.message}`;

		if (entry.details) {
			const detailsStr = Object.entries(entry.details)
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(" ");
			line += ` | ${detailsStr}`;
		}

		return line;
	}

	private writeLog(entry: CompressionLogEntry): void {
		if (!this.enabled) return;

		try {
			this.currentLogFile = this.getLogFileName();
			const line = this.formatEntry(entry) + "\n";
			fs.appendFileSync(this.currentLogFile, line, "utf-8");
		} catch (error) {
			console.error("[CompressionLogger] Failed to write log:", error);
		}
	}

	/**
	 * 开始一个新的压缩会话
	 */
	startSession(sessionId: string, totalMessages: number, estimatedTokens: number): void {
		this.sessionId = sessionId;
		this.sessionLog = {
			sessionId,
			startTime: this.formatTimestamp(),
			tokensBefore: estimatedTokens,
			tokensAfter: 0,
			savedTokens: 0,
			savedPercent: "0%",
			durationMs: 0,
			totalMessages,
			toolResultsProcessed: 0,
			strategies: {
				protected: 0,
				persist: 0,
				summary: 0,
				persist_short: 0,
				drop: 0,
			},
			toolResults: [],
			errors: [],
		};

		this.writeLog({
			timestamp: this.formatTimestamp(),
			sessionId,
			phase: "start",
			message: `开始压缩会话`,
			details: {
				totalMessages,
				estimatedTokens,
			},
		});
	}

	/**
	 * 记录意图分类结果
	 */
	logIntent(intent: string, confidence: number): void {
		if (!this.sessionLog) return;

		this.sessionLog.intent = intent;
		this.sessionLog.intentConfidence = confidence;

		this.writeLog({
			timestamp: this.formatTimestamp(),
			sessionId: this.sessionId,
			phase: "scoring",
			message: `意图分类: ${intent}`,
			details: { confidence: confidence.toFixed(2) },
		});
	}

	/**
	 * 记录单个 tool result 的压缩决策
	 */
	logToolResultDecision(entry: ToolResultLogEntry): void {
		if (!this.sessionLog) return;

		this.sessionLog.toolResults.push(entry);
		this.sessionLog.strategies[entry.strategy as keyof typeof this.sessionLog.strategies]++;
		this.sessionLog.toolResultsProcessed++;

		this.writeLog({
			timestamp: this.formatTimestamp(),
			sessionId: this.sessionId,
			phase: "scoring",
			message: `Tool Result #${entry.messageIndex}: ${entry.toolName} → ${entry.strategy.toUpperCase()}`,
			details: {
				score: entry.score,
				breakdown: `base=${entry.breakdown.base}, size=${entry.breakdown.size}, age=${entry.breakdown.age}, repeat=${entry.breakdown.repeat}, content=${entry.breakdown.content}`,
				reason: entry.reason,
				originalSize: entry.originalSize,
				compressedSize: entry.compressedSize,
				saved: `${entry.savedBytes}B (${((entry.savedBytes / entry.originalSize) * 100).toFixed(0)}%)`,
			},
		});
	}

	/**
	 * 记录持久化操作
	 */
	logPersistence(toolName: string, originalSize: number, persistedPath: string, savedBytes: number): void {
		this.writeLog({
			timestamp: this.formatTimestamp(),
			sessionId: this.sessionId,
			phase: "persistence",
			message: `持久化: ${toolName}`,
			details: {
				originalSize: `${(originalSize / 1024).toFixed(2)}KB`,
				persistedPath,
				savedBytes: `${(savedBytes / 1024).toFixed(2)}KB`,
			},
		});
	}

	/**
	 * 记录生命周期操作
	 */
	logLifecycle(degradedCount: number, clearedCount: number): void {
		this.writeLog({
			timestamp: this.formatTimestamp(),
			sessionId: this.sessionId,
			phase: "lifecycle",
			message: `生命周期处理`,
			details: { degradedCount, clearedCount },
		});
	}

	/**
	 * 记录摘要操作
	 */
	logSummary(toolName: string, originalLines: number, summarizedLines: number): void {
		this.writeLog({
			timestamp: this.formatTimestamp(),
			sessionId: this.sessionId,
			phase: "summary",
			message: `摘要: ${toolName}`,
			details: {
				originalLines,
				summarizedLines,
				compressed: `${((1 - summarizedLines / originalLines) * 100).toFixed(0)}%`,
			},
		});
	}

	/**
	 * 记录错误
	 */
	logError(phase: string, error: Error | string): void {
		const errorMsg = error instanceof Error ? error.message : error;

		if (this.sessionLog) {
			this.sessionLog.errors.push(`[${phase}] ${errorMsg}`);
		}

		this.writeLog({
			timestamp: this.formatTimestamp(),
			sessionId: this.sessionId,
			phase: "error",
			message: `错误: ${errorMsg}`,
			details: { phase },
		});
	}

	/**
	 * 结束压缩会话
	 */
	endSession(tokensAfter: number, durationMs: number): CompressionSessionLog | null {
		if (!this.sessionLog) return null;

		this.sessionLog.tokensAfter = tokensAfter;
		this.sessionLog.savedTokens = this.sessionLog.tokensBefore - tokensAfter;
		this.sessionLog.savedPercent =
			this.sessionLog.tokensBefore > 0
				? ((this.sessionLog.savedTokens / this.sessionLog.tokensBefore) * 100).toFixed(1) + "%"
				: "0%";
		this.sessionLog.durationMs = durationMs;

		this.writeLog({
			timestamp: this.formatTimestamp(),
			sessionId: this.sessionId,
			phase: "end",
			message: `压缩完成`,
			details: {
				tokensBefore: this.sessionLog.tokensBefore,
				tokensAfter: this.sessionLog.tokensAfter,
				saved: this.sessionLog.savedPercent,
				duration: `${durationMs}ms`,
				strategies: this.sessionLog.strategies,
			},
		});

		// 写入详细摘要
		this.writeSummary(this.sessionLog);

		const result = this.sessionLog;
		this.sessionLog = null;
		return result;
	}

	/**
	 * 写入详细摘要到单独的摘要文件
	 */
	private writeSummary(log: CompressionSessionLog): void {
		try {
			const summaryFile = path.join(this.logDir, `summary-${log.sessionId}.json`);
			fs.writeFileSync(summaryFile, JSON.stringify(log, null, 2), "utf-8");

			// 同时写入人类可读的文本摘要
			const textSummaryFile = path.join(this.logDir, `summary-${log.sessionId}.txt`);
			const textSummary = this.formatTextSummary(log);
			fs.writeFileSync(textSummaryFile, textSummary, "utf-8");
		} catch (error) {
			console.error("[CompressionLogger] Failed to write summary:", error);
		}
	}

	/**
	 * 格式化人类可读的摘要
	 */
	private formatTextSummary(log: CompressionSessionLog): string {
		const lines: string[] = [
			`═══════════════════════════════════════════════════════════════`,
			`压缩会话摘要: ${log.sessionId}`,
			`═══════════════════════════════════════════════════════════════`,
			``,
			`📊 总体统计:`,
			`  • 压缩前: ${log.tokensBefore} tokens`,
			`  • 压缩后: ${log.tokensAfter} tokens`,
			`  • 节省: ${log.savedTokens} tokens (${log.savedPercent})`,
			`  • 耗时: ${log.durationMs}ms`,
			`  • 消息总数: ${log.totalMessages}`,
			`  • 处理的 Tool Results: ${log.toolResultsProcessed}`,
			``,
			`🎯 意图分类: ${log.intent || "未知"} (置信度: ${log.intentConfidence?.toFixed(2) || "N/A"})`,
			``,
			`📈 策略分布:`,
			`  • 保留 (protected):     ${log.strategies.protected}`,
			`  • 持久化 (persist):     ${log.strategies.persist}`,
			`  • 摘要 (summary):       ${log.strategies.summary}`,
			`  • 短期持久化: ${log.strategies.persist_short}`,
			`  • 清理 (drop):          ${log.strategies.drop}`,
			``,
		];

		if (log.toolResults.length > 0) {
			lines.push(`📋 详细决策列表:`);
			lines.push(``);

			for (const tr of log.toolResults) {
				lines.push(`  ─────────────────────────────────────────`);
				lines.push(`  [${tr.messageIndex}] ${tr.toolName} → ${tr.strategy.toUpperCase()}`);
				lines.push(
					`  评分: ${tr.score}/100 (base=${tr.breakdown.base}, size=${tr.breakdown.size}, age=${tr.breakdown.age}, repeat=${tr.breakdown.repeat}, content=${tr.breakdown.content})`,
				);
				lines.push(`  原因: ${tr.reason}`);
				lines.push(`  大小: ${tr.originalSize}B → ${tr.compressedSize}B (节省 ${tr.savedBytes}B)`);
				lines.push(`  预览: ${tr.contentPreview}`);
			}
		}

		if (log.errors.length > 0) {
			lines.push(``);
			lines.push(`❌ 错误列表:`);
			for (const err of log.errors) {
				lines.push(`  • ${err}`);
			}
		}

		lines.push(``);
		lines.push(`═══════════════════════════════════════════════════════════════`);

		return lines.join("\n");
	}

	/**
	 * 获取日志目录路径
	 */
	getLogDir(): string {
		return this.logDir;
	}

	/**
	 * 启用/禁用日志
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * 检查是否启用
	 */
	isEnabled(): boolean {
		return this.enabled;
	}
}

// 单例实例
export const compressionLogger = new CompressionLogger();
