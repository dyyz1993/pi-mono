/**
 * Context Compression Extension
 *
 * Hooks into 'context' event to compress messages before each LLM call.
 * Configuration is loaded from ~/.pi/compression-config.json
 */

console.error("[ctx-compress] Extension file loading...");

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ==================== Type Definitions ====================

interface CompressionModule {
	compressContext: (messages: unknown[], config: unknown) => Promise<CompressionResult>;
	estimateTokens: (messages: unknown[]) => number;
}

interface TypesModule {
	DEFAULT_COMPRESSION_PIPELINE_CONFIG: PipelineConfig;
	STRATEGY_LABELS: Record<string, string>;
}

interface PipelineConfig {
	classifier?: { enabled: boolean };
	lifecycle?: {
		keepRecent: number;
		staleMinutes: number;
	};
	summary?: {
		maxLines: number;
	};
	persistence?: {
		largeThreshold: number;
	};
}

interface CompressionResult {
	messages: unknown[];
	steps: {
		scoring?: {
			protectCount: number;
			persistCount: number;
			summaryCount: number;
			persistShortCount: number;
			dropCount: number;
		};
		persistence?: {
			persistedCount: number;
			bytesSaved: number;
		};
		lifecycle?: {
			degradedCount: number;
			clearedCount: number;
		};
		summary?: {
			summarizedCount: number;
		};
	};
	durationMs: number;
}

interface CompressionConfig {
	minTokensToCompress: number;
	minGrowthToCompress: number;
	minIntervalMs: number;
	minMessagesToCompress: number;
	keepRecent: number;
	staleMinutes: number;
	summaryMaxLines: number;
	persistenceThreshold: number;
	logLevel: "debug" | "info" | "warn" | "error" | "none";
}

interface StrategyStats {
	protected: number;
	persisted: number;
	summarized: number;
	persistShort: number;
	dropped: number;
	persistL0: number;
	persistBytesL0: number;
	lifecycleDegraded: number;
	lifecycleCleared: number;
	summaryL3: number;
}

interface CompressionStats {
	count: number;
	inputBytes: number;
	outputBytes: number;
	lastTokens: number;
	lastTimestamp: number;
	strategies: StrategyStats;
}

interface CompressionRecord {
	timestamp: number;
	inputBytes: number;
	outputBytes: number;
	inputTokens: number;
	outputTokens: number;
	messageCount: number;
	duration: number;
	savedBytes: number;
	savedPercent: string;
	strategies: Record<string, number>;
	triggerReason: string;
}

// ==================== Module Loading ====================

interface LoadedModules {
	compressContext: CompressionModule["compressContext"];
	estimateTokens: CompressionModule["estimateTokens"];
	DEFAULT_COMPRESSION_PIPELINE_CONFIG: TypesModule["DEFAULT_COMPRESSION_PIPELINE_CONFIG"];
	STRATEGY_LABELS: TypesModule["STRATEGY_LABELS"];
}

let modules: LoadedModules | null = null;

async function loadModules(): Promise<LoadedModules> {
	if (modules) return modules;

	const projectRoot = path.resolve(__dirname, "../..");
	const compressionPath = path.join(projectRoot, "packages/coding-agent/dist/core/context-compression/index.js");
	const typesPath = path.join(projectRoot, "packages/coding-agent/dist/core/context-compression/types.js");

	// Verify paths exist
	if (!fs.existsSync(compressionPath)) {
		throw new Error(`Compression module not found at ${compressionPath}`);
	}
	if (!fs.existsSync(typesPath)) {
		throw new Error(`Types module not found at ${typesPath}`);
	}

	try {
		const [compressionModule, typesModule] = await Promise.all([
			import(`file://${compressionPath}`) as Promise<CompressionModule>,
			import(`file://${typesPath}`) as Promise<TypesModule>,
		]);

		modules = {
			compressContext: compressionModule.compressContext,
			estimateTokens: compressionModule.estimateTokens,
			DEFAULT_COMPRESSION_PIPELINE_CONFIG: typesModule.DEFAULT_COMPRESSION_PIPELINE_CONFIG,
			STRATEGY_LABELS: typesModule.STRATEGY_LABELS,
		};

		return modules;
	} catch (error) {
		throw new Error(`Failed to load compression modules: ${error instanceof Error ? error.message : String(error)}`);
	}
}

