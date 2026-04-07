/**
 * Context Compression - Layer 0: Tool Result Persistence
 *
 * Large tool results are written to disk and replaced with lightweight stubs
 * in the context, reducing token usage without losing data.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import * as os from "node:os";
import * as path from "node:path";

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
