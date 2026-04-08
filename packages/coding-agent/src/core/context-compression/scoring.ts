/**
 * Tool Result Scoring System
 *
 * Scores each tool result to decide compression strategy:
 *   Score = BaseScore(工具类型) + SizeBonus + AgePenalty + RepeatPenalty + ContentBonus
 *
 * Strategy mapping:
 *   90-100 → protected (完全保留)
 *   70-89  → persist (持久化到磁盘)
 *   50-69  → summary (零成本摘要)
 *   30-49  → persist_short (持久化但快速过期)
 *   0-29   → drop (直接清理)
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ============================================================================
// Tool Base Scores
// ============================================================================

export const TOOL_BASE_SCORE: Record<string, number> = {
	write: 100,
	edit: 100,
	create: 100,
	delete: 100,
	read: 70,
	cat: 70,
	view: 70,
	grep: 60,
	git_diff: 60,
	git_log: 50,
	bash: 30,
	glob: 40,
	find: 40,
	git_status: 20,
	git_branch: 20,
	pwd: 10,
	whoami: 10,
};

// ============================================================================
// Score Thresholds
// ============================================================================

export const SCORE_THRESHOLDS = {
	PROTECTED: 90,
	PERSIST: 70,
	SUMMARY: 50,
	PERSIST_SHORT: 30,
	DROP: 0,
} as const;

// ============================================================================
// Lifecycle Decay Config
// ============================================================================

export const LIFECYCLE_DECAY = {
	freshMinutes: 5,
	shortMinutes: 15,
	mediumMinutes: 30,
	longMinutes: 60,
} as const;

// ============================================================================
// Content Pattern Definitions
// ============================================================================

const CRITICAL_PATTERNS: RegExp[] = [
	/^Error:/m,
	/^TypeError:/m,
	/^ReferenceError:/m,
	/^SyntaxError:/m,
	/^RangeError:/m,
	/<<<<<<<\s*HEAD/m,
	/>>>>>>>/m,
	/\bFAIL\s+\d+/m,
	/failed with exit code [1-9]/m,
	/password/i,
	/secret/i,
	/token/i,
	/api[_-]?key/i,
	/AUTHORIZATION/i,
];

const IMPORTANT_PATTERNS: RegExp[] = [
	/^(export|import|class|interface|function|const|let|var)\s+\w+/m,
	/\bdescribe\(|it\(|test\(/,
	/\{[\s\S]*"[\w]+"\s*:/,
];

const LOW_VALUE_PATTERNS: RegExp[] = [
	/^Built in \d+(\.\d+)?s$/m,
	/^Done\.?\s*$/m,
	/^Output size:/m,
	/^\[DEBUG\]/m,
	/^\[INFO\]/m,
	/^\[TRACE\]/m,
	/^\[VERBOSE\]/m,
	/^[\w/.-]+\n[\w/.-]+\n[\w/.-]+$/m,
	/^\s*$/,
];

// ============================================================================
// Types
// ============================================================================

export type CompressionStrategy = "protected" | "persist" | "summary" | "persist_short" | "drop";

export interface ToolResultScore {
	total: number;
	normalized: number;
	strategy: CompressionStrategy;
	breakdown: {
		base: number;
		size: number;
		age: number;
		repeat: number;
		content: number;
	};
	reason: string;
}

export interface ScoringContext {
	hasNewerSamePath?: boolean;
	currentTime?: number;
}

// ============================================================================
// Score Calculation
// ============================================================================

function calculateSizeBonus(content: string): number {
	const size = Buffer.byteLength(content, "utf-8");
	if (size < 1024) return -10;
	if (size < 10 * 1024) return 0;
	if (size < 50 * 1024) return 5;
	if (size < 100 * 1024) return 10;
	return 15;
}

function calculateAgePenalty(ageMs: number): number {
	const minutes = ageMs / (60 * 1000);
	if (minutes < LIFECYCLE_DECAY.freshMinutes) return 0;
	if (minutes < LIFECYCLE_DECAY.shortMinutes) return -5;
	if (minutes < LIFECYCLE_DECAY.mediumMinutes) return -10;
	if (minutes < LIFECYCLE_DECAY.longMinutes) return -20;
	return -30;
}

function calculateContentBonus(content: string): number {
	const trimmed = content.trim();
	if (!trimmed) return -30;

	for (const pattern of CRITICAL_PATTERNS) {
		if (pattern.test(trimmed)) return 50;
	}

	for (const pattern of IMPORTANT_PATTERNS) {
		if (pattern.test(trimmed)) return 20;
	}

	for (const pattern of LOW_VALUE_PATTERNS) {
		if (pattern.test(trimmed)) return -30;
	}

	return 0;
}

function containsCriticalContent(content: string): boolean {
	const trimmed = content.trim();
	for (const pattern of CRITICAL_PATTERNS) {
		if (pattern.test(trimmed)) return true;
	}
	return false;
}

function getStrategy(normalized: number): CompressionStrategy {
	if (normalized >= SCORE_THRESHOLDS.PROTECTED) return "protected";
	if (normalized >= SCORE_THRESHOLDS.PERSIST) return "persist";
	if (normalized >= SCORE_THRESHOLDS.SUMMARY) return "summary";
	if (normalized >= SCORE_THRESHOLDS.PERSIST_SHORT) return "persist_short";
	return "drop";
}

function getReason(
	strategy: CompressionStrategy,
	toolName: string,
	hasCritical: boolean,
	isWriteTool: boolean,
	hasNewerSamePath?: boolean,
): string {
	if (isWriteTool) return "write/edit completed, can be re-read if needed";
	if (hasCritical) return "critical content (error/conflict/secret) must persist";
	if (hasNewerSamePath) return "duplicate read, newer result exists";
	switch (strategy) {
		case "protected":
			return "high value result, preserve fully";
		case "persist":
			return "valuable result, persist to disk";
		case "summary":
			return "moderate value, apply zero-cost summary";
		case "persist_short":
			return "low value, persist but expires quickly";
		case "drop":
			return "low value, direct cleanup";
	}
}

// ============================================================================
// Public API
// ============================================================================

export function scoreToolResult(
	toolName: string,
	content: string,
	timestamp: number,
	context: ScoringContext = {},
): ToolResultScore {
	const now = context.currentTime ?? Date.now();
	const age = now - timestamp;
	const lowerTool = toolName.toLowerCase();

	const isWriteTool =
		lowerTool === "write" || lowerTool === "edit" || lowerTool === "create" || lowerTool === "delete";

	const hasCritical = containsCriticalContent(content);
	const hasNewerSamePath = context.hasNewerSamePath ?? false;

	if (isWriteTool) {
		return {
			total: 100,
			normalized: 100,
			strategy: "persist",
			breakdown: { base: 100, size: 0, age: 0, repeat: 0, content: 0 },
			reason: getReason("persist", toolName, hasCritical, isWriteTool, hasNewerSamePath),
		};
	}

	if (hasCritical) {
		return {
			total: 100,
			normalized: 100,
			strategy: "persist",
			breakdown: { base: TOOL_BASE_SCORE[lowerTool] ?? 30, size: 0, age: 0, repeat: 0, content: 50 },
			reason: getReason("persist", toolName, hasCritical, isWriteTool, hasNewerSamePath),
		};
	}

	const base = TOOL_BASE_SCORE[lowerTool] ?? 30;
	const size = calculateSizeBonus(content);
	const agePenalty = calculateAgePenalty(age);
	const repeat = hasNewerSamePath ? -40 : 0;
	const contentBonus = calculateContentBonus(content);

	const total = base + size + agePenalty + repeat + contentBonus;
	const normalized = Math.max(0, Math.min(100, total));
	const strategy = getStrategy(normalized);

	return {
		total,
		normalized,
		strategy,
		breakdown: { base, size, age: agePenalty, repeat, content: contentBonus },
		reason: getReason(strategy, toolName, hasCritical, isWriteTool, hasNewerSamePath),
	};
}

// ============================================================================
// Helper: Check for duplicate reads
// ============================================================================

const READABLE_TOOLS = new Set(["read", "cat", "view"]);

function extractPathFromReadTool(msg: AgentMessage): string | null {
	const toolCall = msg as unknown as { toolCall?: { name?: string; arguments?: string } };
	const args = toolCall.toolCall?.arguments ?? "";
	const match = args.match(/["']([^"']+)["']/) ?? args.match(/\S+/);
	return match ? match[1] : null;
}

export function checkForDuplicateReads(messages: AgentMessage[], currentIndex: number): Map<number, boolean> {
	const result = new Map<number, boolean>();
	const currentMsg = messages[currentIndex];

	if (currentMsg.role !== "toolResult") return result;

	const toolName = (currentMsg as unknown as { toolName?: string }).toolName ?? "";
	if (!READABLE_TOOLS.has(toolName.toLowerCase())) return result;

	const currentPath = extractPathFromReadTool(currentMsg);
	if (!currentPath) return result;

	for (let i = currentIndex + 1; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role !== "toolResult") continue;

		const otherTool = (msg as unknown as { toolName?: string }).toolName ?? "";
		if (!READABLE_TOOLS.has(otherTool.toLowerCase())) continue;

		const otherPath = extractPathFromReadTool(msg);
		if (otherPath === currentPath) {
			result.set(currentIndex, true);
			return result;
		}
	}

	return result;
}

// ============================================================================
// Score all tool results in a message list
// ============================================================================

export interface ScoredToolResult {
	messageIndex: number;
	score: ToolResultScore;
	toolName: string;
	content: string;
	timestamp: number;
}

export function scoreAllToolResults(messages: AgentMessage[], context: ScoringContext = {}): ScoredToolResult[] {
	const now = context.currentTime ?? Date.now();
	const results: ScoredToolResult[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role !== "toolResult") continue;

		const content = extractTextContent(msg);
		if (content === null) continue;

		const toolName = (msg as unknown as { toolName?: string }).toolName ?? "unknown";
		const timestamp = (msg as unknown as { timestamp?: number }).timestamp ?? now;

		const hasNewerSamePath = checkForDuplicateReads(messages, i).get(i) ?? false;

		const score = scoreToolResult(toolName, content, timestamp, {
			...context,
			hasNewerSamePath,
		});

		results.push({
			messageIndex: i,
			score,
			toolName,
			content,
			timestamp,
		});
	}

	return results;
}

// ============================================================================
// Helper: Extract text content from message
// ============================================================================

function extractTextContent(msg: AgentMessage): string | null {
	const content = (msg as unknown as { content?: string | Array<{ type?: string; text?: string }> }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts = content.filter((p) => p.type === "text" && p.text).map((p) => p.text);
		if (parts.length > 0) return parts.join("\n");
	}
	return null;
}

// ============================================================================
// Strategy application helpers
// ============================================================================

export const STRATEGY_LABELS: Record<CompressionStrategy, string> = {
	protected: "保留",
	persist: "持久化",
	summary: "摘要",
	persist_short: "短期持久化",
	drop: "清理",
};
