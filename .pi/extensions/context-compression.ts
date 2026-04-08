/**
 * Context Compression Extension
 *
 * Hooks into 'context' event to compress messages before each LLM call.
 * Supports both legacy pipeline (L0/L1/L2/L3) and new scoring-based compression.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { compressContext } from "../../packages/coding-agent/src/core/context-compression/index.js";
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
	let totalCompressions = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalProtected = 0;
	let totalPersist = 0;
	let totalSummary = 0;
	let totalPersistShort = 0;
	let totalDrop = 0;

	const updateStatus = (ctx: { ui: { setStatus: (id: string, text?: string) => void } }) => {
		if (totalCompressions === 0) {
			ctx.ui.setStatus("ctx-compress", undefined);
			return;
		}
		const saved = totalInputTokens - totalOutputTokens;
		const ratio = totalInputTokens > 0 ? ((saved / totalInputTokens) * 100).toFixed(0) : "0";
		ctx.ui.setStatus(
			"ctx-compress",
			`压缩:${totalCompressions}次 | 节省${ratio}% | 保留${totalProtected} 持久化${totalPersist} 摘要${totalSummary} 清理${totalDrop}`,
		);
	};

	pi.on("context", async (event, ctx) => {
		const { messages } = event;

		if (messages.length < 3) return undefined;

		const msgSize = estimateSize(messages);
		if (msgSize < 10240) return undefined;

		try {
			const sizeBefore = estimateSize(messages);

			const result = await compressContext(messages, DEFAULT_COMPRESSION_PIPELINE_CONFIG);

			const stepCount = Object.keys(result.steps).length;
			if (stepCount === 0) return undefined;

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
		totalProtected = 0;
		totalPersist = 0;
		totalSummary = 0;
		totalPersistShort = 0;
		totalDrop = 0;
		ctx.ui.setStatus("ctx-compress", undefined);
		ctx.ui.notify("[ctx-compress] extension loaded", "info");
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("ctx-compress", undefined);
	});
}
