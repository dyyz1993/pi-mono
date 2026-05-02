import type { ExtensionAPI } from "../../src/core/extensions/index.js";
import { DEFAULT_CONFIG } from "./config.js";
import { microcompactMessages } from "./microcompact.js";
import { buildMemorySummary, readMemoryFiles } from "./session-memory.js";
import { shouldWarn, shouldForceCompact } from "./reactive.js";

export default function (pi: ExtensionAPI) {
	const config = DEFAULT_CONFIG;

	if (config.microcompact.enabled) {
		pi.on("context", (event, _ctx) => {
			return microcompactMessages(event.messages, config.microcompact.clearableTools, config.microcompact.maxAgeMs);
		});
	}

	if (config.sessionMemory.enabled) {
		pi.on("session_before_compact", async (event, ctx) => {
			const { preparation, signal } = event;

			const memoryFiles = await readMemoryFiles(ctx.cwd, config.sessionMemory.memoryDir);
			if (memoryFiles.size === 0 || signal.aborted) return;

			const result = buildMemorySummary(memoryFiles, preparation, config.sessionMemory.minContentLength);
			if (!result) return;

			ctx.ui.notify(
				`Session Memory Compact: using ${memoryFiles.size} memory files instead of LLM summary`,
				"info",
			);

			return { compaction: result };
		});
	}

	if (config.reactive.enabled) {
		let warnedThisTurn = false;

		pi.on("after_provider_response", (event, ctx) => {
			if (event.status === 429) {
				ctx.ui.notify("Rate limited — API is throttling requests", "warning");
			} else if (event.status >= 500) {
				ctx.ui.notify(`API server error (${event.status}) — will retry automatically`, "warning");
			}
		});

		pi.on("turn_end", (_event, ctx) => {
			const usage = ctx.getContextUsage();
			if (!usage || usage.tokens === null) return;

			const { tokens, contextWindow, percent } = usage;

			if (shouldForceCompact(tokens, contextWindow, config.reactive.forceCompactPercent) && !warnedThisTurn) {
				ctx.ui.notify(
					`Context critical: ${percent!.toFixed(0)}% (${tokens!.toLocaleString()} / ${contextWindow.toLocaleString()} tokens). Consider /compact-force.`,
					"warning",
				);
				warnedThisTurn = true;
				return;
			}

			if (shouldWarn(tokens, contextWindow, config.reactive.warnPercent) && !warnedThisTurn) {
				ctx.ui.notify(
					`Context high: ${percent!.toFixed(0)}% (${tokens!.toLocaleString()} / ${contextWindow.toLocaleString()} tokens)`,
					"info",
				);
				warnedThisTurn = true;
			}
		});

		pi.on("agent_start", () => {
			warnedThisTurn = false;
		});

		pi.registerCommand("compact-force", {
			description: "Force compaction immediately with optional custom instructions",
			handler: async (args, ctx) => {
				const instructions = args.trim() || undefined;
				ctx.compact({
					customInstructions: instructions,
					onComplete: (result) => {
						ctx.ui.notify(`Compaction done: ${result.tokensBefore.toLocaleString()} tokens compressed`, "info");
					},
					onError: (error) => {
						ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
					},
				});
			},
		});
	}
}
