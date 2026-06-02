/**
 * RPC Client for programmatic access to the coding agent.
 *
 * Spawns the agent in RPC mode and provides a typed API for all operations.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { SessionStats } from "../../core/agent-session.ts";
import type { AgentConfig } from "../../core/agent-types.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type { Channel, ChannelDataMessage } from "../../core/extensions/channel-types.ts";
import type { Settings } from "../../core/settings-manager.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type {
	RpcAgentMessage,
	RpcAgentSummary,
	RpcAllTool,
	RpcCommand,
	RpcContextUsage,
	RpcExtension,
	RpcExtensionFlag,
	RpcResponse,
	RpcSessionState,
	RpcSkill,
	RpcSlashCommand,
	RpcTool,
	TreeEntry,
} from "./rpc-types.ts";

// ============================================================================
// Types
// ============================================================================

/** Distributive Omit that works with union types */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** RpcCommand without the id field (for internal send) */
type RpcCommandBody = DistributiveOmit<RpcCommand, "id">;

export interface RpcClientOptions {
	/** Path to the CLI entry point (default: searches for dist/cli.js) */
	cliPath?: string;
	/** Working directory for the agent */
	cwd?: string;
	/** Environment variables */
	env?: Record<string, string>;
	/** Provider to use */
	provider?: string;
	/** Model ID to use */
	model?: string;
	/** Additional CLI arguments */
	args?: string[];
}

export interface ModelInfo {
	provider: string;
	id: string;
	contextWindow: number;
	reasoning: boolean;
}

export type RpcEventListener = (event: AgentEvent) => void;

export interface TreeWithLeaf {
	entries: TreeEntry[];
	leafId: string | null;
}

export interface RollbackPreviewResult {
	restored: string[];
	deleted: string[];
	skipped: string[];
	dirty: string[];
	forceRestored: string[];
}

export interface ModifiedFilesResult {
	files: Array<{ path: string; status: "added" | "modified" | "deleted"; turnIndex: number; entryId: string }>;
	resolvedFromEntryId: string | null;
}

export interface FileDiffResult {
	path: string;
	oldContent: string | null;
	newContent: string | null;
	unifiedDiff: string;
}

export interface BatchDiffResult {
	files: Array<{
		path: string;
		status: "added" | "modified" | "deleted";
		diff: FileDiffResult | null;
	}>;
	summary: { totalFiles: number; added: number; modified: number; deleted: number };
}

export interface FileHistoryResult {
	history: Array<{
		entryId: string;
		turnIndex: number;
		timestamp: string;
		status: "added" | "modified" | "deleted";
		snapshotHash: string;
		previousHash: string | null;
	}>;
}

// ============================================================================
// RPC Client
// ============================================================================