// ==================== Configuration ====================

const DEFAULT_CONFIG: CompressionConfig = {
	minTokensToCompress: 40 * 1000,
	minGrowthToCompress: 20 * 1000,
	minIntervalMs: 5000,
	minMessagesToCompress: 3,
	keepRecent: 5,
	staleMinutes: 60,
	summaryMaxLines: 100,
	persistenceThreshold: 50 * 1024,
	logLevel: "info",
};

function loadConfig(): CompressionConfig {
	const configPath = path.join(os.homedir(), ".pi", "compression-config.json");
	try {
		if (fs.existsSync(configPath)) {
			const content = fs.readFileSync(configPath, "utf-8");
			const userConfig = JSON.parse(content);
			return { ...DEFAULT_CONFIG, ...userConfig };
		}
	} catch (err) {
		console.error(`[ctx-compress] Failed to load config: ${err}`);
	}
	return DEFAULT_CONFIG;
}

// ==================== Helper Functions ====================

function createEmptyStats(): CompressionStats {
	return {
		count: 0,
		inputBytes: 0,
		outputBytes: 0,
		lastTokens: 0,
		lastTimestamp: 0,
		strategies: {
			protected: 0,
			persisted: 0,
			summarized: 0,
			persistShort: 0,
			dropped: 0,
			persistL0: 0,
			persistBytesL0: 0,
			lifecycleDegraded: 0,
			lifecycleCleared: 0,
			summaryL3: 0,
		},
	};
}

function resetStats(stats: CompressionStats): void {
	Object.assign(stats, createEmptyStats());
}

function safeEstimateTokens(messages: unknown[], estimateTokensFn: LoadedModules["estimateTokens"]): number {
	try {
		return estimateTokensFn(messages);
	} catch (error) {
		console.error("[ctx-compress] Failed to estimate tokens:", error);
		// Fallback: estimate ~4 bytes per token on average
		return Math.ceil(JSON.stringify(messages).length / 4);
	}
}

function estimateSize(messages: unknown[]): number {
	try {
		return JSON.stringify(messages).length;
	} catch {
		return 0;
	}
}

function formatNumber(num: number): string {
	if (num >= 1000) {
		return `${(num / 1000).toFixed(0)}k`;
	}
	return String(num);
}

function log(level: CompressionConfig["logLevel"], message: string, config: CompressionConfig): void {
	const levels: Record<CompressionConfig["logLevel"], number> = {
		debug: 0,
		info: 1,
		warn: 2,
		error: 3,
		none: 4,
	};

	if (levels[level] >= levels[config.logLevel]) {
		console[level === "none" ? "log" : level](`[ctx-compress] ${message}`);
	}
}

// ==================== Status Formatting ====================

function formatStatus(stats: CompressionStats): string {
	if (stats.count === 0) {
		return "";
	}

	const saved = stats.inputBytes - stats.outputBytes;
	const ratio = stats.inputBytes > 0 ? ((saved / stats.inputBytes) * 100).toFixed(0) : "0";

	let status = `压缩:${stats.count}次 | 节省${ratio}%`;

	const s = stats.strategies;

	// Legacy strategy format
	if (s.protected + s.persisted + s.summarized + s.dropped > 0) {
		status += ` | 保留${s.protected} 持久化${s.persisted} 摘要${s.summarized} 清理${s.dropped}`;
	}
	// Lifecycle strategy format
	else if (s.persistL0 + s.lifecycleDegraded + s.lifecycleCleared + s.summaryL3 > 0) {
		status += ` | L0持久化${s.persistL0} L1/2降${s.lifecycleDegraded}清${s.lifecycleCleared} L3摘${s.summaryL3}`;
	}

	return status;
}

function updateStatus(ctx: any, stats: CompressionStats): void {
	const status = formatStatus(stats);
	ctx.ui.setStatus("ctx-compress", status || undefined);
}

// ==================== Main Extension ====================

