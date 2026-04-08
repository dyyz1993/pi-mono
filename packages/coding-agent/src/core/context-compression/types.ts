/**
 * Context Compression - Layer 0: Tool Result Persistence
 *
 * Large tool results are written to disk and replaced with lightweight stubs
 * in the context, reducing token usage without losing data.
 */

import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ============================================================================
// Configuration
// ============================================================================

export const DEFAULT_LARGE_THRESHOLD = 50 * 1024; // 50KB
export const DEFAULT_STUB_PREVIEW_SIZE = 2 * 1024; // 2KB preview in stub
export const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), "pi-context-compression");
export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Tools whose results should NOT be persisted to disk (avoids read→save→read loop) */
export const PERSIST_EXEMPT_TOOLS = new Set(["read", "cat", "view", "open"]);

export interface PersistenceConfig {
	/** Byte threshold above which results get persisted to disk */
	largeThreshold: number;
	/** Number of bytes to keep in the stub preview */
	stubPreviewSize: number;
	/** Directory for persisted files */
	cacheDir: string;
	/** Tools exempt from persistence (results always kept inline) */
	exemptTools: Set<string>;
}

export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
	largeThreshold: DEFAULT_LARGE_THRESHOLD,
	stubPreviewSize: DEFAULT_STUB_PREVIEW_SIZE,
	cacheDir: DEFAULT_CACHE_DIR,
	exemptTools: PERSIST_EXEMPT_TOOLS,
};

// ============================================================================
// Types
// ============================================================================

export interface PersistedResult {
	/** The stub content to place in context (preview + metadata) */
	stub: string;
	/** Absolute path to the persisted file on disk */
	filePath: string;
	/** Original content size in bytes */
	originalSize: number;
	/** Whether persistence was actually performed */
	persisted: boolean;
}

export interface PersistenceStats {
	totalPersisted: number;
	totalBytesSaved: number; // originalSize - stubSize, accumulated
	fileCount: number;
}

export interface ToolResultInfo {
	toolName: string;
	toolCallId?: string;
	content: string;
	timestamp?: number;
}

// ============================================================================
// L1 + L2: Tool Result Lifecycle Configuration
// ============================================================================

export const DEFAULT_KEEP_RECENT = 5;
export const DEFAULT_STALE_MINUTES = 60;

/** Tool priority levels for lifecycle decisions */
export enum ToolPriority {
	CRITICAL = "critical",
	IMPORTANT = "important",
	DISCARDABLE = "discardable",
}

export const DEFAULT_TOOL_PRIORITY: Record<string, ToolPriority> = {
	write: ToolPriority.CRITICAL,
	edit: ToolPriority.CRITICAL,
	create: ToolPriority.CRITICAL,
	delete: ToolPriority.CRITICAL,
	read: ToolPriority.IMPORTANT,
	grep: ToolPriority.IMPORTANT,
	glob: ToolPriority.IMPORTANT,
	find: ToolPriority.IMPORTANT,
	bash: ToolPriority.DISCARDABLE,
	ls: ToolPriority.DISCARDABLE,
	git_log: ToolPriority.DISCARDABLE,
	git_diff: ToolPriority.DISCARDABLE,
};

export interface LifecycleConfig {
	/** Number of recent tool results to keep fully intact */
	keepRecent: number;
	/** Minutes after which a result is considered "stale" (subject to clearing) */
	staleMinutes: number;
	/** Custom tool priority overrides */
	toolPriority: Record<string, ToolPriority>;
	/** Whether lifecycle management is enabled */
	enabled: boolean;
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
	keepRecent: DEFAULT_KEEP_RECENT,
	staleMinutes: DEFAULT_STALE_MINUTES,
	toolPriority: { ...DEFAULT_TOOL_PRIORITY },
	enabled: true,
};

// ============================================================================
// L1 + L2 Types
// ============================================================================

/** Represents a tool result entry in the message list for lifecycle management */
export interface ToolResultEntry {
	/** Unique identifier for this tool result */
	id: string;
	/** Tool name (lowercase) */
	toolName: string;
	/** Original content */
	content: string;
	/** Original size in bytes */
	contentSize: number;
	/** When this result was created (epoch ms) */
	timestamp: number;
	/** Priority level */
	priority: ToolPriority;
	/** Current degradation level */
	level: "full" | "stub" | "cleared";
}

