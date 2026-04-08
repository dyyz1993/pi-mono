/**
 * Context Compression Extension
 *
 * Hooks into 'context' event to compress messages before each LLM call.
 * Supports both legacy pipeline (L0/L1/L2/L3) and new scoring-based compression.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { compressContext, estimateTokens } from "../../packages/coding-agent/src/core/context-compression/index.js";
import {
	DEFAULT_COMPRESSION_PIPELINE_CONFIG,
	STRATEGY_LABELS,
} from "../../packages/coding-agent/src/core/context-compression/types.js";

function estimateSize(messages: unknown[]): number {
	try {
		return JSON.stringify(messages).length;
	} catch {
		return 0;
	}
}

export default function contextCompressionExtension(pi: ExtensionAPI) {
	const MIN_COMPRESSION_TOKENS = 40 * 1000;
	const MIN_GROWTH_TOKENS = 20 * 1000;
	const MIN_INTERVAL_MS = 5000;

	let totalCompressions = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let lastCompressedTokens = 0;
	let lastCompressAt = 0;

	// Scoring stats
	let totalProtected = 0;
	let totalPersist = 0;
	let totalSummary = 0;
	let totalPersistShort = 0;
	let totalDrop = 0;

	// L0/L1/L2/L3 stats
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

		const msgTokens = estimateTokens(messages as Parameters<typeof estimateTokens>[0]);

		// 阈值1：至少 40K tokens 才考虑压缩
		if (msgTokens < MIN_COMPRESSION_TOKENS) return undefined;

		// 阈值2：距离上次压缩至少 5 秒
		const now = Date.now();
		if (now - lastCompressAt < MIN_INTERVAL_MS) return undefined;

		// 阈值3：相比上次压缩后，上下文必须增长至少 20K tokens
		if (lastCompressedTokens > 0 && msgTokens - lastCompressedTokens < MIN_GROWTH_TOKENS) return undefined;

		try {
			const sizeBefore = estimateSize(messages);

			const result = await compressContext(messages, DEFAULT_COMPRESSION_PIPELINE_CONFIG);

			const stepCount = Object.keys(result.steps).length;
			if (stepCount === 0) return undefined;

			// 记录这次压缩的状态
			lastCompressedTokens = estimateTokens(result.messages as Parameters<typeof estimateTokens>[0]);
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
				// L0: Persistence
				if (result.steps.persistence) {
					totalPersistL0 += result.steps.persistence.persistedCount;
					totalPersistBytesL0 += result.steps.persistence.bytesSaved;
				}
				// L1+L2: Lifecycle
				if (result.steps.lifecycle) {
					totalLifecycleDegraded += result.steps.lifecycle.degradedCount;
					totalLifecycleCleared += result.steps.lifecycle.clearedCount;
				}
				// L3: Summary
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

			if (result.steps.classification) {
				const c = result.steps.classification as { intent: string; confidence: number };
				parts.push(`${c.intent}`);
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
		lastCompressedSize = 0;
		lastCompressAt = 0;
		// Scoring stats
		totalProtected = 0;
		totalPersist = 0;
		totalSummary = 0;
		totalPersistShort = 0;
		totalDrop = 0;
		// L0/L1/L2/L3 stats
		totalPersistL0 = 0;
		totalPersistBytesL0 = 0;
		totalLifecycleDegraded = 0;
		totalLifecycleCleared = 0;
		totalSummaryL3 = 0;
		ctx.ui.setStatus("ctx-compress", undefined);
		ctx.ui.notify("[ctx-compress] extension loaded", "info");
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("ctx-compress", undefined);
	});
}
