import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import type { AssistantMessage } from "@dyyz1993/pi-ai";
import { DEFAULT_CONFIG, type CompactionManagerConfig, type CompactionStrategy } from "./config.ts";
import { extractFoldSummary, findFoldableEntries } from "./context-fold.ts";
import { microcompactMessages, cachedMicrocompact, stripThinkingBlocks } from "./microcompact.ts";
import { buildMemorySummary, readMemoryFiles } from "./session-memory.ts";
import { shouldWarn, shouldForceCompact } from "./reactive.ts";
import { prepareHalfCompaction } from "./half-compaction.ts";
import { prepareSegmentCompaction } from "./segment-compaction.ts";
import { applySlidingWindow } from "./sliding-window.ts";
import { budgetToolResults } from "./tool-result-budget.ts";
import { snipCompact } from "./snip-compact.ts";
import { buildRecoveryMessages } from "./post-compact-recovery.ts";
import { foldDuplicateLines } from "./line-fold.ts";

function loadConfig(): CompactionManagerConfig {
	const configPath = join(process.cwd(), ".pi", "compaction.json");
	if (existsSync(configPath)) {
		try {
			const raw = JSON.parse(readFileSync(configPath, "utf-8"));
			return {
				toolResultBudget: { ...DEFAULT_CONFIG.toolResultBudget, ...raw.toolResultBudget },
				snipCompact: { ...DEFAULT_CONFIG.snipCompact, ...raw.snipCompact },
				lineFold: { ...DEFAULT_CONFIG.lineFold, ...raw.lineFold },
				microcompact: { ...DEFAULT_CONFIG.microcompact, ...raw.microcompact },
				sessionMemory: { ...DEFAULT_CONFIG.sessionMemory, ...raw.sessionMemory },
				reactive: { ...DEFAULT_CONFIG.reactive, ...raw.reactive },
				contextFold: { ...DEFAULT_CONFIG.contextFold, ...raw.contextFold },
				strategy: (raw.strategy as CompactionStrategy) ?? DEFAULT_CONFIG.strategy,
				halfCompaction: { ...DEFAULT_CONFIG.halfCompaction, ...raw.halfCompaction },
				segmentCompaction: { ...DEFAULT_CONFIG.segmentCompaction, ...raw.segmentCompaction },
				slidingWindow: { ...DEFAULT_CONFIG.slidingWindow, ...raw.slidingWindow },
				postCompactRecovery: { ...DEFAULT_CONFIG.postCompactRecovery, ...raw.postCompactRecovery },
			};
		} catch (err) {
			console.debug("[multi-compaction] config load failed:", err instanceof Error ? err.message : err);
			return DEFAULT_CONFIG;
		}
	}
	return DEFAULT_CONFIG;
}

let compactMetrics = {
	foldCount: 0,
	memoryCompactCount: 0,
	forceCompactCount: 0,
	rateLimitHits: 0,
	serverErrors: 0,
	strategyCompactCount: 0,
	slidingWindowTruncations: 0,
	toolResultBudgetPersisted: 0,
	snipCompactCount: 0,
	recoveryCount: 0,
};