/** Result of applying lifecycle rules to a list of messages */
export interface LifecycleResult {
	/** Modified messages (some may have degraded content) */
	messages: AgentMessage[];
	/** Number of results degraded from full→stub */
	degradedCount: number;
	/** Number of results cleared entirely */
	clearedCount: number;
	/** Estimated tokens before */
	tokensBefore: number;
	/** Estimated tokens after */
	tokensAfter: number;
}

// ============================================================================
// L3: Zero-cost Structured Summary Configuration
// ============================================================================

export const DEFAULT_SUMMARY_MAX_LINES = 20;
export const DEFAULT_SUMMARY_TRUNCATE_LINE = 120;

export interface SummaryConfig {
	/** Max lines to keep in a structured summary */
	maxLines: number;
	/** Max chars per line before truncation */
	truncateLine: number;
	/** Whether zero-cost summarization is enabled */
	enabled: boolean;
}

export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
	maxLines: DEFAULT_SUMMARY_MAX_LINES,
	truncateLine: DEFAULT_SUMMARY_TRUNCATE_LINE,
	enabled: true,
};

/** A structured note extracted from a tool result without LLM */
export interface StructuredNote {
	/** Compact one-line description */
	headline: string;
	/** Key-value metadata extracted from content */
	metadata: Record<string, string>;
	/** Sample lines (first N + last N) */
	samples: string[];
	/** Original content size for reference */
	originalSize: number;
	/** The formatted note string to place in context */
	formatted: string;
}

/** Result of applying zero-cost summarization */
export interface SummaryResult {
	/** Modified messages with summarized content */
	messages: AgentMessage[];
	/** Number of results summarized */
	summarizedCount: number;
	/** Estimated tokens before */
	tokensBefore: number;
	/** Estimated tokens after */
	tokensAfter: number;
}

// ============================================================================
// Classifier: Message Intent Classification
// ============================================================================

export enum IntentCategory {
	BUG = "bug",
	REQUIREMENT = "requirement",
	EXPLORATION = "exploration",
	CHITCHAT = "chitchat",
}

export interface ClassificationResult {
	intent: IntentCategory;
	confidence: number; // 0-1
	reason: string;
}

export interface ClassifierConfig {
	enabled: boolean;
}

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
	enabled: true,
};

// Re-export scoring types
export type { CompressionStrategy, ScoredToolResult, ScoringContext, ToolResultScore } from "./scoring.js";
export {
	LIFECYCLE_DECAY,
	SCORE_THRESHOLDS,
	STRATEGY_LABELS,
	scoreAllToolResults,
	scoreToolResult,
	TOOL_BASE_SCORE,
} from "./scoring.js";

// ============================================================================
// Orchestration: Full Pipeline Configuration
// ============================================================================

export interface ScoringConfig {
	/** Enable scoring-based compression strategy */
	enabled: boolean;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
	enabled: true,
};

export interface CompressionPipelineConfig {
	persistence: PersistenceConfig;
	lifecycle: LifecycleConfig;
	summary: SummaryConfig;
	classifier: ClassifierConfig;
	scoring: ScoringConfig;
	/** Enable/disable entire pipeline */
	enabled: boolean;
}

export const DEFAULT_COMPRESSION_PIPELINE_CONFIG: CompressionPipelineConfig = {
	persistence: DEFAULT_PERSISTENCE_CONFIG,
	lifecycle: DEFAULT_LIFECYCLE_CONFIG,
	summary: DEFAULT_SUMMARY_CONFIG,
	classifier: DEFAULT_CLASSIFIER_CONFIG,
	scoring: DEFAULT_SCORING_CONFIG,
	enabled: true,
};

/** Result of running the full compression pipeline */
export interface PipelineResult {
	messages: AgentMessage[];
	steps: {
		persistence?: { persistedCount: number; bytesSaved: number };
		lifecycle?: { degradedCount: number; clearedCount: number };
		summary?: { summarizedCount: number };
		classification?: { intent: string; confidence: number };
		scoring?: {
			protectCount: number;
			persistCount: number;
			summaryCount: number;
			persistShortCount: number;
			dropCount: number;
		};
	};
	tokensBefore: number;
	tokensAfter: number;
	durationMs: number;
}
