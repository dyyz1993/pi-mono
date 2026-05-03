/**
 * Type exports for RPC Client API.
 *
 * This module provides type definitions for programmatic access to the coding agent
 * via RPC, separate from the runtime RpcClient class implementation.
 */

import type { AgentEvent, AgentMessage, ThinkingLevel } from "@dyyz1993/pi-agent-core";
import type { ImageContent, Model } from "@dyyz1993/pi-ai";
import type { SessionStats } from "../../core/agent-session.js";
import type { BashResult } from "../../core/bash-executor.js";
import type { CompactionResult } from "../../core/compaction/index.js";
import type { Channel } from "../../core/extensions/channel-types.js";
import type { Settings } from "../../core/settings-manager.js";
import type {
	RpcContextUsage,
	RpcExtension,
	RpcExtensionFlag,
	RpcSessionState,
	RpcSkill,
	RpcSlashCommand,
	RpcTool,
} from "./rpc-types.js";

/**
 * Information about an available model.
 */
export interface ModelInfo {
	provider: string;
	id: string;
	contextWindow: number;
	reasoning: boolean;
}

/**
 * Entry in the session tree.
 */
export interface TreeEntry {
	id: string;
	parentId: string | null;
	type: string;
	label?: string;
}

/**
 * Tree with leaf ID.
 */
export interface TreeWithLeaf {
	entries: TreeEntry[];
	leafId: string | null;
}

/**
 * Result of fork operation.
 */
export interface ForkResult {
	text: string;
	cancelled: boolean;
	newSessionFile?: string;
	newSessionId?: string;
}

/**
 * Rollback preview result.
 */
export interface RollbackPreviewResult {
	restored: string[];
	deleted: string[];
}

/**
 * Fork message entry.
 */
export interface ForkMessage {
	entryId: string;
	text: string;
}

/**
 * System prompt result.
 */
export interface SystemPromptResult {
	systemPrompt: string;
	appendSystemPrompt: string[];
}

/**
 * Queue state.
 */
export interface QueueState {
	steering: string[];
	followUp: string[];
}

/**
 * Session switch/fork/clone result with cancellation info.
 */
export interface SessionOperationResult {
	cancelled: boolean;
}

/**
 * Model cycle result.
 */
export interface ModelCycleResult {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	isScoped: boolean;
}

/**
 * Remote tool call.
 */
export interface RemoteToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
}

/**
 * Remote tool result.
 */
export interface RemoteToolResult {
	content: Array<{ type: string; text: string }>;
	isError: boolean;
}

/**
 * Agents file entry.
 */
export interface AgentsFile {
	path: string;
	content: string;
}

/**
 * RPC Client API interface.
 *
 * This interface defines all methods available on the RPC client,
 * suitable for type-only usage (e.g., dynamic import, mocks, etc.).
 *
 * @example
 * ```typescript
 * // For dynamic import scenarios
 * const { default: RpcClient } = await import('@dyyz1993/coding-agent/modes/rpc/rpc-client.js');
 * const client: RpcClientAPI = new RpcClient();
 * ```
 */
export interface RpcClientAPI {
	// Lifecycle
	start(): Promise<void>;
	stop(): Promise<void>;
	onEvent(listener: (event: AgentEvent) => void): () => void;
	getStderr(): string;

	// Prompting
	prompt(message: string, images?: ImageContent[]): Promise<void>;
	steer(message: string, images?: ImageContent[]): Promise<void>;
	followUp(message: string, images?: ImageContent[]): Promise<void>;
	abort(): Promise<void>;

	// Session
	newSession(parentSession?: string): Promise<SessionOperationResult>;
	getState(): Promise<RpcSessionState>;
	exportHtml(outputPath?: string): Promise<{ path: string }>;
	switchSession(sessionPath: string): Promise<SessionOperationResult>;
	fork(entryId: string, options?: { position?: "before" | "at" }): Promise<ForkResult>;
	navigateTree(
		targetId: string,
		options?: { summarize?: boolean; skipFiles?: boolean },
	): Promise<SessionOperationResult>;
	previewRollback(targetId: string): Promise<RollbackPreviewResult>;
	clone(): Promise<SessionOperationResult>;
	getForkMessages(): Promise<ForkMessage[]>;
	getLastAssistantText(): Promise<string | null>;
	setSessionName(name: string): Promise<void>;
	getMessages(): Promise<AgentMessage[]>;
	getTree(): Promise<TreeEntry[]>;
	getTreeWithLeaf(): Promise<TreeWithLeaf>;

	// Model
	setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
	cycleModel(): Promise<ModelCycleResult | null>;
	getAvailableModels(): Promise<ModelInfo[]>;

	// Thinking
	setThinkingLevel(level: ThinkingLevel): Promise<void>;
	cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null>;

	// Queue modes
	setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void>;
	setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void>;

	// Compaction
	compact(customInstructions?: string): Promise<CompactionResult>;
	setAutoCompaction(enabled: boolean): Promise<void>;

	// Retry
	setAutoRetry(enabled: boolean): Promise<void>;
	abortRetry(): Promise<void>;

	// Bash
	bash(command: string): Promise<BashResult>;
	abortBash(): Promise<void>;

	// Session stats
	getSessionStats(): Promise<SessionStats>;

	// Commands
	getCommands(): Promise<RpcSlashCommand[]>;
	getSkills(): Promise<RpcSkill[]>;
	getExtensions(): Promise<RpcExtension[]>;
	getTools(): Promise<RpcTool[]>;

	// Settings
	getSettings(scope?: "global" | "project"): Promise<Settings>;
	setSettings(settings: Partial<Settings>, scope?: "global" | "project"): Promise<void>;

	// Context
	getContextUsage(): Promise<RpcContextUsage>;
	getSystemPrompt(): Promise<SystemPromptResult>;

	// Active tools
	getActiveTools(): Promise<string[]>;
	setActiveTools(toolNames: string[]): Promise<void>;

	// Queue
	getQueue(): Promise<QueueState>;
	clearQueue(): Promise<QueueState>;

	// Flags
	getFlags(): Promise<RpcExtensionFlag[]>;
	getFlagValues(): Promise<Record<string, boolean | string>>;
	setFlag(name: string, value: boolean | string): Promise<void>;

	// Reload
	reload(): Promise<void>;

	// Set Cwd
	setCwd(cwd: string): Promise<void>;

	// Agents files
	getAgentsFiles(): Promise<AgentsFile[]>;

	// Remote tools
	registerRemoteTool(tool: { name: string; description: string; parameters: object }): Promise<void>;
	unregisterRemoteTool(name: string): Promise<void>;
	sendRemoteToolResult(toolCallId: string, result: RemoteToolResult): void;
	respondUI(requestId: string, response: Record<string, unknown>): void;
	onRemoteToolCall(handler: (call: RemoteToolCall) => void): () => void;

	// Helpers
	waitForIdle(timeout?: number): Promise<void>;
	collectEvents(timeout?: number): Promise<AgentEvent[]>;
	promptAndWait(message: string, images?: ImageContent[], timeout?: number): Promise<AgentEvent[]>;

	// Channels
	channel(name: string): Pick<Channel, "name" | "send" | "onReceive" | "invoke" | "call">;
}

// Re-export all types from rpc-types for convenience
export type {
	RpcCommand,
	RpcContextUsage,
	RpcExtension,
	RpcExtensionFlag,
	RpcResponse,
	RpcSessionState,
	RpcSkill,
	RpcSlashCommand,
	RpcTool,
} from "./rpc-types.js";
