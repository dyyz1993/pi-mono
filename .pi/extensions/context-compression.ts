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

export default function contextCompressionExtension(pi: ExtensionAPI) {
	let totalCompressions = 0;

	pi.on("context", async (event, ctx) => {
		const { messages } = event;

		if (messages.length < 5) return undefined;

		try {
			const result = await compressContext(messages, DEFAULT_COMPRESSION_PIPELINE_CONFIG);

			const stepCount = Object.keys(result.steps).length;
			if (stepCount === 0) return undefined;

			totalCompressions++;
			const duration = result.durationMs;

			let logMsg = `[ctx-compress] #${totalCompressions} (${duration}ms)`;
			const parts: string[] = [];

			if (result.steps.persistence) {
				parts.push(`persist:${result.steps.persistence.persistedCount}(-${(result.steps.persistence.bytesSaved / 1024).toFixed(1)}KB)`);
			}
			if (result.steps.lifecycle) {
				parts.push(`life:-${result.steps.lifecycle.degradedCount}/clr:${result.steps.lifecycle.clearedCount}`);
			}
			if (result.steps.summary) {
				parts.push(`summarized:${result.steps.summary.summarizedCount}`);
			}
			if (result.steps.classification) {
				const c = result.steps.classification as { intent: string; confidence: number };
				parts.push(`intent:${c.intent}(${(c.confidence * 100).toFixed(0)}%)`);
			}

			logMsg += ` ${parts.join(" | ")}`;

			ctx.ui.notify(logMsg, "info");

			return { messages: result.messages };
		} catch (err) {
			ctx.ui.notify(`[ctx-compress] error: ${err instanceof Error ? err.message : String(err)}`, "warning");
			return undefined;
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (totalCompressions > 0) {
			ctx.ui.notify(
				`[ctx-compress] session done: ${totalCompressions} compressions applied`,
				"info",
			);
		}
	});
}
