/**
 * OpenViking Memory Extension - Core Types
 *
 * Ported from @opencode-ai/plugin format to pi-mono extension format.
 * Exposes OpenViking's semantic memory capabilities as tools for AI agents.
 */

// ============================================================================
// Configuration
// ============================================================================

export interface OpenVikingConfig {
	endpoint: string;
	apiKey: string;
	enabled: boolean;
	timeoutMs: number;
	autoCommit?: {
		enabled: boolean;
		intervalMinutes: number;
	};
}

export const DEFAULT_CONFIG: OpenVikingConfig = {
	endpoint: "http://localhost:1933",
	apiKey: "",
	enabled: true,
	timeoutMs: 30000,
	autoCommit: {
		enabled: true,
		intervalMinutes: 10,
	},
};

// ============================================================================
// API Response Types
// ============================================================================

export interface OpenVikingResponse<T = unknown> {
	status: string;
	result?: T;
	error?: string | { code?: string; message?: string; details?: Record<string, unknown> };
	time?: number;
	usage?: Record<string, number>;
}

export interface SearchResult {
	memories: any[];
	resources: any[];
	skills: any[];
	total: number;
	query_plan?: string;
}

export type MemoryCounts = number | Record<string, number>;

export interface CommitResult {
	session_id: string;
	status: string;
	memories_extracted?: MemoryCounts;
	active_count_updated?: number;
	archived?: boolean;
	task_id?: string;
	message?: string;
	stats?: {
		total_turns?: number;
		contexts_used?: number;
		skills_used?: number;
		memories_extracted?: number;
	};
}

export interface SessionResult {
	session_id: string;
}

export interface TaskResult {
	task_id: string;
	task_type: string;
	status: "pending" | "running" | "completed" | "failed";
	created_at: number;
	updated_at: number;
	resource_id?: string;
	result?: {
		session_id?: string;
		memories_extracted?: MemoryCounts;
		archived?: boolean;
	};
	error?: string | null;
}

export type CommitStartResult = { mode: "background"; taskId: string } | { mode: "completed"; result: CommitResult };

// ============================================================================
// Session State Management
// ============================================================================

export interface SessionMapping {
	ovSessionId: string;
	createdAt: number;
	capturedMessages: Set<string>;
	messageRoles: Map<string, "user" | "assistant">;
	pendingMessages: Map<string, string>;
	sendingMessages: Set<string>;
	lastCommitTime?: number;
	commitInFlight?: boolean;
	commitTaskId?: string;
	commitStartedAt?: number;
	pendingCleanup?: boolean;
}

export interface SessionMappingPersisted {
	ovSessionId: string;
	createdAt: number;
	capturedMessages: string[];
	messageRoles: [string, "user" | "assistant"][];
	pendingMessages: [string, string][];
	lastCommitTime?: number;
	commitInFlight?: boolean;
	commitTaskId?: string;
	commitStartedAt?: number;
	pendingCleanup?: boolean;
}

export interface SessionMapFile {
	version: 1;
	sessions: Record<string, SessionMappingPersisted>;
	lastSaved: number;
}

// ============================================================================
// Message Buffer
// ============================================================================

export interface BufferedMessage {
	messageId: string;
	content?: string;
	role?: "user" | "assistant";
	timestamp: number;
}

export const MAX_BUFFERED_MESSAGES_PER_SESSION = 100;
export const BUFFERED_MESSAGE_TTL_MS = 15 * 60 * 1000;
export const BUFFER_CLEANUP_INTERVAL_MS = 30 * 1000;

// ============================================================================
// Commit Constants
// ============================================================================

export const COMMIT_TIMEOUT_MS = 180000;