export class RpcClient {
	private process: ChildProcess | null = null;
	private stopReadingStdout: (() => void) | null = null;
	private eventListeners: RpcEventListener[] = [];
	private pendingRequests: Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }> =
		new Map();
	private channelHandlers = new Map<string, Set<(data: unknown) => unknown>>();
	private readyResolve: (() => void) | null = null;
	private readyReject: ((error: Error) => void) | null = null;
	private requestId = 0;
	private stderr = "";
	private exitError: Error | null = null;
	private options: RpcClientOptions;

	constructor(options: RpcClientOptions = {}) {
		this.options = options;
	}

	/**
	 * Start the RPC agent process.
	 */
	async start(): Promise<void> {
		if (this.process) {
			throw new Error("Client already started");
		}

		this.exitError = null;

		const cliPath = this.options.cliPath ?? "dist/cli.js";
		const args = ["--mode", "rpc"];

		if (this.options.provider) {
			args.push("--provider", this.options.provider);
		}
		if (this.options.model) {
			args.push("--model", this.options.model);
		}
		if (this.options.args) {
			args.push(...this.options.args);
		}

		const childProcess = spawn("node", [cliPath, ...args], {
			cwd: this.options.cwd,
			env: { ...process.env, ...this.options.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.process = childProcess;

		// Collect stderr for debugging
		childProcess.stderr?.on("data", (data) => {
			this.stderr += data.toString();
			process.stderr.write(data);
		});

		childProcess.once("exit", (code, signal) => {
			if (this.process !== childProcess) return;
			const error = this.createProcessExitError(code, signal);
			this.exitError = error;
			this.rejectReady(error);
			this.rejectPendingRequests(error);
		});
		childProcess.once("error", (error) => {
			if (this.process !== childProcess) return;
			const processError = new Error(`Agent process error: ${error.message}. Stderr: ${this.stderr}`);
			this.exitError = processError;
			this.rejectReady(processError);
			this.rejectPendingRequests(processError);
		});
		childProcess.stdin?.on("error", (error) => {
			if (this.process !== childProcess) return;
			const stdinError =
				this.exitError ?? new Error(`Agent process stdin error: ${error.message}. Stderr: ${this.stderr}`);
			this.exitError = stdinError;
			this.rejectReady(stdinError);
			this.rejectPendingRequests(stdinError);
		});

		// Set up strict JSONL reader for stdout.
		this.stopReadingStdout = attachJsonlLineReader(childProcess.stdout!, (line) => {
			this.handleLine(line);
		});

		await this.waitForReady();

		if (this.process.exitCode !== null) {
			const error = this.exitError ?? this.createProcessExitError(this.process.exitCode, this.process.signalCode);
			this.exitError = error;
			throw error;
		}
	}

	/**
	 * Stop the RPC agent process.
	 */
	async stop(): Promise<void> {
		if (!this.process) return;

		this.stopReadingStdout?.();
		this.stopReadingStdout = null;
		this.process.kill("SIGTERM");

		// Wait for process to exit
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				this.process?.kill("SIGKILL");
				resolve();
			}, 1000);

			this.process?.on("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
		});

		this.process = null;
		this.pendingRequests.clear();
	}

	/**
	 * Subscribe to agent events.
	 */
	onEvent(listener: RpcEventListener): () => void {
		this.eventListeners.push(listener);
		return () => {
			const index = this.eventListeners.indexOf(listener);
			if (index !== -1) {
				this.eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Get collected stderr output (useful for debugging).
	 */
	getStderr(): string {
		return this.stderr;
	}

	// =========================================================================
	// Command Methods
	// =========================================================================

	/**
	 * Send a prompt to the agent.
	 * Returns immediately after sending; use onEvent() to receive streaming events.
	 * Use waitForIdle() to wait for completion.
	 */
	async prompt(message: string, images?: ImageContent[]): Promise<void> {
		await this.send({ type: "prompt", message, images });
	}

	/**
	 * Queue a steering message to interrupt the agent mid-run.
	 */
	async steer(message: string, images?: ImageContent[]): Promise<void> {
		await this.send({ type: "steer", message, images });
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 */
	async followUp(message: string, images?: ImageContent[]): Promise<void> {
		await this.send({ type: "follow_up", message, images });
	}

	/**
	 * Abort current operation.
	 */
	async abort(): Promise<void> {
		await this.send({ type: "abort" });
	}

	/**
	 * Start a new session, optionally with parent tracking.
	 * @param parentSession - Optional parent session path for lineage tracking
	 * @returns Object with `cancelled: true` if an extension cancelled the new session
	 */
	async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
		const response = await this.send({ type: "new_session", parentSession });
		return this.getData(response);
	}

	/**
	 * Get current session state.
	 */
	async getState(): Promise<RpcSessionState> {
		const response = await this.send({ type: "get_state" });
		return this.getData(response);
	}

	/**
	 * Set model by provider and ID.
	 */
	async setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> {
		const response = await this.send({ type: "set_model", provider, modelId });
		return this.getData(response);
	}

	/**
	 * Cycle to next model.
	 */
	async cycleModel(): Promise<{
		model: { provider: string; id: string };
		thinkingLevel: ThinkingLevel;
		isScoped: boolean;
	} | null> {
		const response = await this.send({ type: "cycle_model" });
		return this.getData(response);
	}

	/**
	 * Get list of available models.
	 */
	async getAvailableModels(): Promise<ModelInfo[]> {
		const response = await this.send({ type: "get_available_models" });
		return this.getData<{ models: ModelInfo[] }>(response).models;
	}

	async getTierModels(): Promise<Record<string, string>> {
		const response = await this.send({ type: "get_tier_models" });
		return this.getData<{ models: Record<string, string> }>(response).models;
	}

	async setTierModels(models: { fast?: string; pro?: string; max?: string }): Promise<void> {
		await this.send({ type: "set_tier_models", models });
	}

	/**
	 * Set thinking level.
	 */
	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		await this.send({ type: "set_thinking_level", level });
	}

	/**
	 * Cycle thinking level.
	 */
	async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
		const response = await this.send({ type: "cycle_thinking_level" });
		return this.getData(response);
	}

	/**
	 * Set steering mode.
	 */
	async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.send({ type: "set_steering_mode", mode });
	}

	/**
	 * Set follow-up mode.
	 */
	async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.send({ type: "set_follow_up_mode", mode });
	}

	/**
	 * Compact session context.
	 */
	async compact(customInstructions?: string): Promise<CompactionResult> {
		const response = await this.send({ type: "compact", customInstructions });
		return this.getData(response);
	}

	/**
	 * Set auto-compaction enabled/disabled.
	 */
	async setAutoCompaction(enabled: boolean): Promise<void> {
		await this.send({ type: "set_auto_compaction", enabled });
	}

	/**
	 * Set auto-retry enabled/disabled.
	 */
	async setAutoRetry(enabled: boolean): Promise<void> {
		await this.send({ type: "set_auto_retry", enabled });
	}

	/**
	 * Abort in-progress retry.
	 */
	async abortRetry(): Promise<void> {
		await this.send({ type: "abort_retry" });
	}

	/**
	 * Execute a bash command.
	 */
	async bash(command: string): Promise<BashResult> {
		const response = await this.send({ type: "bash", command });
		return this.getData(response);
	}

	/**
	 * Abort running bash command.
	 */
	async abortBash(): Promise<void> {
		await this.send({ type: "abort_bash" });
	}

	/**
	 * Get session statistics.
	 */
	async getSessionStats(): Promise<SessionStats> {
		const response = await this.send({ type: "get_session_stats" });
		return this.getData(response);
	}

	/**
	 * Export session to HTML.
	 */
	async exportHtml(outputPath?: string): Promise<{ path: string }> {
		const response = await this.send({ type: "export_html", outputPath });
		return this.getData(response);
	}

	/**
	 * Switch to a different session file.
	 * @returns Object with `cancelled: true` if an extension cancelled the switch
	 */
	async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		const response = await this.send({ type: "switch_session", sessionPath });
		return this.getData(response);
	}

	/**
	 * Fork from a specific message.
	 * @returns Object with `text` (the message text) and `cancelled` (if extension cancelled)
	 */
	async fork(
		entryId: string,
		options?: { position?: "before" | "at" },
	): Promise<{ text: string; cancelled: boolean }> {
		const response = await this.send({ type: "fork", entryId, position: options?.position });
		return this.getData(response);
	}

	async navigateTree(
		targetId: string,
		options?: {
			summarize?: boolean;
			customInstructions?: string;
			replaceInstructions?: boolean;
			label?: string;
			skipFiles?: boolean;
		},
	): Promise<{ cancelled: boolean; editorText?: string; newLeafId: string | null; reason?: string }> {
		const response = await this.send({
			type: "navigate_tree",
			targetId,
			summarize: options?.summarize,
			customInstructions: options?.customInstructions,
			replaceInstructions: options?.replaceInstructions,
			label: options?.label,
			skipFiles: options?.skipFiles,
		});
		return this.getData(response);
	}

	async previewRollback(targetId: string): Promise<RollbackPreviewResult> {
		const response = await this.send({ type: "rollback_preview", targetId });
		return this.getData(response);
	}

	async deleteEntries(targetIds: string[]): Promise<{ entryId: string }> {
		const response = await this.send({ type: "delete_entries", targetIds });
		return this.getData(response);
	}

	async summarizeEntries(
		targetIds: string[],
		options?: { summary?: string; model?: string },
	): Promise<{ entryId: string }> {
		const response = await this.send({
			type: "summarize_entries",
			targetIds,
			summary: options?.summary,
			model: options?.model,
		});
		return this.getData(response);
	}

	/**
	 * Clone the current active branch into a new session.
	 * @returns Object with `cancelled: true` if an extension cancelled the clone
	 */
	async clone(): Promise<{ cancelled: boolean }> {
		const response = await this.send({ type: "clone" });
		return this.getData(response);
	}

	/**
	 * Get messages available for forking.
	 */
	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		const response = await this.send({ type: "get_fork_messages" });
		return this.getData<{ messages: Array<{ entryId: string; text: string }> }>(response).messages;
	}

	/**
	 * Get text of last assistant message.
	 */
	async getLastAssistantText(): Promise<string | null> {
		const response = await this.send({ type: "get_last_assistant_text" });
		return this.getData<{ text: string | null }>(response).text;
	}

	/**
	 * Set the session display name.
	 */
	async setSessionName(name: string): Promise<void> {
		await this.send({ type: "set_session_name", name });
	}

	/**
	 * Get all messages in the session.
	 */
	async getMessages(): Promise<AgentMessage[]> {
		const response = await this.send({ type: "get_messages" });
		return this.getData<{ messages: AgentMessage[] }>(response).messages;
	}

	async getFullMessages(options?: { afterEntryId?: string; limit?: number }): Promise<{
		messages: RpcAgentMessage[];
		hasMore: boolean;
		totalCount: number;
		nextCursor: string | null;
		tree: { entries: TreeEntry[]; leafId: string | null };
		customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
		compactionEntries: Array<{ id: string; summary: string; tokensBefore: number | undefined; timestamp: number }>;
	}> {
		const response = await this.send({
			type: "get_full_messages",
			afterEntryId: options?.afterEntryId,
			limit: options?.limit,
		});
		return this.getData(response);
	}

	async getTree(): Promise<{ entries: TreeEntry[] }> {
		const response = await this.send({ type: "get_tree" });
		return this.getData(response);
	}

	async getTreeWithLeaf(): Promise<TreeWithLeaf> {
		const response = await this.send({ type: "get_tree_with_leaf" });
		return this.getData(response);
	}

	async getModifiedFiles(options?: {
		fromEntryId?: string;
		toEntryId?: string;
		toTurnIndex?: number;
		fromTurnIndex?: number;
		toUserMsgEntryId?: string;
	}): Promise<ModifiedFilesResult> {
		const response = await this.send({
			type: "get_modified_files",
			fromEntryId: options?.fromEntryId,
			toEntryId: options?.toEntryId,
			toTurnIndex: options?.toTurnIndex,
			fromTurnIndex: options?.fromTurnIndex,
			toUserMsgEntryId: options?.toUserMsgEntryId,
		});
		return this.getData(response);
	}

	async getFileDiff(options: {
		filePath: string;
		fromEntryId?: string;
		toEntryId?: string;
		useBaselineHash?: boolean;
	}): Promise<FileDiffResult | null> {
		const response = await this.send({
			type: "get_file_diff",
			filePath: options.filePath,
			fromEntryId: options.fromEntryId,
			toEntryId: options.toEntryId,
			useBaselineHash: options.useBaselineHash,
		});
		return this.getData(response);
	}

	async getBatchDiffs(options?: { fromEntryId?: string; toEntryId?: string }): Promise<BatchDiffResult> {
		const response = await this.send({
			type: "get_batch_diffs",
			fromEntryId: options?.fromEntryId,
			toEntryId: options?.toEntryId,
		});
		return this.getData(response);
	}

	async getFileHistory(options: { filePath: string }): Promise<FileHistoryResult> {
		const response = await this.send({
			type: "get_file_history",
			filePath: options.filePath,
		});
		return this.getData(response);
	}

	/**
	 * Get available commands (extension commands, prompt templates, skills).
	 */
	async getCommands(): Promise<RpcSlashCommand[]> {
		const response = await this.send({ type: "get_commands" });
		return this.getData<{ commands: RpcSlashCommand[] }>(response).commands;
	}

	async getSkills(): Promise<RpcSkill[]> {
		const response = await this.send({ type: "get_skills" });
		return this.getData<{ skills: RpcSkill[] }>(response).skills;
	}

	async getExtensions(): Promise<RpcExtension[]> {
		const response = await this.send({ type: "get_extensions" });
		return this.getData<{ extensions: RpcExtension[] }>(response).extensions;
	}

	async getTools(): Promise<RpcTool[]> {
		const response = await this.send({ type: "get_tools" });
		return this.getData<{ tools: RpcTool[] }>(response).tools;
	}

	async getSettings(scope?: "global" | "project"): Promise<Settings> {
		const response = await this.send({ type: "get_settings", scope });
		return this.getData(response);
	}

	async setSettings(settings: Partial<Settings>, scope?: "global" | "project"): Promise<void> {
		await this.send({ type: "set_settings", settings, scope });
	}

	async getContextUsage(): Promise<RpcContextUsage> {
		const response = await this.send({ type: "get_context_usage" });
		return this.getData(response);
	}

	async getSystemPrompt(): Promise<{ systemPrompt: string; appendSystemPrompt: string[] }> {
		const response = await this.send({ type: "get_system_prompt" });
		return this.getData(response);
	}

	async getActiveTools(): Promise<string[]> {
		const response = await this.send({ type: "get_active_tools" });
		return this.getData<{ toolNames: string[] }>(response).toolNames;
	}

	async setActiveTools(toolNames: string[]): Promise<void> {
		await this.send({ type: "set_active_tools", toolNames });
	}

	async getQueue(): Promise<{ steering: string[]; followUp: string[] }> {
		const response = await this.send({ type: "get_queue" });
		return this.getData(response);
	}

	async clearQueue(): Promise<{ steering: string[]; followUp: string[] }> {
		const response = await this.send({ type: "clear_queue" });
		return this.getData(response);
	}

	async getFlags(): Promise<RpcExtensionFlag[]> {
		const response = await this.send({ type: "get_flags" });
		return this.getData<{ flags: RpcExtensionFlag[] }>(response).flags;
	}

	async getFlagValues(): Promise<Record<string, boolean | string>> {
		const response = await this.send({ type: "get_flag_values" });
		return this.getData<{ values: Record<string, boolean | string> }>(response).values;
	}

	async setFlag(name: string, value: boolean | string): Promise<void> {
		await this.send({ type: "set_flag", name, value });
	}

	async reload(): Promise<void> {
		await this.send({ type: "reload" });
	}

	async setCwd(cwd: string): Promise<{ cancelled: boolean }> {
		const response = await this.send({ type: "set_cwd", cwd });
		return this.getData(response);
	}

	async getAgentsFiles(): Promise<Array<{ path: string; content: string }>> {
		const response = await this.send({ type: "get_agents_files" });
		return this.getData<{ agentsFiles: Array<{ path: string; content: string }> }>(response).agentsFiles;
	}

	async getAgents(): Promise<RpcAgentSummary[]> {
		const response = await this.send({ type: "get_agents" });
		return this.getData<{ agents: RpcAgentSummary[] }>(response).agents;
	}

	async switchAgent(agentName: string): Promise<{
		agentName: string;
		tools: string[];
		tier?: string;
		thinkingLevel?: string;
	}> {
		const response = await this.send({ type: "switch_agent", agentName });
		return this.getData(response);
	}

	async getCurrentAgent(): Promise<{ agentName: string }> {
		const response = await this.send({ type: "get_current_agent" });
		return this.getData(response);
	}

	async getLatestAgentChange(): Promise<{
		agentName: string;
		agentConfig?: unknown;
		timestamp: string;
	} | null> {
		const response = await this.send({ type: "get_latest_agent_change" });
		return this.getData(response);
	}

	async getAgentDetail(agentName: string): Promise<AgentConfig> {
		const response = await this.send({ type: "get_agent_detail", agentName });
		return this.getData<{ agent: AgentConfig }>(response).agent;
	}

	async getAllTools(): Promise<RpcAllTool[]> {
		const response = await this.send({ type: "get_all_tools" });
		return this.getData<{ tools: RpcAllTool[] }>(response).tools;
	}

	async setPermissionMode(mode: "auto" | "acceptEdits" | "dontAsk" | "always-allow" | "always-deny"): Promise<{
		mode: "auto" | "acceptEdits" | "dontAsk" | "always-allow" | "always-deny";
	}> {
		const response = await this.send({ type: "set_permission_mode", mode });
		return this.getData(response);
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	/**
	 * Wait for agent to become idle (no streaming).
	 * Resolves when agent_end event is received.
	 */
	waitForIdle(timeout = 60000): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error(`Timeout waiting for agent to become idle. Stderr: ${this.stderr}`));
			}, timeout);

			const unsubscribe = this.onEvent((event) => {
				if (event.type === "agent_end") {
					clearTimeout(timer);
					unsubscribe();
					resolve();
				}
			});
		});
	}

	/**
	 * Collect events until agent becomes idle.
	 */
	collectEvents(timeout = 60000): Promise<AgentEvent[]> {
		return new Promise((resolve, reject) => {
			const events: AgentEvent[] = [];
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error(`Timeout collecting events. Stderr: ${this.stderr}`));
			}, timeout);

			const unsubscribe = this.onEvent((event) => {
				events.push(event);
				if (event.type === "agent_end") {
					clearTimeout(timer);
					unsubscribe();
					resolve(events);
				}
			});
		});
	}

	/**
	 * Send prompt and wait for completion, returning all events.
	 */
	async promptAndWait(message: string, images?: ImageContent[], timeout = 60000): Promise<AgentEvent[]> {
		const eventsPromise = this.collectEvents(timeout);
		await this.prompt(message, images);
		return eventsPromise;
	}

	channel(name: string): Pick<Channel, "name" | "send" | "onReceive" | "invoke" | "call"> {
		const invokeImpl = (data: unknown, timeoutMs = 30_000): Promise<unknown> => {
			return new Promise((resolve, reject) => {
				const invokeId = `inv_${randomUUID().slice(0, 8)}`;
				let timer: ReturnType<typeof setTimeout>;
				const handler = (responseData: unknown) => {
					const payload = responseData as Record<string, unknown> | undefined;
					if (payload?.invokeId !== invokeId) return;
					clearTimeout(timer);
					const handlers = this.channelHandlers.get(name);
					handlers?.delete(handler);
					if (handlers?.size === 0) this.channelHandlers.delete(name);
					resolve(responseData);
				};
				timer = setTimeout(() => {
					const handlers = this.channelHandlers.get(name);
					handlers?.delete(handler);
					if (handlers?.size === 0) this.channelHandlers.delete(name);
					reject(new Error(`Channel invoke "${name}" timed out after ${timeoutMs}ms`));
				}, timeoutMs);

				let handlers = this.channelHandlers.get(name);
				if (!handlers) {
					handlers = new Set();
					this.channelHandlers.set(name, handlers);
				}
				handlers.add(handler);

				this.writeLine({
					type: "channel_data",
					name,
					data: { ...((data as Record<string, unknown>) ?? {}), invokeId },
				} as ChannelDataMessage);
			});
		};

		return {
			name,
			send: (data: unknown) => {
				this.writeLine({ type: "channel_data", name, data } as ChannelDataMessage);
			},
			onReceive: (handler: (data: unknown) => unknown) => {
				let handlers = this.channelHandlers.get(name);
				if (!handlers) {
					handlers = new Set();
					this.channelHandlers.set(name, handlers);
				}
				handlers.add(handler);
				return () => {
					handlers.delete(handler);
					if (handlers.size === 0) this.channelHandlers.delete(name);
				};
			},
			invoke: invokeImpl,
			call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
				return invokeImpl({ ...params, __call: method }, timeoutMs);
			},
		};
	}

	// =========================================================================
	// Internal
	// =========================================================================

	private handleLine(line: string): void {
		try {
			const data = JSON.parse(line);

			if (data.type === "ready") {
				this.resolveReady();
				return;
			}

			// Check if it's a response to a pending request
			if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
				const pending = this.pendingRequests.get(data.id)!;
				this.pendingRequests.delete(data.id);
				pending.resolve(data as RpcResponse);
				return;
			}

			if (data.type === "channel_data" && data.name) {
				const handlers = this.channelHandlers.get(data.name as string);
				if (handlers) {
					for (const handler of handlers) {
						const payload = data.data as Record<string, unknown> | undefined;
						const invokeId = payload?.invokeId as string | undefined;
						const result = handler(data.data);
						if (invokeId && result !== undefined) {
							const responseData =
								result && typeof result === "object" ? (result as Record<string, unknown>) : { value: result };
							this.writeLine({
								type: "channel_data",
								name: data.name,
								data: { ...responseData, invokeId },
							} as ChannelDataMessage);
						}
					}
				}
				return;
			}

			// Otherwise it's an event
			for (const listener of this.eventListeners) {
				listener(data as AgentEvent);
			}
		} catch {
			// Ignore non-JSON lines
		}
	}

	private createProcessExitError(code: number | null, signal: NodeJS.Signals | null): Error {
		return new Error(`Agent process exited (code=${code} signal=${signal}). Stderr: ${this.stderr}`);
	}

	private waitForReady(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.exitError) {
				reject(this.exitError);
				return;
			}
			if (this.process && this.process.exitCode !== null) {
				const error = this.createProcessExitError(this.process.exitCode, this.process.signalCode);
				this.exitError = error;
				reject(error);
				return;
			}

			const timeout = setTimeout(() => {
				this.readyResolve = null;
				this.readyReject = null;
				reject(new Error(`Agent process did not become ready. Stderr: ${this.stderr}`));
			}, 15000);

			this.readyResolve = () => {
				clearTimeout(timeout);
				this.readyResolve = null;
				this.readyReject = null;
				resolve();
			};
			this.readyReject = (error: Error) => {
				clearTimeout(timeout);
				this.readyResolve = null;
				this.readyReject = null;
				reject(error);
			};
		});
	}

	private resolveReady(): void {
		this.readyResolve?.();
	}

	private rejectReady(error: Error): void {
		this.readyReject?.(error);
	}

	private rejectPendingRequests(error: Error): void {
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}

	private async send(command: RpcCommandBody): Promise<RpcResponse> {
		const childProcess = this.process;
		const stdin = childProcess?.stdin;
		if (!childProcess || !stdin) {
			throw new Error("Client not started");
		}
		if (this.exitError) {
			throw this.exitError;
		}
		if (childProcess.exitCode !== null) {
			const error = this.createProcessExitError(childProcess.exitCode, childProcess.signalCode);
			this.exitError = error;
			throw error;
		}
		if (stdin.destroyed || !stdin.writable) {
			const error = new Error(`Agent process stdin is not writable. Stderr: ${this.stderr}`);
			this.exitError = error;
			throw error;
		}

		const id = `req_${++this.requestId}`;
		const fullCommand = { ...command, id } as RpcCommand;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Timeout waiting for response to ${command.type}. Stderr: ${this.stderr}`));
			}, 30000);

			this.pendingRequests.set(id, {
				resolve: (response) => {
					clearTimeout(timeout);
					resolve(response);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				},
			});

			try {
				this.writeLine(fullCommand);
			} catch (error: unknown) {
				const writeError = error instanceof Error ? error : new Error(String(error));
				const pending = this.pendingRequests.get(id);
				this.pendingRequests.delete(id);
				pending?.reject(writeError);
			}
		});
	}

	private writeLine(obj: object): void {
		const stdin = this.process?.stdin;
		if (!stdin) {
			throw new Error("Client not started");
		}
		stdin.write(serializeJsonLine(obj));
	}

	private getData<T>(response: RpcResponse): T {
		if (!response.success) {
			const errorResponse = response as Extract<RpcResponse, { success: false }>;
			throw new Error(errorResponse.error);
		}
		// Type assertion: we trust response.data matches T based on the command sent.
		// This is safe because each public method specifies the correct T for its command.
		const successResponse = response as Extract<RpcResponse, { success: true; data: unknown }>;
		return successResponse.data as T;
	}
}