export default function (pi: ExtensionAPI) {
	const config = loadConfig();

	pi.on("session_start", () => {
		compactMetrics = {
			foldCount: 0,
			memoryCompactCount: 0,
			forceCompactCount: 0,
			rateLimitHits: 0,
			serverErrors: 0,
			strategyCompactCount: 0,
			slidingWindowTruncations: 0,
			toolResultBudgetPersisted: 0,
			snipCompactCount: 0,
			recoveryCount: 0,
		};
	});

	// === L0: Tool result budget — persist oversized tool results to disk ===
	if (config.toolResultBudget.enabled) {
		pi.on("context", (event, _ctx) => {
			const result = budgetToolResults(event.messages, config.toolResultBudget);
			if (result) {
				compactMetrics.toolResultBudgetPersisted++;
				pi.appendEntry("compaction_tool_result_budget", {
					total: compactMetrics.toolResultBudgetPersisted,
					timestamp: Date.now(),
				});
				return result;
			}
		});
	}

	// === L1: Snip compact — trim middle of long conversations ===
	if (config.snipCompact.enabled) {
		pi.on("context", (event, _ctx) => {
			const result = snipCompact(event.messages, config.snipCompact);
			if (result) {
				compactMetrics.snipCompactCount++;
				pi.appendEntry("compaction_snip", {
					total: compactMetrics.snipCompactCount,
					timestamp: Date.now(),
				});
				return result;
			}
		});
	}

	// === L1.5: Line fold — fold consecutive identical lines in tool results ===
	if (config.lineFold.enabled) {
		pi.on("context", (event, _ctx) => {
			return foldDuplicateLines(event.messages, config.lineFold);
		});
	}

	// === Sliding window: intercept context hook (no LLM, no CompactionEntry) ===
	if (config.strategy === "sliding-window" || config.slidingWindow.enabled) {
		pi.on("context", (event, _ctx) => {
			const result = applySlidingWindow(event.messages, config.slidingWindow);
			if (result) {
				compactMetrics.slidingWindowTruncations++;
				pi.appendEntry("compaction_sliding_window", {
					total: compactMetrics.slidingWindowTruncations,
					timestamp: Date.now(),
				});
				return result;
			}
		});
	}

	// === L2: Microcompact — clear old tool results (time-based + cached) and strip thinking ===
	if (config.microcompact.enabled) {
		pi.on("context", (event, _ctx) => {
			// Time-based path
			let microResult = microcompactMessages(event.messages, config.microcompact.clearableTools, config.microcompact.keepRecentCount);
			let messages = microResult?.messages ?? event.messages;

			// Cached path: keep only N most recent tool results with full content
			const cachedResult = cachedMicrocompact(messages, config.microcompact.clearableTools, config.microcompact.maxCachedResults);
			messages = cachedResult?.messages ?? messages;

			const thinkResult = stripThinkingBlocks(messages);
			return thinkResult ?? (microResult || cachedResult ? { messages } : undefined);
		});
	} else {
		pi.on("context", (event, _ctx) => {
			return stripThinkingBlocks(event.messages);
		});
	}

	// === Context fold: fold old assistant messages ===
	if (config.contextFold.enabled) {
		pi.on("turn_end", (_event, ctx) => {
			const entries = ctx.sessionManager.getBranch();

			// Track already-deleted entries to skip them
			const deletedIds = new Set<string>();
			for (const entry of entries) {
				if (entry.type === "deletion") {
					for (const targetId of (entry as { targets?: string[] }).targets ?? []) {
						deletedIds.add(targetId);
					}
				}
			}

			const foldable = findFoldableEntries(
				entries,
				deletedIds,
				config.contextFold.maxAgeMs,
				config.contextFold.keepRecentCount,
			);

			if (foldable.length === 0) return;

			const foldIds: string[] = [];
			for (const entry of foldable) {
				const msg = entry.message as AssistantMessage;
				const summary = extractFoldSummary(msg, config.contextFold.maxSummaryLength);
				// Replace the original entry with a compact summary via deletion + custom entry
				foldIds.push(entry.id);
				pi.appendEntry("compaction_fold", {
					originalEntryId: entry.id,
					summary,
					timestamp: Date.now(),
				});
			}

			pi.deleteEntries(foldIds);

			compactMetrics.foldCount += foldable.length;
			ctx.ui.notify(`Context fold: folded ${foldable.length} old message(s)`, "info");
		});
	}

	// === Half / Segment compaction: intercept session_before_compact ===
	if (config.strategy === "half" || config.strategy === "segment") {
		pi.on("session_before_compact", async (event, _ctx) => {
			const { preparation, signal } = event;
			if (signal.aborted) return;

			let result: ReturnType<typeof prepareHalfCompaction> | ReturnType<typeof prepareSegmentCompaction> = null;

			if (config.strategy === "half") {
				result = prepareHalfCompaction(preparation, config.halfCompaction);
			} else if (config.strategy === "segment") {
				result = prepareSegmentCompaction(preparation, config.segmentCompaction);
			}

			if (!result) return; // fall through to default full compaction

			compactMetrics.strategyCompactCount++;
			pi.appendEntry("compaction_strategy", {
				strategy: config.strategy,
				tokensBefore: result.tokensBefore,
				total: compactMetrics.strategyCompactCount,
				timestamp: Date.now(),
			});

			return { compaction: result };
		});
	}

	// === Session memory: override compaction with memory files ===
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

	// === Post-compaction recovery: re-attach recently read/edited files ===
	if (config.postCompactRecovery.enabled) {
		pi.on("session_compact", async (_event, ctx) => {
			const entries = ctx.sessionManager.getBranch();
			// Find the latest compaction entry to get file details
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i];
				if (entry.type !== "compaction") continue;
				const details = entry.details as { readFiles?: string[]; modifiedFiles?: string[] } | undefined;
				if (!details) break;

				const fileOps = {
					read: new Set(details.readFiles ?? []),
					edited: new Set(details.modifiedFiles ?? []),
				};

				const recoveryMessages = buildRecoveryMessages(fileOps, ctx.cwd, config.postCompactRecovery);
				if (recoveryMessages.length === 0) break;

				compactMetrics.recoveryCount++;
				ctx.ui.notify(
					`Post-compact recovery: restored ${recoveryMessages.length} file(s) into context`,
					"info",
				);
				pi.appendEntry("compaction_recovery", {
					filesRestored: recoveryMessages.length,
					total: compactMetrics.recoveryCount,
					timestamp: Date.now(),
				});

				// Append recovery messages as custom entries so they appear in context
				for (const msg of recoveryMessages) {
					const content = (msg as { content: Array<{ type: string; text: string }> }).content;
					pi.appendEntry("compaction_recovery", {
						fileContent: content.map((b) => b.text).join("\n"),
						timestamp: Date.now(),
					});
				}

				break;
			}
		});
	}

	// === Reactive: context usage warnings and /compact-force ===
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

		pi.on("session_start", () => {
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
