/**
 * RPC Client for programmatic access to the coding agent.
 *
 * Spawns the agent in RPC mode and provides a typed API for all operations.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentMessage, ThinkingLevel } from "@dyyz1993/pi-agent-core";
import type { ImageContent } from "@dyyz1993/pi-ai";
import type { SessionStats } from "../../core/agent-session.js";
import type { BashResult } from "../../core/bash-executor.js";
import type { CompactionResult } from "../../core/compaction/index.js";
import type { Channel, ChannelDataMessage } from "../../core/extensions/channel-types.js";
import type { Settings } from "../../core/settings-manager.js";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.js";
import type {
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
} from "./rpc-types.js";

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
	/** Session-scoped variables passed to extensions via ctx.variables */
	variables?: Record<string, string>;
}

export interface ModelInfo {
	provider: string;
	id: string;
	contextWindow: number;
	reasoning: boolean;
}

export type RpcEventListener = (event: AgentEvent) => void;

// ============================================================================
// Type exports
// ============================================================================

/**
 * Entry in the session tree.
 */
export type { TreeEntry } from "./rpc-types.js";

// ============================================================================
// RPC Client
// ============================================================================

export class RpcClient {
	private process: ChildProcess | null = null;
	private stopReadingStdout: (() => void) | null = null;
	private eventListeners: RpcEventListener[] = [];
	private pendingRequests: Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }> =
		new Map();
	private requestId = 0;
	private channelHandlers = new Map<string, Set<(data: unknown) => void>>();
	private remoteToolCallHandlers: Array<
		(call: { toolCallId: string; toolName: string; args: Record<string, unknown> }) => void
	> = [];
	private stderr = "";
	private readyResolve: (() => void) | null = null;

	constructor(private options: RpcClientOptions = {}) {}

	/**
	 * Start the RPC agent process.
	 */
	async start(): Promise<void> {
		if (this.process) {
			throw new Error("Client already started");
		}

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

		const mergedEnv: Record<string, string> = { ...process.env, ...this.options.env } as Record<string, string>;
		if (this.options.variables) {
			for (const [key, value] of Object.entries(this.options.variables)) {
				mergedEnv[`PI_VARIABLE_${key.toUpperCase()}`] = value;
			}
		}

		this.process = spawn("node", [cliPath, ...args], {
			cwd: this.options.cwd,
			env: mergedEnv,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Collect stderr for debugging
		this.process.stderr?.on("data", (data) => {
			this.stderr += data.toString();
			process.stderr.write(data);
		});

		// Set up strict JSONL reader for stdout.
		this.stopReadingStdout = attachJsonlLineReader(this.process.stdout!, (line) => {
			this.handleLine(line);
		});

		// Wait for first stdout line (agent ready)
		await new Promise<void>((resolve, reject) => {
			this.readyResolve = resolve;
			const timeout = setTimeout(() => {
				this.readyResolve = null;
				reject(new Error(`Agent process did not become ready. Stderr: ${this.stderr}`));
			}, 15000);
			this.readyResolve = () => {
				clearTimeout(timeout);
				resolve();
			};
		});

		if (this.process.exitCode !== null) {
			throw new Error(`Agent process exited immediately with code ${this.process.exitCode}. Stderr: ${this.stderr}`);
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
	): Promise<{ text: string; cancelled: boolean; newSessionFile?: string; newSessionId?: string }> {
		const response = await this.send({ type: "fork", entryId, position: options?.position });
		return this.getData(response);
	}

	async navigateTree(
		targetId: string,
		options?: { summarize?: boolean; skipFiles?: boolean },
	): Promise<{ cancelled: boolean }> {
		const response = await this.send({
			type: "navigate_tree",
			targetId,
			summarize: options?.summarize,
			skipFiles: options?.skipFiles,
		});
		return this.getData(response);
	}

	async previewRollback(targetId: string): Promise<{ restored: string[]; deleted: string[] }> {
		const response = await this.send({ type: "rollback_preview", targetId });
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

	async getTree(): Promise<TreeEntry[]> {
		const response = await this.send({ type: "get_tree" });
		const data = this.getData<{
			entries: TreeEntry[];
			leafId?: string | null;
		}>(response);
		return data.entries;
	}

	async getTreeWithLeaf(): Promise<{
		entries: TreeEntry[];
		leafId: string | null;
	}> {
		const response = await this.send({ type: "get_tree" });
		const data = this.getData<{
			entries: TreeEntry[];
			leafId?: string | null;
		}>(response);
		return { entries: data.entries, leafId: data.leafId ?? null };
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
		return this.getData<Settings>(response);
	}

	async setSettings(settings: Partial<Settings>, scope?: "global" | "project"): Promise<void> {
		await this.send({ type: "set_settings", settings, scope });
	}

	async getContextUsage(): Promise<RpcContextUsage> {
		const response = await this.send({ type: "get_context_usage" });
		return this.getData<RpcContextUsage>(response);
	}

	async getSystemPrompt(): Promise<{ systemPrompt: string; appendSystemPrompt: string[] }> {
		const response = await this.send({ type: "get_system_prompt" });
		return this.getData<{ systemPrompt: string; appendSystemPrompt: string[] }>(response);
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
		return this.getData<{ steering: string[]; followUp: string[] }>(response);
	}

	async clearQueue(): Promise<{ steering: string[]; followUp: string[] }> {
		const response = await this.send({ type: "clear_queue" });
		return this.getData<{ steering: string[]; followUp: string[] }>(response);
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

	async setCwd(cwd: string): Promise<void> {
		await this.send({ type: "set_cwd", cwd });
	}

	async getAgentsFiles(): Promise<Array<{ path: string; content: string }>> {
		const response = await this.send({ type: "get_agents_files" });
		return this.getData<{ agentsFiles: Array<{ path: string; content: string }> }>(response).agentsFiles;
	}

	async registerRemoteTool(tool: { name: string; description: string; parameters: object }): Promise<void> {
		await this.send({ type: "register_remote_tool", tool });
	}

	async unregisterRemoteTool(name: string): Promise<void> {
		await this.send({ type: "unregister_remote_tool", name });
	}

	sendRemoteToolResult(
		toolCallId: string,
		result: { content: Array<{ type: string; text: string }>; isError: boolean },
	): void {
		this.writeLine({ type: "remote_tool_result", toolCallId, result });
	}

	onRemoteToolCall(
		handler: (call: { toolCallId: string; toolName: string; args: Record<string, unknown> }) => void,
	): () => void {
		this.remoteToolCallHandlers.push(handler);
		return () => {
			const index = this.remoteToolCallHandlers.indexOf(handler);
			if (index !== -1) this.remoteToolCallHandlers.splice(index, 1);
		};
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
		const invokeImpl = (data: unknown, timeoutMs: number = 30_000): Promise<unknown> => {
			return new Promise((resolve, reject) => {
				const invokeId = `inv_${randomUUID().slice(0, 8)}`;
				const timer = setTimeout(() => {
					reject(new Error(`Channel invoke "${name}" timed out after ${timeoutMs}ms`));
				}, timeoutMs);

				const handler = (responseData: unknown) => {
					const d = responseData as Record<string, unknown>;
					if (d && d.invokeId === invokeId) {
						clearTimeout(timer);
						const handlers = this.channelHandlers.get(name);
						if (handlers) handlers.delete(handler);
						resolve(responseData);
					}
				};

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
			onReceive: (handler: (data: unknown) => void) => {
				let handlers = this.channelHandlers.get(name);
				if (!handlers) {
					handlers = new Set();
					this.channelHandlers.set(name, handlers);
				}
				handlers.add(handler);
				return () => {
					handlers!.delete(handler);
					if (handlers!.size === 0) this.channelHandlers.delete(name);
				};
			},
			invoke: invokeImpl,
			call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
				const payload = { ...params, __call: method };
				return invokeImpl(payload, timeoutMs ?? 30_000);
			},
		};
	}

	// =========================================================================
	// Internal
	// =========================================================================

	private handleLine(line: string): void {
		try {
			const data = JSON.parse(line);

			if (this.readyResolve && data.type === "ready") {
				const resolve = this.readyResolve;
				this.readyResolve = null;
				resolve();
				return;
			}

			// Check if it's a response to a pending request
			if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
				const pending = this.pendingRequests.get(data.id)!;
				this.pendingRequests.delete(data.id);
				pending.resolve(data as RpcResponse);
				return;
			}

			// Check if it's channel data
			if (data.type === "channel_data" && data.name) {
				const handlers = this.channelHandlers.get(data.name as string);
				if (handlers) {
					const payload = data.data as Record<string, unknown> | undefined;
					const invokeId = payload?.invokeId as string | undefined;

					for (const handler of handlers) {
						const result = handler(data.data);
						if (invokeId && result !== undefined) {
							this.writeLine({
								type: "channel_data",
								name: data.name,
								data: { ...(typeof result === "object" ? result : { value: result }), invokeId },
							} as ChannelDataMessage);
						}
					}
				}
				return;
			}

			// Check if it's a remote tool call
			if (data.type === "remote_tool_call" && data.toolCallId && data.toolName) {
				for (const handler of this.remoteToolCallHandlers) {
					handler({ toolCallId: data.toolCallId, toolName: data.toolName, args: data.args ?? {} });
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

	private async send(command: RpcCommandBody): Promise<RpcResponse> {
		if (!this.process?.stdin) {
			throw new Error("Client not started");
		}

		const id = `req_${++this.requestId}`;
		const fullCommand = { ...command, id } as RpcCommand;

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });

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

			this.process!.stdin!.write(serializeJsonLine(fullCommand));
		});
	}

	private getData<T>(response: RpcResponse): T {
		if (!response.success) {
			const errorResponse = response as Extract<RpcResponse, { success: false }>;
			throw new Error(errorResponse.error);
		}
		const successResponse = response as Extract<RpcResponse, { success: true; data: unknown }>;
		return successResponse.data as T;
	}

	private writeLine(obj: object): void {
		if (!this.process?.stdin) {
			throw new Error("Client not started");
		}
		this.process.stdin.write(serializeJsonLine(obj));
	}
}
