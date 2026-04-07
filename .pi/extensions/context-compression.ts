/**
 * Context Compression Extension
 *
 * 5-layer zero-cost context compression for pi coding agent.
 * Hooks into 'context' event to compress messages before each LLM call.
 *
 * Layers:
 *   L0: Persistence (large results -> disk, stub in context)
 *   L1: Lifecycle count (keep recent N, degrade old)
 *   L2: Lifecycle time (clear stale results)
 *   L3: Zero-cost summary (structured extraction, no LLM)
 *   Classifier: Intent classification (for logging)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { compressContext } from "../../packages/coding-agent/src/core/context-compression/index.js";
import { DEFAULT_COMPRESSION_PIPELINE_CONFIG } from "../../packages/coding-agent/src/core/context-compression/types.js";

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
	let totalCleared = 0;
	let totalSummarized = 0;

	const updateStatus = (ctx: { ui: { setStatus: (id: string, text?: string) => void } }) => {
		if (totalCompressions === 0) {
			ctx.ui.setStatus("ctx-compress", undefined);
			return;
		}
		const saved = totalInputTokens - totalOutputTokens;
		const ratio = totalInputTokens > 0 ? ((saved / totalInputTokens) * 100).toFixed(0) : "0";
		ctx.ui.setStatus(
			"ctx-compress",
			`压缩:${totalCompressions}次 | 节省${ratio}% | 清${totalCleared} 摘${totalSummarized}`,
		);
	};

	pi.on("context", async (event, ctx) => {
		const { messages } = event;

		if (messages.length < 5) return undefined;

		try {
			const sizeBefore = estimateSize(messages);

			const result = await compressContext(messages, DEFAULT_COMPRESSION_PIPELINE_CONFIG);

			const stepCount = Object.keys(result.steps).length;
			if (stepCount === 0) return undefined;

			totalCompressions++;
			const sizeAfter = estimateSize(result.messages);
			totalInputTokens += sizeBefore;
			totalOutputTokens += sizeAfter;

			if (result.steps.lifecycle) {
				totalCleared += result.steps.lifecycle.clearedCount + result.steps.lifecycle.degradedCount;
			}
			if (result.steps.summary) {
				totalSummarized += result.steps.summary.summarizedCount;
			}

			const duration = result.durationMs;
			const saved = sizeBefore - sizeAfter;
			const pct = sizeBefore > 0 ? ((saved / sizeBefore) * 100).toFixed(0) : "0";

			let logMsg = `[ctx-compress] #${totalCompressions} (${duration}ms) ${sizeBefore}->${sizeAfter}B (-${pct}%)`;
			const parts: string[] = [];

			if (result.steps.persistence) {
				parts.push(`persist:${result.steps.persistence.persistedCount}`);
			}
			if (result.steps.lifecycle) {
				parts.push(`life:-${result.steps.lifecycle.degradedCount}/clr:${result.steps.lifecycle.clearedCount}`);
			}
			if (result.steps.summary) {
				parts.push(`summarized:${result.steps.summary.summarizedCount}`);
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
		totalCleared = 0;
		totalSummarized = 0;
		ctx.ui.setStatus("ctx-compress", undefined);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("ctx-compress", undefined);
	});
}