export default async function contextCompressionExtension(pi: ExtensionAPI) {
	// Initialize modules
	let loadedModules: LoadedModules;
	try {
		loadedModules = await loadModules();
		console.error("[ctx-compress] Modules loaded successfully");
	} catch (error) {
		console.error("[ctx-compress] Failed to initialize:", error);
		return;
	}

	const config = loadConfig();
	const stats = createEmptyStats();
	const compressionHistory: CompressionRecord[] = [];

	pi.on("context", async (event, ctx) => {
		const { messages } = event;

		// Check minimum message count
		if (messages.length < config.minMessagesToCompress) {
			return undefined;
		}

		const msgTokens = safeEstimateTokens(messages, loadedModules.estimateTokens);
		log("debug", `messages=${messages.length}, tokens=${msgTokens}, threshold=${config.minTokensToCompress}`, config);

		// Check token threshold - ensure msgTokens is valid
		if (!msgTokens || msgTokens < config.minTokensToCompress) {
			return undefined;
		}

		// Check time interval
		const now = Date.now();
		if (now - stats.lastTimestamp < config.minIntervalMs) {
			return undefined;
		}

		// Check token growth
		if (stats.lastTokens > 0 && msgTokens - stats.lastTokens < config.minGrowthToCompress) {
			return undefined;
		}

		try {
			const sizeBeforeBytes = estimateSize(messages);

			const pipelineConfig = {
				...loadedModules.DEFAULT_COMPRESSION_PIPELINE_CONFIG,
				classifier: { enabled: false },
				lifecycle: {
					...loadedModules.DEFAULT_COMPRESSION_PIPELINE_CONFIG.lifecycle!,
					keepRecent: config.keepRecent,
					staleMinutes: config.staleMinutes,
				},
				summary: {
					...loadedModules.DEFAULT_COMPRESSION_PIPELINE_CONFIG.summary!,
					maxLines: config.summaryMaxLines,
				},
				persistence: {
					...loadedModules.DEFAULT_COMPRESSION_PIPELINE_CONFIG.persistence!,
					largeThreshold: config.persistenceThreshold,
				},
			};

			const result = await loadedModules.compressContext(messages, pipelineConfig);

			const stepCount = Object.keys(result.steps).length;
			if (stepCount === 0) {
				return undefined;
			}

			// Update stats
			const sizeAfterBytes = estimateSize(result.messages);
			stats.count++;
			stats.inputBytes += sizeBeforeBytes;
			stats.outputBytes += sizeAfterBytes;
			stats.lastTokens = safeEstimateTokens(result.messages, loadedModules.estimateTokens);
			stats.lastTimestamp = now;

			// Update strategy stats
			if (result.steps.scoring) {
				const s = result.steps.scoring;
				stats.strategies.protected += s.protectCount;
				stats.strategies.persisted += s.persistCount;
				stats.strategies.summarized += s.summaryCount;
				stats.strategies.persistShort += s.persistShortCount;
				stats.strategies.dropped += s.dropCount;
			} else {
				if (result.steps.persistence) {
					stats.strategies.persistL0 += result.steps.persistence.persistedCount;
					stats.strategies.persistBytesL0 += result.steps.persistence.bytesSaved;
				}
				if (result.steps.lifecycle) {
					stats.strategies.lifecycleDegraded += result.steps.lifecycle.degradedCount;
					stats.strategies.lifecycleCleared += result.steps.lifecycle.clearedCount;
				}
				if (result.steps.summary) {
					stats.strategies.summaryL3 += result.steps.summary.summarizedCount;
				}
			}

			// Create log message
			const duration = result.durationMs;
			const savedBytes = sizeBeforeBytes - sizeAfterBytes;
			const pct = sizeBeforeBytes > 0 ? ((savedBytes / sizeBeforeBytes) * 100).toFixed(0) : "0";

			let logMsg = `#${stats.count} (${duration}ms) ${sizeBeforeBytes}->${sizeAfterBytes}B (-${pct}%)`;
			const parts: string[] = [];

			if (result.steps.scoring) {
				const s = result.steps.scoring;
				parts.push(
					`${loadedModules.STRATEGY_LABELS.protected}:${s.protectCount}`,
					`${loadedModules.STRATEGY_LABELS.persist}:${s.persistCount}`,
					`${loadedModules.STRATEGY_LABELS.summary}:${s.summaryCount}`,
					`${loadedModules.STRATEGY_LABELS.drop}:${s.dropCount}`,
				);
			} else {
				if (result.steps.persistence) {
					parts.push(`persist:${result.steps.persistence.persistedCount}`);
				}
				if (result.steps.lifecycle) {
					parts.push(`life:-${result.steps.lifecycle.degradedCount}/clr:${result.steps.lifecycle.clearedCount}`);
				}
				if (result.steps.summary) {
					parts.push(`summarized:${result.steps.summary.summarizedCount}`);
				}
			}

			if (parts.length > 0) {
				logMsg += ` | ${parts.join(" ")}`;
			}

			log("info", logMsg, config);
			ctx.ui.notify(logMsg, "info");
			updateStatus(ctx, stats);

			// Record compression history
			const inputTokens = safeEstimateTokens(messages, loadedModules.estimateTokens);
			const outputTokens = safeEstimateTokens(result.messages, loadedModules.estimateTokens);
			const triggerReasons: string[] = [];
			if (inputTokens >= config.minTokensToCompress) triggerReasons.push(`tokens>=${config.minTokensToCompress}`);
			if (stats.lastTimestamp > 0 && now - stats.lastTimestamp >= config.minIntervalMs) triggerReasons.push(`interval>=${config.minIntervalMs}ms`);
			if (stats.lastTokens > 0 && inputTokens - stats.lastTokens >= config.minGrowthToCompress) triggerReasons.push(`growth>=${config.minGrowthToCompress}`);

			compressionHistory.push({
				timestamp: now,
				inputBytes: sizeBeforeBytes,
				outputBytes: sizeAfterBytes,
				inputTokens: inputTokens || 0,
				outputTokens: outputTokens || 0,
				messageCount: messages.length,
				duration,
				savedBytes,
				savedPercent: pct,
				strategies: { ...stats.strategies },
				triggerReason: triggerReasons.join(",") || "unknown",
			});

			return { messages: result.messages };
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			log("error", `Compression failed: ${errorMsg}`, config);
			ctx.ui.notify(`[ctx-compress] error: ${errorMsg}`, "warning");
			return undefined;
		}
	});

	pi.on("agent_start", async (_event: any, ctx: any) => {
		resetStats(stats);
		compressionHistory.length = 0;

		ctx.ui.setStatus("ctx-compress", undefined);
		const msg = `✅ 上下文压缩已启用 | 触发阈值: ${formatNumber(config.minTokensToCompress)} tokens`;
		log("info", msg, config);
		ctx.ui.notify(msg, "info");
	});

	// Register commands
	pi.registerCommand("ctx-report", {
		description: "Generate HTML compression report",
		handler: async (_args, ctx) => {
			const historyPath = path.join(os.homedir(), ".pi", "compression-history.json");
			const htmlReportPath = path.join(os.homedir(), ".pi", "compression-report.html");

			if (compressionHistory.length === 0) {
				ctx.ui.notify("No compression history yet", "info");
				return;
			}

			try {
				const html = generateHtmlReport(compressionHistory, config);
				fs.writeFileSync(htmlReportPath, html);
				fs.writeFileSync(historyPath, JSON.stringify(compressionHistory, null, 2));
				ctx.ui.notify(`Report saved to ${htmlReportPath}`, "info");
				log("info", `Report generated: ${htmlReportPath}`, config);
			} catch (error) {
				ctx.ui.notify(`Failed to generate report: ${error}`, "error");
			}
		},
	});

	pi.registerCommand("ctx-stats", {
		description: "Show current compression stats",
		handler: async (_args, ctx) => {
			const status = formatStatus(stats);
			ctx.ui.notify(`Compression stats: ${status || "no compressions yet"}`, "info");
		},
	});

	pi.on("session_shutdown", async (_event: any, ctx: any) => {
		// Save compression history if configured
		if (compressionHistory.length > 0) {
			const historyPath = path.join(os.homedir(), ".pi", "compression-history.json");
			try {
				fs.writeFileSync(historyPath, JSON.stringify(compressionHistory, null, 2));
				log("debug", `Saved compression history to ${historyPath}`, config);

				// Generate HTML report
				const htmlReportPath = path.join(os.homedir(), ".pi", "compression-report.html");
				const html = generateHtmlReport(compressionHistory, config);
				fs.writeFileSync(htmlReportPath, html);
				log("debug", `Generated HTML report to ${htmlReportPath}`, config);
			} catch (error) {
				log("error", `Failed to save compression history: ${error}`, config);
			}
		}

		ctx.ui.setStatus("ctx-compress", undefined);
	});
}

