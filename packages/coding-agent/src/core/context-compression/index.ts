/**
 * Context Compression Pipeline - Orchestration Layer
 *
 * Runs the 5-layer compression in sequence:
 *   L0: Persistence (large results → disk, stub in context)
 *   L1: Lifecycle count (keep recent N, degrade old)
 *   L2: Lifecycle time (clear stale results)
 *   L3: Zero-cost summary (structured extraction, no LLM)
 *   Classifier: Intent classification (for downstream decisions)
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { classifyConversation } from "./classifier.js";
import { applyLifecycle, estimateTokens } from "./lifecycle.js";
import { cleanupOldFiles, cleanupOrphanedFiles, persistIfNeeded, rollbackStats, snapshotStats } from "./persistence.js";
import { applySummary } from "./summary.js";
import {
	type CompressionPipelineConfig,
	DEFAULT_COMPRESSION_PIPELINE_CONFIG,
	IntentCategory,
	type LifecycleConfig,
	type PipelineResult,
	type SummaryConfig,
} from "./types.js";

// M3: Throttle orphaned-file scan to once every N pipeline invocations
let orphanCleanupCallCount = 0;
const ORPHAN_CLEANUP_INTERVAL = 10;

/**
 * Run the full context compression pipeline on a message list.
 *
 * Order of operations:
 * 1. Classify conversation intent (for logging/decision context)
 * 2. L0: Persist large tool results to disk
 * 3. L1+L2: Apply lifecycle rules (count + time-based degradation)
 * 4. L3: Summarize remaining large tool results
 *
 * Each layer is idempotent — running twice produces same result.
 */
export async function compressContext(
	messages: AgentMessage[],
	config: CompressionPipelineConfig = DEFAULT_COMPRESSION_PIPELINE_CONFIG,
): Promise<PipelineResult> {
	const startTime = Date.now();

	const tokensBefore = estimateTokens(messages);

	if (!config.enabled) {
		return {
			messages,
			steps: {},
			tokensBefore,
			tokensAfter: tokensBefore,
			durationMs: Date.now() - startTime,
		};
	}

	const steps: NonNullable<PipelineResult["steps"]> = {};

	let currentMessages = messages;
	let lastSuccessfulMessages = messages;

	// Step -1: Cleanup orphaned files from previous sessions (throttled to once every N calls)
	orphanCleanupCallCount++;
	if (orphanCleanupCallCount % ORPHAN_CLEANUP_INTERVAL === 1) {
		try {
			await cleanupOrphanedFiles(config.persistence);
		} catch {
			// Orphaned cleanup is best-effort
		}
	}

	// Step 0: Classify intent (for downstream config adjustment)
	let detectedIntent: IntentCategory = IntentCategory.CHITCHAT;
	try {
		const userTexts = currentMessages
			.filter((m) => m.role === "user")
			.map((m) => {
				const c = (m as unknown as { content?: string | Array<{ type?: string; text?: string }> }).content;
				if (typeof c === "string") return c;
				if (Array.isArray(c))
					return c
						.filter((b) => b.type === "text")
						.map((b) => b.text)
						.join(" ");
				return "";
			})
			.filter((t) => t.trim());

		if (userTexts.length > 0) {
			const classification = classifyConversation(
				userTexts.map((t) => ({ role: "user", text: t })),
				config.classifier,
			);
			detectedIntent = classification.intent;
			steps.classification = {
				intent: classification.intent,
				confidence: classification.confidence,
			};
		}
	} catch {
		// Classification is best-effort; don't fail pipeline
	}

	// Step L0: Persist large results
	if (config.persistence.largeThreshold > 0) {
		const statsSnapshot = snapshotStats();
		try {
			let persistedCount = 0;
			let bytesSaved = 0;
			const nextMessages: AgentMessage[] = [];

			for (const msg of currentMessages) {
				if (msg.role !== "toolResult") {
					nextMessages.push(msg);
					continue;
				}

				const content = extractToolContent(msg);
				if (content === null) {
					nextMessages.push(msg);
					continue;
				}

				const toolName = (msg as unknown as { toolName?: string }).toolName ?? "unknown";
				const size = Buffer.byteLength(content, "utf-8");

				if (
					size < config.persistence.largeThreshold ||
					config.persistence.exemptTools.has(toolName.toLowerCase())
				) {
					nextMessages.push(msg);
					continue;
				}

				const result = await persistIfNeeded({ toolName, content }, config.persistence);
				if (result.persisted) {
					persistedCount++;
					bytesSaved += result.originalSize - Buffer.byteLength(result.stub, "utf-8");
					// Preserve image blocks in persisted stub
					const msgContent = (msg as unknown as { content?: Array<{ type?: string; [key: string]: unknown }> })
						.content;
					const imageParts = Array.isArray(msgContent) ? msgContent.filter((p) => p.type === "image") : [];
					nextMessages.push({
						...msg,
						content: [{ type: "text", text: result.stub }, ...imageParts],
					} as unknown as AgentMessage);
				} else {
					nextMessages.push(msg);
				}
			}

			currentMessages = nextMessages;
			lastSuccessfulMessages = currentMessages;
			cleanupOldFiles(config.persistence);

			if (persistedCount > 0) {
				steps.persistence = { persistedCount, bytesSaved };
			}
		} catch {
			currentMessages = lastSuccessfulMessages;
			rollbackStats(statsSnapshot);
		}
	}

	// Step L1+L2: Lifecycle management (M4: intent-aware config adjustment)
	if (config.lifecycle.enabled) {
		try {
			const lifecycleConfig = adjustLifecycleForIntent(config.lifecycle, detectedIntent);
			const lifecycleResult = await applyLifecycle(currentMessages, lifecycleConfig);
			currentMessages = lifecycleResult.messages;
			lastSuccessfulMessages = currentMessages;

			if (lifecycleResult.degradedCount > 0 || lifecycleResult.clearedCount > 0) {
				steps.lifecycle = {
					degradedCount: lifecycleResult.degradedCount,
					clearedCount: lifecycleResult.clearedCount,
				};
			}
		} catch {
			currentMessages = lastSuccessfulMessages;
		}
	}

	// Step L3: Zero-cost summarization (M4: intent-aware config adjustment)
	if (config.summary.enabled) {
		try {
			const summaryConfig = adjustSummaryForIntent(config.summary, detectedIntent);
			const summaryResult = await applySummary(currentMessages, summaryConfig);
			currentMessages = summaryResult.messages;
			lastSuccessfulMessages = currentMessages;

			if (summaryResult.summarizedCount > 0) {
				steps.summary = {
					summarizedCount: summaryResult.summarizedCount,
				};
			}
		} catch {
			currentMessages = lastSuccessfulMessages;
		}
	}

	return {
		messages: lastSuccessfulMessages,
		steps,
		tokensBefore,
		tokensAfter: estimateTokens(lastSuccessfulMessages),
		durationMs: Date.now() - startTime,
	};
}

