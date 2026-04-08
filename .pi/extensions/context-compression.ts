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

// Will be initialized dynamically in the extension function
let compressContext: any;
let estimateTokens: any;
let DEFAULT_COMPRESSION_PIPELINE_CONFIG: any;
let STRATEGY_LABELS: any;

async function initModules() {
	// Use absolute path to local development version
	// __dirname = /Users/xuyingzhou/Project/temporary/pi-mono/.pi/extensions
	// ../.. = /Users/xuyingzhou/Project/temporary/pi-mono (project root)
	const projectRoot = path.resolve(__dirname, "../..");
	const compressionPath = path.join(projectRoot, "packages/coding-agent/dist/core/context-compression/index.js");
	const compressionModule = await import(`file://${compressionPath}`);
	compressContext = compressionModule.compressContext;
	estimateTokens = compressionModule.estimateTokens;
	const typesModule = await import(`file://${path.join(projectRoot, "packages/coding-agent/dist/core/context-compression/types.js")}`);
	DEFAULT_COMPRESSION_PIPELINE_CONFIG = typesModule.DEFAULT_COMPRESSION_PIPELINE_CONFIG;
	STRATEGY_LABELS = typesModule.STRATEGY_LABELS;
}

export interface CompressionConfig {
	minTokensToCompress: number;
	minGrowthToCompress: number;
	minIntervalMs: number;
	keepRecent: number;
	staleMinutes: number;
	summaryMaxLines: number;
	persistenceThreshold: number;
}