function generateHtmlReport(records: CompressionRecord[], config: CompressionConfig): string {
	const totalInput = records.reduce((sum, r) => sum + r.inputBytes, 0);
	const totalOutput = records.reduce((sum, r) => sum + r.outputBytes, 0);
	const totalSaved = totalInput - totalOutput;
	const overallPct = totalInput > 0 ? ((totalSaved / totalInput) * 100).toFixed(1) : "0";

	const rows = records.map((r, i) => {
		const date = new Date(r.timestamp).toLocaleTimeString();
		const strategiesStr = Object.entries(r.strategies)
			.filter(([_, v]) => v > 0)
			.map(([k, v]) => `${k}:${v}`)
			.join(", ") || "none";
		return `<tr>
			<td>${i + 1}</td>
			<td>${date}</td>
			<td>${r.messageCount}</td>
			<td>${r.inputTokens || "?"}</td>
			<td>${r.outputTokens || "?"}</td>
			<td>${(r.inputBytes / 1024).toFixed(1)}KB</td>
			<td>${(r.outputBytes / 1024).toFixed(1)}KB</td>
			<td>-${r.savedPercent}%</td>
			<td>${r.duration}ms</td>
			<td>${r.triggerReason}</td>
			<td>${strategiesStr}</td>
		</tr>`;
	}).join("\n");

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>Context Compression Report</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #1a1a2e; color: #eee; }
		h1 { color: #00d4ff; }
		.summary { display: flex; gap: 20px; margin: 20px 0; }
		.card { background: #16213e; padding: 20px; border-radius: 8px; }
		.card h3 { margin: 0 0 10px 0; color: #888; font-size: 14px; }
		.card .value { font-size: 24px; font-weight: bold; color: #00d4ff; }
		table { width: 100%; border-collapse: collapse; margin-top: 20px; }
		th { background: #16213e; padding: 12px; text-align: left; }
		td { padding: 10px; border-bottom: 1px solid #333; }
		tr:hover { background: #16213e; }
		.config { background: #16213e; padding: 15px; border-radius: 8px; margin: 20px 0; font-size: 14px; }
		.config span { color: #00d4ff; }
	</style>
</head>
<body>
	<h1>Context Compression Report</h1>
	<p>Generated: ${new Date().toLocaleString()}</p>

	<div class="summary">
		<div class="card">
			<h3>Total Compressions</h3>
			<div class="value">${records.length}</div>
		</div>
		<div class="card">
			<h3>Total Saved</h3>
			<div class="value">${(totalSaved / 1024).toFixed(1)} KB</div>
		</div>
		<div class="card">
			<h3>Overall Reduction</h3>
			<div class="value">${overallPct}%</div>
		</div>
	</div>

	<div class="config">
		<strong>Config:</strong>
		minTokens=${config.minTokensToCompress},
		minGrowth=${config.minGrowthToCompress},
		keepRecent=${config.keepRecent},
		staleMinutes=${config.staleMinutes}
	</div>

	<table>
		<thead>
			<tr>
				<th>#</th>
				<th>Time</th>
				<th>Msgs</th>
				<th>In Tokens</th>
				<th>Out Tokens</th>
				<th>In Size</th>
				<th>Out Size</th>
				<th>Saved</th>
				<th>Duration</th>
				<th>Trigger</th>
				<th>Strategies</th>
			</tr>
		</thead>
		<tbody>
			${rows}
		</tbody>
	</table>
</body>
</html>`;
}
