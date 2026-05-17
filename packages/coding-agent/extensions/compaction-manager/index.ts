import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import type { AssistantMessage } from "@dyyz1993/pi-ai";
import { DEFAULT_CONFIG, type CompactionManagerConfig } from "./config.js";
import { extractFoldSummary, estimateMessageTokens, findFoldableEntries } from "./context-fold.js";
import { microcompactMessages, stripThinkingBlocks } from "./microcompact.js";
import { buildMemorySummary, readMemoryFiles } from "./session-memory.js";
import { shouldWarn, shouldForceCompact } from "./reactive.js";

function loadConfig(): CompactionManagerConfig {
	const configPath = join(process.cwd(), ".pi", "compaction.json");
	if (existsSync(configPath)) {
		try {
			const raw = JSON.parse(readFileSync(configPath, "utf-8"));
			return {
				microcompact: { ...DEFAULT_CONFIG.microcompact, ...raw.microcompact },
				sessionMemory: { ...DEFAULT_CONFIG.sessionMemory, ...raw.sessionMemory },
				reactive: { ...DEFAULT_CONFIG.reactive, ...raw.reactive },
				contextFold: { ...DEFAULT_CONFIG.contextFold, ...raw.contextFold },
			};
		} catch (err) {
			console.debug("[compaction-manager] config load failed:", err instanceof Error ? err.message : err);
			return DEFAULT_CONFIG;
		}
	}
	return DEFAULT_CONFIG;
}

let compactMetrics = { foldCount: 0, memoryCompactCount: 0, forceCompactCount: 0, rateLimitHits: 0, serverErrors: 0 };

export default function (pi: ExtensionAPI) {
	const config = loadConfig();

	if (config.microcompact.enabled) {
		pi.on("context", (event, _ctx) => {
			const microResult = microcompactMessages(event.messages, config.microcompact.clearableTools, config.microcompact.maxAgeMs);
			const messages = microResult?.messages ?? event.messages;
			const thinkResult = stripThinkingBlocks(messages);
			return thinkResult ?? microResult;
		});
	} else {
		pi.on("context", (event, _ctx) => {
			return stripThinkingBlocks(event.messages);
		});
	}

	if (config.contextFold.enabled) {
		pi.on("turn_end", (_event, ctx) => {
			const entries = ctx.sessionManager.getBranch();

			const foldedIds = new Set<string>();
			for (const entry of entries) {
				if (entry.type === "fold") {
					foldedIds.add(entry.targetId);
				}
			}

			const foldable = findFoldableEntries(
				entries,
				foldedIds,
				config.contextFold.maxAgeMs,
				config.contextFold.keepRecentCount,
			);

			if (foldable.length === 0) return;

			for (const entry of foldable) {
				const msg = entry.message as AssistantMessage;
				const summary = extractFoldSummary(msg, config.contextFold.maxSummaryLength);
				const tokens = estimateMessageTokens(msg);
				pi.foldEntry(entry.id, summary, tokens);
			}

			compactMetrics.foldCount++;
			ctx.ui.notify(`Context fold: folded ${foldable.length} old message(s)`, "info");
			pi.appendEntry("compaction_fold", {
				count: foldable.length,
				totalFolds: compactMetrics.foldCount,
				timestamp: Date.now(),
			});
		});
	}

		if (config.sessionMemory.enabled) {
		pi.on("session_before_compact", async (event, ctx) => {
			const { preparation, signal } = event;

			const memoryFiles = await readMemoryFiles(ctx.cwd, config.sessionMemory.memoryDir);
			if (memoryFiles.size === 0 || signal.aborted) return;

			const result = buildMemorySummary(memoryFiles, preparation, config.sessionMemory.minContentLength);
			if (!result) return;

			compactMetrics.memoryCompactCount++;
			ctx.ui.notify(
				`Session Memory Compact: using ${memoryFiles.size} memory files instead of LLM summary`,
				"info",
			);
			pi.appendEntry("compaction_session_memory", {
				memoryFiles: memoryFiles.size,
				totalMemory: compactMetrics.memoryCompactCount,
				timestamp: Date.now(),
			});

			return { compaction: result };
		});
	}

	if (config.reactive.enabled) {
		let warnedThisTurn = false;

		pi.on("after_provider_response", (event, ctx) => {
			if (event.status === 429) {
				compactMetrics.rateLimitHits++;
				ctx.ui.notify("Rate limited — API is throttling requests", "warning");
				pi.appendEntry("compaction_rate_limit", {
					total: compactMetrics.rateLimitHits,
					timestamp: Date.now(),
				});
			} else if (event.status >= 500) {
				compactMetrics.serverErrors++;
				ctx.ui.notify(`API server error (${event.status}) — will retry automatically`, "warning");
				pi.appendEntry("compaction_server_error", {
					status: event.status,
					total: compactMetrics.serverErrors,
					timestamp: Date.now(),
				});
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
						compactMetrics.forceCompactCount++;
						ctx.ui.notify(`Compaction done: ${result.tokensBefore.toLocaleString()} tokens compressed`, "info");
						pi.appendEntry("compaction_force", {
							tokensBefore: result.tokensBefore,
							total: compactMetrics.forceCompactCount,
							timestamp: Date.now(),
						});
					},
					onError: (error) => {
						ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
						pi.appendEntry("compaction_failed", {
							error: error.message,
							total: compactMetrics.forceCompactCount,
							timestamp: Date.now(),
						});
					},
				});
			},
		});
	}
}
