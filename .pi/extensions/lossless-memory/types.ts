/**
 * Lossless Memory Extension - Core Types
 *
 * DAG-based memory management system for pi coding agent.
 * Implements lossless context compression using hierarchical summaries.
 */

import type { Static, TSchema } from "@sinclair/typebox";

// ============================================================================
// DAG Node Types
// ============================================================================

/** Memory node type in the DAG */
export type MemoryNodeType = "summary" | "original";

/** A single node in the memory DAG */
export interface MemoryNode {
	/** Unique node ID (UUID) */
	id: string;

	/** Node type */
	type: MemoryNodeType;

	/** Summary level (0=original, 1=L1 summary, 2=L2 summary, etc.) */
	level: number;

	/** Summary content or original message JSON */
	content: string;

	/** Parent node IDs (higher-level summaries) */
	parentIds: string[];

	/** Child node IDs (lower-level summaries or original messages) */
	childIds: string[];

	/** Creation timestamp */
	createdAt: number;

	/** Estimated token count */
	tokenCount: number;

	/** Associated session ID */
	sessionId: string;

	/** Associated session entry IDs */
	sessionEntryIds: string[];
}

/** Search result from memory queries */
export interface MemorySearchResult {
	node: MemoryNode;
	score: {
		/** FTS5 keyword relevance score */
		keyword: number;
		/** Semantic similarity score (0-1), if enabled */
		semantic?: number;
		/** Combined score */
		combined: number;
	};
}

// ============================================================================
// Database Schema Types
// ============================================================================

/** Row from memory_nodes table */
export interface MemoryNodeRow {
	id: string;
	type: MemoryNodeType;
	level: number;
	content: string;
	parent_ids: string | null;
	child_ids: string | null;
	created_at: number;
	token_count: number | null;
	session_id: string;
	session_entry_ids: string | null;
	rowid: number;
}

/** Row from session_index table */
export interface SessionIndexRow {
	session_id: string;
	session_path: string;
	created_at: number;
	last_accessed: number;
	node_count: number;
	total_tokens: number;
}

/** Row from memory_embeddings table (optional vector search) */
export interface MemoryEmbeddingRow {
	node_id: string;
	embedding: Buffer;
	model: string;
	dimensions: number;
}

// ============================================================================
// Search Types
// ============================================================================

/** Search options for memory queries */
export interface SearchOptions {
	/** Search query string */
	query: string;

	/** Filter by session ID (optional) */
	sessionId?: string;

	/** Maximum results to return */
	limit?: number;

	/** Minimum summary level (0=all, 1=L1+, 2=L2+, etc.) */
	minLevel?: number;

	/** Maximum summary level */
	maxLevel?: number;

	/** Enable semantic search (requires embeddings) */
	enableSemanticSearch?: boolean;

	/** Time range filter */
	timeRange?: {
		from?: number;
		to?: number;
	};
}

/** Search result with scoring */
export interface SearchResult {
	node: MemoryNode;
	score: {
		keyword: number;
		semantic?: number;
		combined: number;
	};
	highlights?: string[];
}

// ============================================================================
// Summary Generation Types
// ============================================================================

/** Configuration for summary generation */
export interface SummaryConfig {
	/** LLM provider for summary generation */
	provider: string;

	/** Model ID for summary generation */
	model: string;

	/** Maximum tokens for generated summary */
	maxTokens: number;

	/** System prompt for summary generation */
	systemPrompt: string;

	/** Compression rules by level */
	compressionRules: {
		[level: number]: {
			compressEvery: number;
			targetTokens: number;
		};
	};
}

/** Input for summary generation */
export interface SummaryInput {
	/** Session entries to summarize */
	entries: Array<{
		id: string;
		role: "user" | "assistant" | "toolResult";
		content: string;
		timestamp: number;
	}>;

	/** Custom instructions for summarization */
	customInstructions?: string;

	/** Previous summary (for incremental summarization) */
	previousSummary?: string;
}

/** Output from summary generation */
export interface SummaryOutput {
	/** Generated summary text */
	summary: string;

	/** Estimated token count */
	tokenCount: number;

	/** Source entry IDs */
	sourceEntryIds: string[];
}

// ============================================================================
// DAG Management Types
// ============================================================================

