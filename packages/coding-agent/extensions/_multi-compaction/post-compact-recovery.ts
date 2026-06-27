/**
 * Post-Compaction File Recovery
 *
 * After LLM summarization (compact_history), the model loses file context
 * because file contents from earlier read/edit tool calls are replaced by
 * the summary. This module re-attaches the most recently read/edited files
 * so the model can continue working without re-reading them.
 *
 * Inspired by Claude Code's architecture: after compaction, automatically
 * restore file context by appending user-role messages with file contents.
 */

import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";

// ============================================================================
// Types
// ============================================================================

/** File operations tracked during compaction preparation. */
interface FileOps {
	read: Set<string>;
	edited: Set<string>;
}

/** Configuration for post-compaction file recovery. */
export interface RecoveryConfig {
	/** Whether post-compact recovery is enabled. */
	enabled: boolean;
	/** Maximum number of files to restore. */
	maxFilesToRestore: number;
	/** Maximum estimated tokens per file. Files exceeding this are skipped. */
	maxTokensPerFile: number;
	/** Total token budget across all restored files. */
	totalTokenBudget: number;
}

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
	enabled: true,
	maxFilesToRestore: 5,
	maxTokensPerFile: 5000,
	totalTokenBudget: 50000,
};

// ============================================================================
// Helpers
// ============================================================================

/** Size threshold for skipping files (8KB check buffer). */
const BINARY_CHECK_BYTES = 8192;

/**
 * Safely read a file's content from disk.
 * Returns undefined if the file does not exist, is too large, or is binary.
 */
export function readFileContent(filePath: string): string | undefined {
	if (!existsSync(filePath)) return undefined;

	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(filePath);
	} catch {
		return undefined;
	}

	// Skip directories and very large files (>1MB)
	if (!stat.isFile()) return undefined;
	if (stat.size > 1_000_000) return undefined;

	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}

	// Binary file check: look for null bytes in the first 8KB
	const checkSlice = content.slice(0, BINARY_CHECK_BYTES);
	if (checkSlice.includes("\0")) return undefined;

	return content;
}

/**
 * Estimate the number of tokens in a string.
 * Uses a simple chars/4 heuristic.
 */
export function estimateFileTokens(content: string): number {
	return Math.ceil(content.length / 4);
}

// ============================================================================
// Core
// ============================================================================

/**
 * Build recovery messages to append after a compaction summary.
 *
 * Prioritizes edited files over read-only files, reads each from disk,
 * and generates user-role messages that restore file context for the model.
 *
 * Returns an empty array if nothing to restore or recovery is disabled.
 */
export function buildRecoveryMessages(
	fileOps: FileOps,
	cwd: string,
	config: RecoveryConfig = DEFAULT_RECOVERY_CONFIG,
): AgentMessage[] {
	if (!config.enabled) return [];

	// Deduplicate: edited files may also appear in read set
	const editedPaths = [...fileOps.edited];
	const readPaths = [...fileOps.read].filter((p) => !fileOps.edited.has(p));

	// Edited files first, then read-only files
	const candidates = [...editedPaths, ...readPaths];
	if (candidates.length === 0) return [];

	const messages: AgentMessage[] = [];
	let totalTokens = 0;
	let fileCount = 0;

	for (const rawPath of candidates) {
		if (fileCount >= config.maxFilesToRestore) break;
		if (totalTokens >= config.totalTokenBudget) break;

		const absolutePath = rawPath.startsWith("/") ? rawPath : join(cwd, rawPath);
		const content = readFileContent(absolutePath);
		if (content === undefined) continue;

		const tokens = estimateFileTokens(content);
		if (tokens > config.maxTokensPerFile) continue;
		if (totalTokens + tokens > config.totalTokenBudget) continue;

		totalTokens += tokens;
		fileCount++;

		messages.push({
			role: "user",
			content: `[File context restored: ${rawPath}]\n${content}`,
			timestamp: Date.now(),
		});
	}

	return messages;
}
