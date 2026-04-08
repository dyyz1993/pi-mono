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
import { applyLifecycle } from "./lifecycle.js";
import { cleanupOldFiles, cleanupOrphanedFiles, persistIfNeeded } from "./persistence.js";
import { applySummary } from "./summary.js";
import { type CompressionPipelineConfig, DEFAULT_COMPRESSION_PIPELINE_CONFIG, type PipelineResult } from "./types.js";

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

	if (!config.enabled) {
		return {
			messages,
			steps: {},
			tokensBefore: 0,
			tokensAfter: 0,
			durationMs: Date.now() - startTime,
		};
	}

	const steps: NonNullable<PipelineResult["steps"]> = {};

	let currentMessages = messages;
	let lastSuccessfulMessages = messages;

	// Step -1: Cleanup orphaned files from previous sessions (runs once per pipeline)
	try {
		await cleanupOrphanedFiles(config.persistence);
	} catch {
		// Orphaned cleanup is best-effort
	}

	// Step 0: Classify intent (lightweight, for metadata)
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
					nextMessages.push({
						...msg,
						content: [{ type: "text", text: result.stub }],
					} as AgentMessage);
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
			// Persistence failure shouldn't block other layers
		}
	}

	// Step L1+L2: Lifecycle management
	if (config.lifecycle.enabled) {
		try {
			const lifecycleResult = await applyLifecycle(currentMessages, config.lifecycle);
			currentMessages = lifecycleResult.messages;

			if (lifecycleResult.degradedCount > 0 || lifecycleResult.clearedCount > 0) {
				steps.lifecycle = {
					degradedCount: lifecycleResult.degradedCount,
					clearedCount: lifecycleResult.clearedCount,
				};
			}
		} catch {
			// Lifecycle failure shouldn't block summary
		}
	}

	// Step L3: Zero-cost summarization
	if (config.summary.enabled) {
		try {
			const summaryResult = await applySummary(currentMessages, config.summary);
			currentMessages = summaryResult.messages;

			if (summaryResult.summarizedCount > 0) {
				steps.summary = {
					summarizedCount: summaryResult.summarizedCount,
				};
			}
		} catch {
			// Summary failure is non-fatal
		}
	}

	return {
		messages: currentMessages,
		steps,
		tokensBefore: 0, // Estimated at higher level if needed
		tokensAfter: 0,
		durationMs: Date.now() - startTime,
	};
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
export { applyLifecycle } from "./lifecycle.js";
export { cleanupOldFiles, persistIfNeeded, readPersistedFile } from "./persistence.js";
export { summarizeToolResult } from "./summary.js";