/** DAG manager state */
export interface DAGState {
	/** Current session ID */
	sessionId: string | undefined;

	/** Node cache by ID */
	nodes: Map<string, MemoryNode>;

	/** Entry ID to node ID mapping */
	entryToNode: Map<string, string>;

	/** Root nodes (highest level summaries) */
	rootNodes: string[];
}

/** Compression preparation result */
export interface CompressionPreparation {
	/** Entries to compress */
	entriesToCompress: Array<{
		id: string;
		role: string;
		content: string;
	}>;

	/** First entry ID to keep (not compressed) */
	firstKeptEntryId: string;

	/** Current token count before compression */
	tokensBefore: number;
}

// ============================================================================
// Tool Input/Output Types
// ============================================================================

/** Input for pi_memory_search tool */
export interface SearchToolInput {
	query: string;
	maxResults?: number;
	minLevel?: number;
	sessionId?: string;
}

/** Output for pi_memory_search tool */
export interface SearchToolOutput {
	query: string;
	results: Array<{
		nodeId: string;
		level: number;
		summary: string;
		sessionId: string;
		createdAt: number;
		score: number;
		entryIds: string[];
	}>;
	totalFound: number;
}

/** Input for pi_memory_expand tool */
export interface ExpandToolInput {
	nodeId: string;
	maxDepth?: number;
	maxTokens?: number;
}

/** Output for pi_memory_expand tool */
export interface ExpandToolOutput {
	nodeId: string;
	expanded: boolean;
	originalMessages: Array<{
		entryId: string;
		role: string;
		content: string;
	}>;
	truncated: boolean;
	totalTokens: number;
}

/** Input for pi_memory_stats tool */
export interface StatsToolInput {
	sessionId?: string;
}

/** Output for pi_memory_stats tool */
export interface StatsToolOutput {
	sessionId: string;
	nodeCount: number;
	totalTokens: number;
	maxLevel: number;
	rootSummary?: string;
	oldestEntry: string;
	newestEntry: string;
}

// ============================================================================
// Extension Configuration Types
// ============================================================================

/** Extension configuration from settings.json */
export interface LosslessMemoryConfig {
	/** Enable/disable the extension */
	enabled: boolean;

	/** Database configuration */
	database: {
		/** Database file path */
		path: string;
		/** Enable FTS5 full-text search */
		enableFTS5: boolean;
		/** Enable vector embeddings (experimental) */
		enableVectors: boolean;
	};

	/** Summary generation configuration */
	summary: {
		/** LLM provider for summaries */
		provider: string;
		/** Model for summaries */
		model: string;
		/** Maximum summary tokens */
		maxTokens: number;
		/** Compression ratio (entries per summary) */
		compressionRatio: number;
	};

	/** Search configuration */
	search: {
		/** Keyword search weight (0-1) */
		keywordWeight: number;
		/** Semantic search weight (0-1) */
		semanticWeight: number;
		/** Default result limit */
		defaultLimit: number;
	};

	/** Performance configuration */
	performance: {
		/** Cache embeddings */
		cacheEmbeddings: boolean;
		/** Batch size for operations */
		batchSize: number;
		/** Lazy load nodes */
		lazyLoad: boolean;
	};
}

/** Default configuration */
export const DEFAULT_CONFIG: LosslessMemoryConfig = {
	enabled: true,
	database: {
		path: "~/.pi/agent/lossless-memory.db",
		enableFTS5: true,
		enableVectors: false,
	},
	summary: {
		provider: "openai",
		model: "gpt-4o-mini",
		maxTokens: 300,
		compressionRatio: 8,
	},
	search: {
		keywordWeight: 0.7,
		semanticWeight: 0.3,
		defaultLimit: 5,
	},
	performance: {
		cacheEmbeddings: true,
		batchSize: 32,
		lazyLoad: true,
	},
};

// ============================================================================
// Utility Types
// ============================================================================

/** Token estimation result */
export interface TokenEstimate {
	tokens: number;
	method: "exact" | "estimate";
}

/** Database initialization result */
export interface DatabaseInitResult {
	success: boolean;
	error?: string;
	version: number;
}

/** Event bus for cross-extension communication */
export interface EventBus {
	on(event: string, handler: (data: any) => void): void;
	emit(event: string, data: any): void;
	off(event: string, handler: (data: any) => void): void;
}
