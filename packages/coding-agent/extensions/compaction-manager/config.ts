import type { HalfCompactionConfig } from "./half-compaction.js";
import type { SegmentCompactionConfig } from "./segment-compaction.js";
import type { SlidingWindowConfig } from "./sliding-window.js";

/**
 * Compaction strategy selector.
 * - "full": Default behavior. Compress everything before the cut point into one summary.
 * - "half": Compress only the oldest half, keep middle portion uncompressed.
 * - "segment": Split into N segments, summarize each independently.
 * - "sliding-window": Pure truncation beyond a token window, no LLM summarization.
 */
export type CompactionStrategy = "full" | "half" | "segment" | "sliding-window";

export interface CompactionManagerConfig {
	microcompact: {
		enabled: boolean;
		maxAgeMs: number;
		clearableTools: string[];
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
	};
	/** Compaction strategy selection (default: "full") */
	strategy: CompactionStrategy;
	/** Half compaction settings (used when strategy = "half") */
	halfCompaction: HalfCompactionConfig;
	/** Segment compaction settings (used when strategy = "segment") */
	segmentCompaction: SegmentCompactionConfig;
	/** Sliding window settings (used when strategy = "sliding-window") */
	slidingWindow: SlidingWindowConfig;
}

export const DEFAULT_CONFIG: CompactionManagerConfig = {
	microcompact: {
		enabled: true,
		maxAgeMs: 60 * 60 * 1000,
		clearableTools: ["read", "bash", "grep", "find", "glob", "webFetch"],
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
};
