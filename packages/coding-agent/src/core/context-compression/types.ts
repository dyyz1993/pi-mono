/**
 * Context Compression - Layer 0: Tool Result Persistence
 *
 * Large tool results are written to disk and replaced with lightweight stubs
 * in the context, reducing token usage without losing data.
 */

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