// ============================================================================
// M4: Intent-aware config adjustment
// ============================================================================

/**
 * Adjust lifecycle config based on classified conversation intent.
 * - BUG: conservative (keep more, clear less aggressively)
 * - CHITCHAT: aggressive (compress more, keep fewer recent)
 * - REQUIREMENT/EXPLORATION: normal defaults
 */
function adjustLifecycleForIntent(base: LifecycleConfig, intent: IntentCategory): LifecycleConfig {
	switch (intent) {
		case IntentCategory.BUG:
			return { ...base, keepRecent: base.keepRecent * 2, staleMinutes: base.staleMinutes * 2 };
		case IntentCategory.CHITCHAT:
			return {
				...base,
				keepRecent: Math.max(2, Math.floor(base.keepRecent / 2)),
				staleMinutes: Math.floor(base.staleMinutes / 2),
			};
		default:
			return base;
	}
}

/**
 * Adjust summary config based on classified conversation intent.
 * - BUG: raise threshold (summarize less, preserve detail)
 * - CHITCHAT: lower threshold (summarize more aggressively)
 */
function adjustSummaryForIntent(base: SummaryConfig, intent: IntentCategory): SummaryConfig {
	switch (intent) {
		case IntentCategory.BUG:
			return { ...base, maxLines: base.maxLines * 2, truncateLine: base.truncateLine * 2 };
		case IntentCategory.CHITCHAT:
			return {
				...base,
				maxLines: Math.max(5, Math.floor(base.maxLines / 2)),
				truncateLine: Math.max(40, Math.floor(base.truncateLine / 2)),
			};
		default:
			return base;
	}
}

// ============================================================================
// Helpers
// ============================================================================

function extractToolContent(msg: AgentMessage): string | null {
	const content = (msg as unknown as { content?: string | Array<{ type?: string; text?: string }> }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts = content.filter((p) => p.type === "text" && p.text).map((p) => p.text);
		if (parts.length > 0) return parts.join("\n");
	}
	return null;
}

export { classifyConversation, classifyMessage } from "./classifier.js";
export { applyLifecycle, estimateTokens } from "./lifecycle.js";
export { cleanupOldFiles, persistIfNeeded, readPersistedFile } from "./persistence.js";
export { summarizeToolResult } from "./summary.js";
