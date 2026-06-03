/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */

import * as crypto from "node:crypto";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { PermissionMode } from "../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import { discoverAgents } from "../../core/agent-types.ts";
import { generateSegmentSummary } from "../../core/compaction/branch-summarization.ts";
import { ChannelManager } from "../../core/extensions/channel-manager.ts";
import type { ChannelDataMessage } from "../../core/extensions/channel-types.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import { createBranchSummaryMessage } from "../../core/messages.ts";
import { resolveModelAlias } from "../../core/model-resolver.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import type { CompactionEntry, CustomEntry, SessionEntry, SessionMessageEntry } from "../../core/session-manager.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type {
	RpcAgentSummary,
	RpcAllTool,
	RpcCommand,
	RpcContextUsage,
	RpcExtension,
	RpcExtensionFlag,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	RpcSkill,
	RpcSlashCommand,
	RpcTool,
	TreeEntry,
} from "./rpc-types.ts";

// Re-export types for consumers
export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
} from "./rpc-types.ts";

const PERMISSION_MODES = ["auto", "acceptEdits", "dontAsk", "always-allow", "always-deny"] as const;

function isPermissionMode(mode: string): mode is PermissionMode {
	return (PERMISSION_MODES as readonly string[]).includes(mode);
}

function getTreeEntryLabel(entry: SessionEntry): string | undefined {
	if ("message" in entry) {
		return entry.message.role;
	}
	if ("customType" in entry) {
		return entry.customType;
	}
	return undefined;
}

function toTreeEntry(entry: SessionEntry): TreeEntry {
	return {
		id: entry.id,
		parentId: entry.parentId,
		type: entry.type,
		label: getTreeEntryLabel(entry),
	};
}

function isSessionMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
	return "message" in entry;
}

function isCustomEntry(entry: SessionEntry): entry is CustomEntry {
	return entry.type === "custom" && "customType" in entry;
}

