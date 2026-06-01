/**
 * Type exports for the RPC client API.
 */

import type { AgentEvent, AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import type { PermissionMode, SessionStats } from "../../core/agent-session.ts";
import type { AgentConfig } from "../../core/agent-types.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type { Settings } from "../../core/settings-manager.ts";
import type {
	BatchDiffResult,
	FileDiffResult,
	FileHistoryResult,
	ModelInfo,
	ModifiedFilesResult,
	RollbackPreviewResult,
	RpcClient,
	TreeWithLeaf,
} from "./rpc-client.ts";
import type {
	RpcAgentSummary,
	RpcAllTool,
	RpcContextUsage,
	RpcExtension,
	RpcExtensionFlag,
	RpcSessionState,
	RpcSkill,
	RpcSlashCommand,
	RpcTool,
	TreeEntry,
} from "./rpc-types.ts";

export type {
	BatchDiffResult,
	FileDiffResult,
	FileHistoryResult,
	ModifiedFilesResult,
	ModelInfo,
	RollbackPreviewResult,
	TreeWithLeaf,
};

export interface ForkResult {
	text: string;
	cancelled: boolean;
}

export interface ForkMessage {
	entryId: string;
	text: string;
}

export interface SystemPromptResult {
	systemPrompt: string;
	appendSystemPrompt: string[];
}

export interface QueueState {
	steering: string[];
	followUp: string[];
}

export interface SessionOperationResult {
	cancelled: boolean;
}

export interface ModelCycleResult {
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
	isScoped: boolean;
}

export interface AgentsFile {
	path: string;
	content: string;
}

export type RpcClientAPI = Pick<RpcClient, keyof RpcClient>;

export interface RpcClientSurface {
	start(): Promise<void>;
	stop(): Promise<void>;
	onEvent(listener: (event: AgentEvent) => void): () => void;
	getStderr(): string;

	prompt(message: string, images?: ImageContent[]): Promise<void>;
	steer(message: string, images?: ImageContent[]): Promise<void>;
	followUp(message: string, images?: ImageContent[]): Promise<void>;
	abort(): Promise<void>;

	newSession(parentSession?: string): Promise<SessionOperationResult>;
	getState(): Promise<RpcSessionState>;
	setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
	cycleModel(): Promise<ModelCycleResult | null>;
	getAvailableModels(): Promise<ModelInfo[]>;
	getTierModels(): Promise<Record<string, string>>;
	setTierModels(models: { fast?: string; pro?: string; max?: string }): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): Promise<void>;
	cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null>;
	setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void>;
	setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void>;
	compact(customInstructions?: string): Promise<CompactionResult>;
	setAutoCompaction(enabled: boolean): Promise<void>;
	setAutoRetry(enabled: boolean): Promise<void>;
	abortRetry(): Promise<void>;
	bash(command: string): Promise<BashResult>;
	abortBash(): Promise<void>;

	getSessionStats(): Promise<SessionStats>;
	exportHtml(outputPath?: string): Promise<{ path: string }>;
	switchSession(sessionPath: string): Promise<SessionOperationResult>;
	fork(entryId: string, options?: { position?: "before" | "at" }): Promise<ForkResult>;
	navigateTree(
		targetId: string,
		options?: {
			summarize?: boolean;
			customInstructions?: string;
			replaceInstructions?: boolean;
			label?: string;
		},
	): Promise<SessionOperationResult & { editorText?: string; newLeafId: string | null }>;
	previewRollback(targetId: string): Promise<RollbackPreviewResult>;
	deleteEntries(targetIds: string[]): Promise<{ entryId: string }>;
	summarizeEntries(targetIds: string[], options?: { summary?: string; model?: string }): Promise<{ entryId: string }>;
	clone(): Promise<SessionOperationResult>;
	getForkMessages(): Promise<ForkMessage[]>;
	getLastAssistantText(): Promise<string | null>;
	setSessionName(name: string): Promise<void>;
	getMessages(): Promise<AgentMessage[]>;
	getFullMessages(options?: { afterEntryId?: string; limit?: number }): Promise<{
		messages: AgentMessage[];
		hasMore: boolean;
		totalCount: number;
		nextCursor: string | null;
		tree: { entries: TreeEntry[]; leafId: string | null };
		customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
		compactionEntries: Array<{ id: string; summary: string; tokensBefore: number | undefined; timestamp: number }>;
	}>;
	getTree(): Promise<{ entries: TreeEntry[] }>;
	getTreeWithLeaf(): Promise<TreeWithLeaf>;

	getModifiedFiles(options?: {
		fromEntryId?: string;
		toEntryId?: string;
		toTurnIndex?: number;
		fromTurnIndex?: number;
		toUserMsgEntryId?: string;
	}): Promise<ModifiedFilesResult>;
	getFileDiff(options: {
		filePath: string;
		fromEntryId?: string;
		toEntryId?: string;
		useBaselineHash?: boolean;
	}): Promise<FileDiffResult | null>;
	getBatchDiffs(options?: { fromEntryId?: string; toEntryId?: string }): Promise<BatchDiffResult>;
	getFileHistory(options: { filePath: string }): Promise<FileHistoryResult>;

	getCommands(): Promise<RpcSlashCommand[]>;
	getSkills(): Promise<RpcSkill[]>;
	getExtensions(): Promise<RpcExtension[]>;
	getTools(): Promise<RpcTool[]>;
	getSettings(scope?: "global" | "project"): Promise<Settings>;
	setSettings(settings: Partial<Settings>, scope?: "global" | "project"): Promise<void>;
	getContextUsage(): Promise<RpcContextUsage>;
	getSystemPrompt(): Promise<SystemPromptResult>;
	getActiveTools(): Promise<string[]>;
	setActiveTools(toolNames: string[]): Promise<void>;
	getQueue(): Promise<QueueState>;
	clearQueue(): Promise<QueueState>;
	getFlags(): Promise<RpcExtensionFlag[]>;
	getFlagValues(): Promise<Record<string, boolean | string>>;
	setFlag(name: string, value: boolean | string): Promise<void>;
	reload(): Promise<void>;
	setCwd(cwd: string): Promise<SessionOperationResult>;

	getAgentsFiles(): Promise<AgentsFile[]>;
	getAgents(): Promise<RpcAgentSummary[]>;
	switchAgent(agentName: string): Promise<{
		agentName: string;
		tools: string[];
		tier?: string;
		thinkingLevel?: string;
	}>;
	getCurrentAgent(): Promise<{ agentName: string }>;
	getLatestAgentChange(): Promise<{ agentName: string; agentConfig?: unknown; timestamp: string } | null>;
	getAgentDetail(agentName: string): Promise<AgentConfig>;
	getAllTools(): Promise<RpcAllTool[]>;
	setPermissionMode(mode: PermissionMode): Promise<{ mode: PermissionMode }>;
}
