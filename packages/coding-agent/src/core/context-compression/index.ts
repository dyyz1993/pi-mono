/**
 * Context Compression Pipeline - Orchestration Layer
 *
 * Compression strategies:
 * - Scoring: Intelligent per-tool-result scoring (Score = BaseScore + SizeBonus + AgePenalty + RepeatPenalty + ContentBonus)
 * - L0: Persistence (large results → disk, stub in context)
 * - L1: Lifecycle count (keep recent N, degrade old)
 * - L2: Lifecycle time (clear stale results)
 * - L3: Zero-cost summary (structured extraction, no LLM)
 * - Classifier: Intent classification (for downstream decisions)
 *
 * When scoring is enabled, it takes precedence over L0/L1/L2/L3.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { classifyConversation } from "./classifier.js";
import { applyLifecycle, estimateTokens } from "./lifecycle.js";
import { compressionLogger } from "./logger.js";
import { cleanupOldFiles, cleanupOrphanedFiles, persistIfNeeded, rollbackStats, snapshotStats } from "./persistence.js";
import { scoreAllToolResults } from "./scoring.js";
import { applySummary, summarizeToolResult } from "./summary.js";
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
	const sessionId = `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

	const tokensBefore = estimateTokens(messages);

	// 启动日志会话
	compressionLogger.startSession(sessionId, messages.length, tokensBefore);

	if (!config.enabled) {
		const tokensAfter = tokensBefore;
		compressionLogger.endSession(tokensAfter, Date.now() - startTime);
		return {
			messages,
			steps: {},
			tokensBefore,
			tokensAfter,
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
			
			// 记录意图分类
			compressionLogger.logIntent(classification.intent, classification.confidence);
		}
	} catch (error) {
		// Classification is best-effort; don't fail pipeline
		compressionLogger.logError("classification", error instanceof Error ? error : String(error));
	}

	// Step Scoring: Intelligent per-tool-result compression based on scoring
	if (config.scoring?.enabled) {
		try {
			const scoringResult = await applyScoring(currentMessages, config, sessionId);
			currentMessages = scoringResult.messages;

			if (
				scoringResult.protectCount > 0 ||
				scoringResult.persistCount > 0 ||
				scoringResult.summaryCount > 0 ||
				scoringResult.persistShortCount > 0 ||
				scoringResult.dropCount > 0
			) {
				steps.scoring = {
					protectCount: scoringResult.protectCount,
					persistCount: scoringResult.persistCount,
					summaryCount: scoringResult.summaryCount,
					persistShortCount: scoringResult.persistShortCount,
					dropCount: scoringResult.dropCount,
				};
			}
		} catch (error) {
			compressionLogger.logError("scoring", error instanceof Error ? error : String(error));
			currentMessages = lastSuccessfulMessages;
		}
	} else {
		// Legacy pipeline: L0/L1/L2/L3
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
					compressionLogger.logPersistence("multiple", 0, "multiple", bytesSaved);
				}
			} catch (error) {
				compressionLogger.logError("persistence", error instanceof Error ? error : String(error));
				currentMessages = lastSuccessfulMessages;
				rollbackStats(statsSnapshot);
			}
		}

		// Step L1+L2: Lifecycle management
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
					compressionLogger.logLifecycle(lifecycleResult.degradedCount, lifecycleResult.clearedCount);
				}
			} catch (error) {
				compressionLogger.logError("lifecycle", error instanceof Error ? error : String(error));
				currentMessages = lastSuccessfulMessages;
			}
		}

		// Step L3: Zero-cost summarization
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
					compressionLogger.logSummary("multiple", 0, summaryResult.summarizedCount);
				}
			} catch (error) {
				compressionLogger.logError("summary", error instanceof Error ? error : String(error));
				currentMessages = lastSuccessfulMessages;
			}
		}
	}

	const tokensAfter = estimateTokens(lastSuccessfulMessages);
	const durationMs = Date.now() - startTime;
	
	// 结束日志会话
	compressionLogger.endSession(tokensAfter, durationMs);

	return {
		messages: lastSuccessfulMessages,
		steps,
		tokensBefore,
		tokensAfter,
		durationMs,
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
// Scoring: Intelligent per-tool-result compression
// ============================================================================

const _SUMMARY_MARKER = "[summarized]";
const CLEARED_MARKER = "[cleared]";
const _PERSIST_SHORT_MARKER = "[persist-short]";

interface ScoringApplyResult {
	messages: AgentMessage[];
	protectCount: number;
	persistCount: number;
	summaryCount: number;
	persistShortCount: number;
	dropCount: number;
}

async function applyScoring(
	messages: AgentMessage[],
	config: CompressionPipelineConfig,
	sessionId: string,
): Promise<ScoringApplyResult> {
	const now = Date.now();
	const result: ScoringApplyResult = {
		messages: [],
		protectCount: 0,
		persistCount: 0,
		summaryCount: 0,
		persistShortCount: 0,
		dropCount: 0,
	};

	const scoredResults = scoreAllToolResults(messages, { currentTime: now });

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		const scored = scoredResults.find((s) => s.messageIndex === i);

		if (msg.role !== "toolResult" || !scored) {
			result.messages.push(msg);
			continue;
		}

		const { score, toolName, content } = scored;

		switch (score.strategy) {
			case "protected": {
				result.messages.push(msg);
				result.protectCount++;
				
				// 记录决策
				compressionLogger.logToolResultDecision({
					messageIndex: i,
					toolName,
					strategy: "protected",
					score: score.normalized,
					breakdown: score.breakdown,
					reason: score.reason,
					contentPreview: content.substring(0, 100),
					originalSize: content.length,
					compressedSize: content.length,
					savedBytes: 0,
				});
				break;
			}

			case "persist": {
				const persisted = await persistIfNeeded(
					{ toolName, content, timestamp: scored.timestamp },
					config.persistence,
				);
				if (persisted.persisted) {
					result.persistCount++;
					const imageParts = extractImageParts(msg);
					const compressedContent = persisted.stub;
					result.messages.push({
						...msg,
						content: [{ type: "text", text: compressedContent }, ...imageParts],
					} as unknown as AgentMessage);
					
					// 记录决策
					compressionLogger.logToolResultDecision({
						messageIndex: i,
						toolName,
						strategy: "persist",
						score: score.normalized,
						breakdown: score.breakdown,
						reason: score.reason,
						contentPreview: content.substring(0, 100),
						originalSize: content.length,
						compressedSize: compressedContent.length,
						savedBytes: content.length - compressedContent.length,
					});
					
					// 记录持久化
					compressionLogger.logPersistence(toolName, content.length, persisted.path || "unknown", content.length - compressedContent.length);
				} else {
					result.messages.push(msg);
				}
				break;
			}

			case "summary": {
				const note = summarizeToolResult(toolName, content, config.summary);
				if (note.formatted.length < content.length) {
					result.summaryCount++;
					result.messages.push({
						...msg,
						content: [{ type: "text", text: note.formatted }],
					} as unknown as AgentMessage);
					
					// 记录决策
					compressionLogger.logToolResultDecision({
						messageIndex: i,
						toolName,
						strategy: "summary",
						score: score.normalized,
						breakdown: score.breakdown,
						reason: score.reason,
						contentPreview: content.substring(0, 100),
						originalSize: content.length,
						compressedSize: note.formatted.length,
						savedBytes: content.length - note.formatted.length,
					});
				} else {
					result.messages.push(msg);
				}
				break;
			}

			case "persist_short": {
				const persisted = await persistIfNeeded(
					{ toolName, content, timestamp: scored.timestamp, maxAgeMs: 30 * 60 * 1000 },
					config.persistence,
				);
				if (persisted.persisted) {
					result.persistShortCount++;
					const imageParts = extractImageParts(msg);
					const compressedContent = persisted.stub;
					result.messages.push({
						...msg,
						content: [{ type: "text", text: compressedContent }, ...imageParts],
					} as unknown as AgentMessage);
					
					// 记录决策
					compressionLogger.logToolResultDecision({
						messageIndex: i,
						toolName,
						strategy: "persist_short",
						score: score.normalized,
						breakdown: score.breakdown,
						reason: score.reason,
						contentPreview: content.substring(0, 100),
						originalSize: content.length,
						compressedSize: compressedContent.length,
						savedBytes: content.length - compressedContent.length,
					});
				} else {
					const compressedContent = `${CLEARED_MARKER} [${toolName}]`;
					result.messages.push({
						...msg,
						content: [{ type: "text", text: compressedContent }],
					} as unknown as AgentMessage);
					result.dropCount++;
					
					// 记录决策
					compressionLogger.logToolResultDecision({
						messageIndex: i,
						toolName,
						strategy: "drop",
						score: score.normalized,
						breakdown: score.breakdown,
						reason: "persist_short failed, fallback to drop",
						contentPreview: content.substring(0, 100),
						originalSize: content.length,
						compressedSize: compressedContent.length,
						savedBytes: content.length - compressedContent.length,
					});
				}
				break;
			}

			case "drop": {
				result.dropCount++;
				const compressedContent = `${CLEARED_MARKER} [${toolName}]`;
				result.messages.push({
					...msg,
					content: [{ type: "text", text: compressedContent }],
				} as unknown as AgentMessage);
				
				// 记录决策
				compressionLogger.logToolResultDecision({
					messageIndex: i,
					toolName,
					strategy: "drop",
					score: score.normalized,
					breakdown: score.breakdown,
					reason: score.reason,
					contentPreview: content.substring(0, 100),
					originalSize: content.length,
					compressedSize: compressedContent.length,
					savedBytes: content.length - compressedContent.length,
				});
				break;
			}
		}
	}

	return result;
}

function extractImageParts(msg: AgentMessage): Array<{ type: string; [key: string]: unknown }> {
	const content = (msg as unknown as { content?: Array<{ type?: string; [key: string]: unknown }> }).content;
	return Array.isArray(content)
		? content.filter((p): p is { type: string; [key: string]: unknown } => p.type === "image")
		: [];
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
export { compressionLogger } from "./logger.js";
export { cleanupOldFiles, persistIfNeeded, readPersistedFile } from "./persistence.js";
export { summarizeToolResult } from "./summary.js";