function isCompactionEntry(entry: SessionEntry): entry is CompactionEntry {
	return entry.type === "compaction" && "summary" in entry;
}

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;

	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};

	const channelManager = new ChannelManager((message: ChannelDataMessage) => {
		output(message);
	});

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	// Pending extension UI requests waiting for response
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>();

	// Shutdown request flag
	let shutdownRequested = false;
	let shuttingDown = false;
	const signalCleanupHandlers: Array<() => void> = [];

	/** Helper for dialog methods with signal/timeout support */
	function createDialogPromise<T>(
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
			});
			output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}

	/**
	 * Create an extension UI context that uses the RPC protocol.
	 */
	const createExtensionUIContext = (): ExtensionUIContext => ({
		select: (title, options, opts) =>
			createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		confirm: (title, message, opts) =>
			createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			} as RpcExtensionUIRequest);
		},

		onTerminalInput(): () => void {
			// Raw terminal input not supported in RPC mode
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcExtensionUIRequest);
		},

		setWorkingMessage(_message?: string): void {
			// Working message not supported in RPC mode - requires TUI loader access
		},

		setWorkingVisible(_visible: boolean): void {
			// Working visibility not supported in RPC mode - requires TUI loader access
		},

		setWorkingIndicator(_options?: WorkingIndicatorOptions): void {
			// Working indicator customization not supported in RPC mode - requires TUI loader access
		},

		setHiddenThinkingLabel(_label?: string): void {
			// Hidden thinking label not supported in RPC mode - requires TUI message rendering access
		},

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in RPC mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				} as RpcExtensionUIRequest);
			}
			// Component factories are not supported in RPC mode - would need TUI access
		},

		setFooter(_factory: unknown): void {
			// Custom footer not supported in RPC mode - requires TUI access
		},

		setHeader(_factory: unknown): void {
			// Custom header not supported in RPC mode - requires TUI access
		},

		setTitle(title: string): void {
			// Fire and forget - host can implement terminal title control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
			} as RpcExtensionUIRequest);
		},

		async custom() {
			// Custom UI not supported in RPC mode
			return undefined as never;
		},

		pasteToEditor(text: string): void {
			// Paste handling not supported in RPC mode - falls back to setEditorText
			this.setEditorText(text);
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			} as RpcExtensionUIRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => {
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject,
				});
				output({ type: "extension_ui_request", id, method: "editor", title, prefill } as RpcExtensionUIRequest);
			});
		},

		addAutocompleteProvider(): void {
			// Autocomplete provider composition is not supported in RPC mode
		},

		setEditorComponent(): void {
			// Custom editor components not supported in RPC mode
		},

		getEditorComponent() {
			// Custom editor components not supported in RPC mode
			return undefined;
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | Theme) {
			// Theme switching not supported in RPC mode
			return { success: false, error: "Theme switching not supported in RPC mode" };
		},

		getToolsExpanded() {
			// Tool expansion not supported in RPC mode - no TUI
			return false;
		},

		setToolsExpanded(_expanded: boolean) {
			// Tool expansion not supported in RPC mode - no TUI
		},
	});

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		await session.bindExtensions({
			uiContext: createExtensionUIContext(),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (options) => runtimeHost.newSession(options),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
						skipFiles: options?.skipFiles,
					});
					return { cancelled: result.cancelled, reason: result.reason };
				},
				switchSession: async (sessionPath, options) => {
					return runtimeHost.switchSession(sessionPath, options);
				},
				reload: async () => {
					await session.reload();
				},
			},
			shutdownHandler: () => {
				shutdownRequested = true;
			},
			onError: (err) => {
				output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
			},
			registerChannel: (name: string) => channelManager.register(name),
		});

		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribe = session.subscribe((event) => {
			output(event);
		});
		unsubscribeBackpressure = session.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	await rebindSession();
	registerSignalHandlers();
	output({ type: "ready" });

	// Handle a single command
	const handleCommand = async (command: RpcCommand): Promise<RpcResponse | undefined> => {
		const id = command.id;

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				// Start prompt handling immediately, but emit the authoritative response only after
				// prompt preflight succeeds. Queued and immediately handled prompts also count as success.
				let preflightSucceeded = false;
				void session
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
						preflightResult: (didSucceed) => {
							if (didSucceed) {
								preflightSucceeded = true;
								output(success(id, "prompt"));
							}
						},
					})
					.catch((e) => {
						if (!preflightSucceeded) {
							output(error(id, "prompt", e.message));
						}
					});
				return undefined;
			}

			case "steer": {
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				await session.abort();
				return success(id, "abort");
			}

			case "new_session": {
				const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const result = await runtimeHost.newSession(options);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "new_session", result);
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				const state: RpcSessionState = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					autoCompactionEnabled: session.autoCompactionEnabled,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
					streamingMessage: session.state.streamingMessage,
				};
				return success(id, "get_state", state);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = await session.modelRegistry.getAvailable();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				const models = await session.modelRegistry.getAvailable();
				return success(id, "get_available_models", { models });
			}

			case "get_tier_models": {
				return success(id, "get_tier_models", { models: session.getTierModels() });
			}

			case "set_tier_models": {
				const validTiers = new Set(["fast", "pro", "max"]);
				for (const tierName of Object.keys(command.models)) {
					if (!validTiers.has(tierName)) {
						return error(
							id,
							"set_tier_models",
							`Invalid tier name: "${tierName}". Valid tiers are: fast, pro, max`,
						);
					}
				}
				const mapping: Record<string, string> = {};
				if (command.models.fast !== undefined) mapping.fast = command.models.fast;
				if (command.models.pro !== undefined) mapping.pro = command.models.pro;
				if (command.models.max !== undefined) mapping.max = command.models.max;
				session.setTierModels(mapping);
				return success(id, "set_tier_models");
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const result = await session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext,
				});
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "switch_session": {
				const result = await runtimeHost.switchSession(command.sessionPath);
				if (!result.cancelled) {
					session = runtimeHost.session;
				}
				return success(id, "switch_session", result);
			}

			case "fork": {
				const result = await runtimeHost.fork(command.entryId, { position: command.position });
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "navigate_tree": {
				const result = await session.navigateTree(command.targetId, {
					summarize: command.summarize,
					customInstructions: command.customInstructions,
					replaceInstructions: command.replaceInstructions,
					label: command.label,
					skipFiles: command.skipFiles,
				});
				return success(id, "navigate_tree", {
					cancelled: result.cancelled,
					editorText: result.editorText,
					newLeafId: session.sessionManager.getLeafId(),
					reason: result.reason,
				});
			}

			case "rollback_preview": {
				const previewResult = await session.previewRollback(command.targetId);
				return success(id, "rollback_preview", previewResult);
			}

			case "delete_entries": {
				const entryId = session.sessionManager.appendDeletion(command.targetIds);
				const sessionContext = session.sessionManager.buildSessionContext();
				session.agent.state.messages = sessionContext.messages;
				return success(id, "delete_entries", { entryId });
			}

			case "summarize_entries": {
				let summary = command.summary;
				if (!summary) {
					const entries = command.targetIds
						.map((targetId) => session.sessionManager.getEntry(targetId))
						.filter((entry): entry is SessionEntry => entry !== undefined);
					if (entries.length === 0) {
						return error(id, "summarize_entries", "No valid entries found for summarization");
					}

					const modelInput = command.model ?? "pro";
					const aliasTarget = resolveModelAlias(modelInput, session.getTierModels());
					const summarizationModel = aliasTarget
						? session.modelRegistry.getAll().find((model) => `${model.provider}/${model.id}` === aliasTarget)
						: session.model;
					if (!summarizationModel) {
						return error(id, "summarize_entries", "No model available for summarization");
					}

					const authResult = await session.modelRegistry.getApiKeyAndHeaders(summarizationModel);
					if (!authResult.ok) {
						return error(id, "summarize_entries", `No API key for summarization model: ${authResult.error}`);
					}

					const result = await generateSegmentSummary(entries, {
						model: summarizationModel,
						apiKey: authResult.apiKey ?? "",
						headers: authResult.headers,
						signal: AbortSignal.timeout(30000),
					});
					if (result.error) {
						return error(id, "summarize_entries", result.error);
					}
					summary = result.summary;
				}

				const entryId = session.sessionManager.appendSegmentSummary(command.targetIds, summary);
				const sessionContext = session.sessionManager.buildSessionContext();
				session.agent.state.messages = sessionContext.messages;
				return success(id, "summarize_entries", { entryId });
			}

			case "clone": {
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) {
					return error(id, "clone", "Cannot clone session: no current entry selected");
				}
				const result = await runtimeHost.fork(leafId, { position: "at" });
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "clone", { cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return success(id, "get_fork_messages", { messages });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return success(id, "set_session_name");
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}

			case "get_full_messages": {
				const allEntries = session.sessionManager.getEntries();
				const branchEntries = session.sessionManager.getBranch();
				const deletedIds = new Set<string>();
				for (const entry of branchEntries) {
					if (entry.type === "deletion") {
						for (const targetId of entry.targetIds) {
							deletedIds.add(targetId);
						}
					}
				}
				const segmentTargets = new Map<string, { summary: string; isFirst: boolean; timestamp: string }>();
				for (const entry of branchEntries) {
					if (entry.type === "segment_summary") {
						for (let index = 0; index < entry.targetIds.length; index++) {
							const targetId = entry.targetIds[index];
							if (deletedIds.has(targetId) || segmentTargets.has(targetId)) continue;
							segmentTargets.set(targetId, {
								summary: entry.summary,
								isFirst: index === 0,
								timestamp: entry.timestamp,
							});
						}
					}
				}

				const messageEntries: Array<{ entryId: string; message: AgentMessage }> = [];
				for (const entry of branchEntries) {
					if (!isSessionMessageEntry(entry) || deletedIds.has(entry.id)) continue;
					const segment = segmentTargets.get(entry.id);
					if (segment) {
						if (segment.isFirst) {
							messageEntries.push({
								entryId: entry.id,
								message: createBranchSummaryMessage(segment.summary, entry.id, segment.timestamp),
							});
						}
						continue;
					}
					messageEntries.push({ entryId: entry.id, message: entry.message });
				}
				const messages = messageEntries.map((entry) => ({ ...entry.message, entryId: entry.entryId }));
				const totalCount = messages.length;
				const treeEntries = allEntries.map(toTreeEntry);
				const customEntries = allEntries.filter(isCustomEntry).map((entry) => ({
					id: entry.id,
					customType: entry.customType,
					data: entry.data,
					timestamp: new Date(entry.timestamp).getTime(),
				}));
				const compactionEntries = allEntries.filter(isCompactionEntry).map((entry) => ({
					id: entry.id,
					summary: entry.summary,
					tokensBefore: entry.tokensBefore,
					timestamp: new Date(entry.timestamp).getTime(),
				}));

				if (command.limit !== undefined) {
					const startIndex = command.afterEntryId
						? Math.max(0, messageEntries.findIndex((entry) => entry.entryId === command.afterEntryId) + 1)
						: 0;
					const page = messages.slice(startIndex, startIndex + command.limit);
					const hasMore = startIndex + command.limit < totalCount;
					const nextCursorEntry = hasMore ? messageEntries[startIndex + command.limit - 1] : undefined;
					return success(id, "get_full_messages", {
						messages: page,
						hasMore,
						totalCount,
						nextCursor: nextCursorEntry?.entryId ?? null,
						tree: { entries: treeEntries, leafId: session.sessionManager.getLeafId() },
						customEntries,
						compactionEntries,
					});
				}

				return success(id, "get_full_messages", {
					messages,
					hasMore: false,
					totalCount,
					nextCursor: null,
					tree: { entries: treeEntries, leafId: session.sessionManager.getLeafId() },
					customEntries,
					compactionEntries,
				});
			}

			case "get_tree": {
				const entries = session.sessionManager.getEntries().map(toTreeEntry);
				return success(id, "get_tree", { entries });
			}

			case "get_tree_with_leaf": {
				const entries = session.sessionManager.getEntries().map(toTreeEntry);
				return success(id, "get_tree_with_leaf", { entries, leafId: session.sessionManager.getLeafId() });
			}

			case "get_modified_files": {
				const fileSnapshotManager = session.fileSnapshotManager;
				if (!fileSnapshotManager) {
					return success(id, "get_modified_files", { files: [], resolvedFromEntryId: null });
				}

				if (command.fromEntryId || command.toEntryId || command.toTurnIndex || command.fromTurnIndex) {
					const files = fileSnapshotManager.getModifiedFiles({
						fromEntryId: command.fromEntryId,
						toEntryId: command.toEntryId,
						toTurnIndex: command.toTurnIndex,
						fromTurnIndex: command.fromTurnIndex,
					});
					return success(id, "get_modified_files", {
						files,
						resolvedFromEntryId: command.fromEntryId ?? null,
					});
				}

				if (command.toUserMsgEntryId) {
					const entries = session.sessionManager.getEntries();
					const files = fileSnapshotManager.getRollbackPreviewFiles({
						targetEntryId: command.toUserMsgEntryId,
						entries,
					});
					const resolvedSnapshotEntryId = fileSnapshotManager.resolveSnapshotEntryIdForTarget(
						command.toUserMsgEntryId,
						entries,
					);
					return success(id, "get_modified_files", {
						files,
						resolvedFromEntryId: resolvedSnapshotEntryId ?? command.toUserMsgEntryId,
					});
				}

				const files = fileSnapshotManager.getModifiedFiles();
				return success(id, "get_modified_files", { files, resolvedFromEntryId: null });
			}

			case "get_file_diff": {
				const fileSnapshotManager = session.fileSnapshotManager;
				if (!fileSnapshotManager) {
					return success(id, "get_file_diff", null);
				}

				const diff = fileSnapshotManager.getFileDiff({
					filePath: command.filePath,
					fromEntryId: command.fromEntryId,
					toEntryId: command.toEntryId,
					useBaselineHash: command.useBaselineHash ?? false,
				});

				return success(
					id,
					"get_file_diff",
					diff
						? {
								path: diff.path,
								oldContent: diff.oldContent,
								newContent: diff.newContent,
								unifiedDiff: diff.unifiedDiff,
							}
						: null,
				);
			}

			case "get_batch_diffs": {
				const fileSnapshotManager = session.fileSnapshotManager;
				if (!fileSnapshotManager) {
					return success(id, "get_batch_diffs", {
						files: [],
						summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
					});
				}
				return success(
					id,
					"get_batch_diffs",
					fileSnapshotManager.getBatchDiffs({
						fromEntryId: command.fromEntryId,
						toEntryId: command.toEntryId,
					}),
				);
			}

			case "get_file_history": {
				const fileSnapshotManager = session.fileSnapshotManager;
				if (!fileSnapshotManager) {
					return success(id, "get_file_history", { history: [] });
				}
				return success(id, "get_file_history", {
					history: fileSnapshotManager.getFileHistory({ filePath: command.filePath }),
				});
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				for (const command of session.extensionRunner.getRegisteredCommands()) {
					commands.push({
						name: command.invocationName,
						description: command.description,
						source: "extension",
						sourceInfo: command.sourceInfo,
					});
				}

				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						sourceInfo: template.sourceInfo,
					});
				}

				for (const skill of session.resourceLoader.getSkills().skills) {
					commands.push({
						name: `skill:${skill.name}`,
						description: skill.description,
						source: "skill",
						sourceInfo: skill.sourceInfo,
					});
				}

				return success(id, "get_commands", { commands });
			}

			// =================================================================
			// Resources (skills, extensions, tools)
			// =================================================================

			case "get_skills": {
				const { skills } = session.resourceLoader.getSkills();
				const rpcSkills: RpcSkill[] = skills.map((skill) => ({
					name: skill.name,
					description: skill.description,
					filePath: skill.filePath,
					baseDir: skill.baseDir,
					sourceInfo: skill.sourceInfo,
					disableModelInvocation: skill.disableModelInvocation,
				}));
				return success(id, "get_skills", { skills: rpcSkills });
			}

			case "get_extensions": {
				const { extensions } = session.resourceLoader.getExtensions();
				const rpcExtensions: RpcExtension[] = extensions.map((extension) => ({
					path: extension.path,
					resolvedPath: extension.resolvedPath,
					sourceInfo: extension.sourceInfo,
					toolNames: Array.from(extension.tools.keys()),
					commandNames: Array.from(extension.commands.keys()),
				}));
				return success(id, "get_extensions", { extensions: rpcExtensions });
			}

			case "get_tools": {
				const tools: RpcTool[] = session.extensionRunner.getAllRegisteredTools().map((tool) => ({
					name: tool.definition.name,
					label: tool.definition.label,
					description: tool.definition.description,
					sourceInfo: tool.sourceInfo,
				}));
				return success(id, "get_tools", { tools });
			}

			// =================================================================
			// Settings
			// =================================================================

			case "get_settings": {
				const settings =
					command.scope === "project"
						? session.settingsManager.getProjectSettings()
						: session.settingsManager.getGlobalSettings();
				return success(id, "get_settings", settings);
			}

			case "set_settings": {
				session.settingsManager.applyOverrides(command.settings, command.scope ?? "global");
				return success(id, "set_settings");
			}

			// =================================================================
			// Context, tools, queue, flags
			// =================================================================

			case "get_context_usage": {
				const usage = session.getContextUsage();
				const data: RpcContextUsage = usage ?? {
					tokens: null,
					contextWindow: session.model?.contextWindow ?? 0,
					percent: null,
				};
				return success(id, "get_context_usage", data);
			}

			case "get_system_prompt": {
				const systemPrompt = session.agent.state.systemPrompt || session.systemPrompt || "";
				const appendSystemPrompt = session.resourceLoader.getAppendSystemPrompt();
				return success(id, "get_system_prompt", { systemPrompt, appendSystemPrompt });
			}

			case "get_active_tools": {
				return success(id, "get_active_tools", { toolNames: session.getActiveToolNames() });
			}

			case "set_active_tools": {
				session.setActiveToolsByName(command.toolNames);
				return success(id, "set_active_tools");
			}

			case "get_queue": {
				return success(id, "get_queue", {
					steering: [...session.getSteeringMessages()],
					followUp: [...session.getFollowUpMessages()],
				});
			}

			case "clear_queue": {
				return success(id, "clear_queue", session.clearQueue());
			}

			case "get_flags": {
				const flags: RpcExtensionFlag[] = Array.from(session.extensionRunner.getFlags().entries()).map(
					([name, flag]) => ({
						name,
						description: flag.description,
						type: flag.type,
						default: flag.default,
						extensionPath: flag.extensionPath,
					}),
				);
				return success(id, "get_flags", { flags });
			}

			case "get_flag_values": {
				const values: Record<string, boolean | string> = {};
				for (const [name, value] of session.extensionRunner.getFlagValues()) {
					values[name] = value;
				}
				return success(id, "get_flag_values", { values });
			}

			case "set_flag": {
				session.extensionRunner.setFlagValue(command.name, command.value);
				return success(id, "set_flag");
			}

			case "reload": {
				await session.reload();
				await rebindSession();
				return success(id, "reload");
			}

			case "set_cwd": {
				const result = await runtimeHost.setCwd(command.cwd);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "set_cwd", result);
			}

			case "get_agents_files": {
				const result = session.resourceLoader.getAgentsFiles();
				return success(id, "get_agents_files", { agentsFiles: result.agentsFiles });
			}

			// =================================================================
			// Agent switching
			// =================================================================

			case "get_agents": {
				const discovery = discoverAgents(runtimeHost.cwd, "both");
				const agents: RpcAgentSummary[] = discovery.agents.map((agent) => ({
					name: agent.name,
					description: agent.description,
					tier: agent.tier,
					tools: agent.tools,
					disallowedTools: agent.disallowedTools,
					permissionMode: agent.permissionMode,
					source: agent.source,
					filePath: agent.filePath,
				}));
				return success(id, "get_agents", { agents });
			}

			case "switch_agent": {
				const discovery = discoverAgents(runtimeHost.cwd, "both");
				const agent = discovery.agents.find((candidate) => candidate.name === command.agentName);
				if (!agent) {
					return error(id, "switch_agent", `Agent "${command.agentName}" not found`);
				}
				session.applyAgentConfig(agent);
				return success(id, "switch_agent", {
					agentName: agent.name,
					tools: session.getActiveToolNames(),
					tier: agent.tier,
					thinkingLevel: agent.thinkingLevel,
				});
			}

			case "get_current_agent": {
				return success(id, "get_current_agent", { agentName: session.getCurrentAgent() });
			}

			case "get_latest_agent_change": {
				const entries = session.sessionManager.getEntries();
				for (let index = entries.length - 1; index >= 0; index--) {
					const entry = entries[index];
					if (entry.type === "agent_change") {
						return success(id, "get_latest_agent_change", {
							agentName: entry.agentName,
							agentConfig: entry.agentConfig,
							timestamp: entry.timestamp,
						});
					}
				}
				return success(id, "get_latest_agent_change", null);
			}

			case "get_agent_detail": {
				const discovery = discoverAgents(runtimeHost.cwd, "both");
				const agent = discovery.agents.find((candidate) => candidate.name === command.agentName);
				if (!agent) {
					return error(id, "get_agent_detail", `Agent "${command.agentName}" not found`);
				}
				return success(id, "get_agent_detail", { agent });
			}

			case "get_all_tools": {
				const tools: RpcAllTool[] = session.getAllTools().map((tool) => ({
					name: tool.name,
					description: tool.description,
					sourceInfo: tool.sourceInfo,
				}));
				return success(id, "get_all_tools", { tools });
			}

			case "set_permission_mode": {
				if (!isPermissionMode(command.mode)) {
					return error(
						id,
						"set_permission_mode",
						`Invalid permission mode: "${command.mode}". Valid modes: ${PERMISSION_MODES.join(", ")}`,
					);
				}
				session.setPermissionMode(command.mode);
				return success(id, "set_permission_mode", { mode: command.mode });
			}

			default: {
				const unknownCommand = command as { type: string };
				return error(undefined, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 * Called after handling each command when waiting for the next command.
	 */
	let detachInput = () => {};

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		unsubscribe?.();
		unsubscribeBackpressure?.();
		await runtimeHost.dispose();
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	async function checkShutdownRequested(): Promise<void> {
		if (!shutdownRequested) return;
		await shutdown();
	}

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output(
				error(
					undefined,
					"parse",
					`Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
				),
			);
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "extension_ui_response"
		) {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) {
				pendingExtensionRequests.delete(response.id);
				pending.resolve(response);
			}
			return;
		}

		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "channel_data" &&
			"name" in parsed
		) {
			channelManager.handleInbound(parsed as ChannelDataMessage);
			return;
		}

		const command = parsed as RpcCommand;
		try {
			const response = await handleCommand(command);
			if (response) {
				output(response);
				await waitForRawStdoutBackpressure();
			}
			await checkShutdownRequested();
		} catch (commandError: unknown) {
			output(
				error(
					command.id,
					command.type,
					commandError instanceof Error ? commandError.message : String(commandError),
				),
			);
			await waitForRawStdoutBackpressure();
		}
	};

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
			void handleInputLine(line);
		});
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	// Keep process alive forever
	return new Promise(() => {});
}
