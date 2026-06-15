import type { HalfCompactionConfig } from "./half-compaction.ts";
import type { LineFoldConfig } from "./line-fold.ts";
import type { RecoveryConfig as PostCompactRecoveryConfig } from "./post-compact-recovery.ts";
import type { SegmentCompactionConfig } from "./segment-compaction.ts";
import type { SlidingWindowConfig } from "./sliding-window.ts";
import type { SnipCompactConfig } from "./snip-compact.ts";
import type { ToolResultBudgetConfig } from "./tool-result-budget.ts";

/**
 * Compaction strategy selector.
 * - "full": Default behavior. Compress everything before the cut point into one summary.
 * - "half": Compress only the oldest half, keep middle portion uncompressed.
 * - "segment": Split into N segments, summarize each independently.
 * - "sliding-window": Pure truncation beyond a token window, no LLM summarization.
 */
export type CompactionStrategy = "full" | "half" | "segment" | "sliding-window";

export interface CompactionManagerConfig {
	/** L0: Persist oversized tool results to disk (zero-cost, runs first) */
	toolResultBudget: ToolResultBudgetConfig;
	/** L1: Snip middle messages when conversation is too long (zero-cost) */
	snipCompact: SnipCompactConfig;
	/** L1.5: Fold consecutive identical lines in tool results (zero-cost, deterministic) */
	lineFold: LineFoldConfig;
	microcompact: {
		enabled: boolean;
		keepRecentCount: number;
		clearableTools: string[];
		/** Cached path: max recent tool results to keep full content (default: 3) */
		maxCachedResults: number;
		/** Minimum interval between compaction passes in ms (default: 600_000 = 10 min).
		 *  Prevents cache-busting mid-conversation; runs only when the cache is likely cold. */
		minIntervalMs: number;
	};
	sessionMemory: {
		enabled: boolean;
		memoryDir: string;
		minContentLength: number;
	};
	reactive: {
		enabled: boolean;
		warnPercent: number;
		forceCompactPercent: number;
	};
	contextFold: {
		enabled: boolean;
		maxAgeMs: number;
		keepRecentCount: number;
		maxSummaryLength: number;
		/** Minimum interval between fold passes in ms (default: 600_000 = 10 min).
		 *  Without this, fold runs every turn_end, which can cause fold storms
		 *  where rapid folding re-triggers the agent loop. */
		minIntervalMs: number;
	};
	/** Compaction strategy selection (default: "full") */
	strategy: CompactionStrategy;
	/** Half compaction settings (used when strategy = "half") */
	halfCompaction: HalfCompactionConfig;
	/** Segment compaction settings (used when strategy = "segment") */
	segmentCompaction: SegmentCompactionConfig;
	/** Sliding window settings (used when strategy = "sliding-window") */
	slidingWindow: SlidingWindowConfig;
	/** Post-compaction file recovery settings */
	postCompactRecovery: PostCompactRecoveryConfig;
}

export const DEFAULT_CONFIG: CompactionManagerConfig = {
	toolResultBudget: {
		enabled: true,
		maxResultChars: 200_000,
		previewChars: 2000,
		minIntervalMs: 10 * 60 * 1000,
	},
	snipCompact: {
		enabled: true,
		maxMessages: 50,
		keepHeadCount: 3,
		minIntervalMs: 10 * 60 * 1000,
	},
	lineFold: {
		enabled: true,
		minConsecutive: 3,
		toolNames: ["bash", "read", "grep", "find", "glob"],
	},
	microcompact: {
		enabled: true,
		keepRecentCount: 5,
		clearableTools: ["read", "bash", "grep", "find", "glob", "webFetch"],
		maxCachedResults: 3,
		minIntervalMs: 10 * 60 * 1000,
	},
	sessionMemory: {
		enabled: true,
		memoryDir: ".pi/memory",
		minContentLength: 50,
	},
	reactive: {
		enabled: true,
		warnPercent: 75,
		forceCompactPercent: 90,
	},
	contextFold: {
		enabled: true,
		maxAgeMs: 30 * 60 * 1000,
		keepRecentCount: 6,
		maxSummaryLength: 200,
		minIntervalMs: 10 * 60 * 1000,
	},
	strategy: "full",
	halfCompaction: {
		enabled: false,
		ratio: 0.5,
	},
	segmentCompaction: {
		enabled: false,
		segmentCount: 3,
	},
	slidingWindow: {
		enabled: false,
		windowTokens: 80000,
		truncationNotice: true,
	},
	postCompactRecovery: {
		enabled: true,
		maxFilesToRestore: 5,
		maxTokensPerFile: 5000,
		totalTokenBudget: 50000,
	},
};