const DEFAULT_CONFIG: CompressionConfig = {
	minTokensToCompress: 40 * 1000,
	minGrowthToCompress: 20 * 1000,
	minIntervalMs: 5000,
	keepRecent: 5,
	staleMinutes: 60,
	summaryMaxLines: 100,
	persistenceThreshold: 50 * 1024,
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

function safeEstimateTokens(messages: unknown[]): number {
	try {
		return estimateTokens(messages as Parameters<typeof estimateTokens>[0]);
	} catch {
		return 0;
	}
}

function estimateSize(messages: unknown[]): number {
	try {
		return JSON.stringify(messages).length;
	} catch {
		return 0;
	}
}

export default async function contextCompressionExtension(pi: ExtensionAPI) {
	// Initialize dynamic imports
	await initModules();

	const config = loadConfig();

	let totalCompressions = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let lastCompressedTokens = 0;
	let lastCompressAt = 0;

	let totalProtected = 0;
	let totalPersist = 0;
	let totalSummary = 0;
	let totalPersistShort = 0;
	let totalDrop = 0;

	let totalPersistL0 = 0;
	let totalPersistBytesL0 = 0;
	let totalLifecycleDegraded = 0;
	let totalLifecycleCleared = 0;
	let totalSummaryL3 = 0;

	const updateStatus = (ctx: { ui: { setStatus: (id: string, text?: string) => void } }) => {
		if (totalCompressions === 0) {
			ctx.ui.setStatus("ctx-compress", undefined);
			return;
		}
		const saved = totalInputTokens - totalOutputTokens;
		const ratio = totalInputTokens > 0 ? ((saved / totalInputTokens) * 100).toFixed(0) : "0";

		let status = `压缩:${totalCompressions}次 | 节省${ratio}%`;

		if (totalPersist + totalProtected + totalSummary + totalDrop > 0) {
			status += ` | 保留${totalProtected} 持久化${totalPersist} 摘要${totalSummary} 清理${totalDrop}`;
		} else if (totalPersistL0 + totalLifecycleDegraded + totalLifecycleCleared + totalSummaryL3 > 0) {
			status += ` | L0持久化${totalPersistL0} L1/2降${totalLifecycleDegraded}清${totalLifecycleCleared} L3摘${totalSummaryL3}`;
		}

		ctx.ui.setStatus("ctx-compress", status);
	};

	pi.on("context", async (event, ctx) => {
		const { messages } = event;

		if (messages.length < 3) return undefined;

		const msgTokens = safeEstimateTokens(messages);
		console.log(`[ctx-compress] messages=${messages.length}, tokens=${msgTokens}, threshold=${config.minTokensToCompress}`);

		if (msgTokens < config.minTokensToCompress) return undefined;

		const now = Date.now();
		if (now - lastCompressAt < config.minIntervalMs) return undefined;

		if (lastCompressedTokens > 0 && msgTokens - lastCompressedTokens < config.minGrowthToCompress) return undefined;

		try {
			const sizeBefore = estimateSize(messages);

			const pipelineConfig = {
				...DEFAULT_COMPRESSION_PIPELINE_CONFIG,
				classifier: { enabled: false },
				lifecycle: {
					...DEFAULT_COMPRESSION_PIPELINE_CONFIG.lifecycle!,
					keepRecent: config.keepRecent,
					staleMinutes: config.staleMinutes,
				},
				summary: {
					...DEFAULT_COMPRESSION_PIPELINE_CONFIG.summary!,
					maxLines: config.summaryMaxLines,
				},
				persistence: {
					...DEFAULT_COMPRESSION_PIPELINE_CONFIG.persistence!,
					largeThreshold: config.persistenceThreshold,
				},
			};

			const result = await compressContext(messages, pipelineConfig);

			const stepCount = Object.keys(result.steps).length;
			if (stepCount === 0) return undefined;

			lastCompressedTokens = safeEstimateTokens(result.messages);
			lastCompressAt = now;

			totalCompressions++;
			const sizeAfter = estimateSize(result.messages);
			totalInputTokens += sizeBefore;
			totalOutputTokens += sizeAfter;

			if (result.steps.scoring) {
				totalProtected += result.steps.scoring.protectCount;
				totalPersist += result.steps.scoring.persistCount;
				totalSummary += result.steps.scoring.summaryCount;
				totalPersistShort += result.steps.scoring.persistShortCount;
				totalDrop += result.steps.scoring.dropCount;
			} else {
				if (result.steps.persistence) {
					totalPersistL0 += result.steps.persistence.persistedCount;
					totalPersistBytesL0 += result.steps.persistence.bytesSaved;
				}
				if (result.steps.lifecycle) {
					totalLifecycleDegraded += result.steps.lifecycle.degradedCount;
					totalLifecycleCleared += result.steps.lifecycle.clearedCount;
				}
				if (result.steps.summary) {
					totalSummaryL3 += result.steps.summary.summarizedCount;
				}
			}

			const duration = result.durationMs;
			const saved = sizeBefore - sizeAfter;
			const pct = sizeBefore > 0 ? ((saved / sizeBefore) * 100).toFixed(0) : "0";

			let logMsg = `[ctx-compress] #${totalCompressions} (${duration}ms) ${sizeBefore}->${sizeAfter}B (-${pct}%)`;
			const parts: string[] = [];

			if (result.steps.scoring) {
				const s = result.steps.scoring;
				parts.push(
					`${STRATEGY_LABELS.protected}:${s.protectCount}`,
					`${STRATEGY_LABELS.persist}:${s.persistCount}`,
					`${STRATEGY_LABELS.summary}:${s.summaryCount}`,
					`${STRATEGY_LABELS.drop}:${s.dropCount}`,
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

			if (parts.length > 0) logMsg += ` | ${parts.join(" ")}`;

			ctx.ui.notify(logMsg, "info");
			updateStatus(ctx);

			return { messages: result.messages };
		} catch (err) {
			ctx.ui.notify(`[ctx-compress] error: ${err instanceof Error ? err.message : String(err)}`, "warning");
			return undefined;
		}
	});

	pi.on("agent_start", async (_event, ctx) => {
		totalCompressions = 0;
		totalInputTokens = 0;
		totalOutputTokens = 0;
		lastCompressedTokens = 0;
		lastCompressAt = 0;
		totalProtected = 0;
		totalPersist = 0;
		totalSummary = 0;
		totalPersistShort = 0;
		totalDrop = 0;
		totalPersistL0 = 0;
		totalPersistBytesL0 = 0;
		totalLifecycleDegraded = 0;
		totalLifecycleCleared = 0;
		totalSummaryL3 = 0;
		ctx.ui.setStatus("ctx-compress", undefined);
		ctx.ui.notify(
			`[ctx-compress] loaded | minTokens=${config.minTokensToCompress} minGrowth=${config.minGrowthToCompress} keepRecent=${config.keepRecent} stale=${config.staleMinutes}m`,
			"info",
		);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("ctx-compress", undefined);
	});
}
