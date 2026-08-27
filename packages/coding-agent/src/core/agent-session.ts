/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Agent, AgentEvent, AgentMessage, AgentState, AgentTool, ThinkingLevel } from "@dyyz1993/pi-agent-core";
import { Agent as CoreAgent } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, Context, ImageContent, Message, Model, TextContent, Usage } from "@dyyz1993/pi-ai";
import {
	clampThinkingLevel,
	cleanupSessionResources,
	getSupportedThinkingLevels,
	isContextOverflow,
	modelsAreEqual,
	resetApiProviders,
	streamSimple,
} from "@dyyz1993/pi-ai";
import { getAgentDir } from "../config.ts";
import { theme } from "../modes/interactive/theme/theme.ts";
import { stripFrontmatter } from "../utils/frontmatter.ts";
import { resolvePath } from "../utils/paths.ts";
import { sleep } from "../utils/sleep.ts";
import { asRecord, getPathArg, type UnknownRecord } from "../utils/type-helpers.ts";
import { type AgentConfig, discoverAgents, type PathConfig } from "./agent-types.ts";
import { askPermission } from "./ask-permission.ts";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.ts";
import { type BashResult, executeBashWithOperations } from "./bash-executor.ts";
import {
	type CompactionResult,
	calculateContextTokens,
	calculateInputContextTokens,
	collectEntriesForBranchSummary,
	compact,
	computeFileLists,
	estimateContextTokens,
	estimateTokens,
	formatFileOperations,
	generateBranchSummary,
	prepareCompaction,
	shouldCompact,
} from "./compaction/index.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import { exportSessionToHtml, type ToolHtmlRenderer } from "./export-html/index.ts";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.ts";
import type { Channel } from "./extensions/channel-types.ts";
import {
	type CallLLMOptions,
	type ContextUsage,
	type ContextUsageBreakdownItem,
	type ExtensionCommandContextActions,
	type ExtensionErrorListener,
	type ExtensionMode,
	ExtensionRunner,
	type ExtensionUIContext,
	type InputSource,
	type MessageEndEvent,
	type MessageStartEvent,
	type MessageUpdateEvent,
	type ProviderRequestContextUsage,
	type ReplacedSessionContext,
	type SessionBeforeCompactResult,
	type SessionBeforeTreeResult,
	type SessionStartEvent,
	type ShutdownHandler,
	type ToolDefinition,
	type ToolExecutionEndEvent,
	type ToolExecutionStartEvent,
	type ToolExecutionUpdateEvent,
	type ToolInfo,
	type TreePreparation,
	type TurnEndEvent,
	type TurnStartEvent,
	wrapRegisteredTools,
} from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";
import { FileSnapshotManager } from "./file-store/file-snapshot-manager.ts";
import { InternalGit } from "./file-store/internal-git.ts";
import { handleLargeInput } from "./large-input.ts";
import { type McpConnection, McpManager } from "./mcp/index.ts";
import { createMcpToolDefinition } from "./mcp/tool-converter.ts";
import type { McpServerConfig } from "./mcp/types.ts";
import type { BashExecutionMessage, CustomMessage } from "./messages.ts";
import type { ModelRegistry } from "./model-registry.ts";
import type { PathMetadata } from "./package-manager.ts";
import {
	createAutoApproverProvider,
	createDangerousCommandProvider,
	createPathAccessProvider,
	createPiHooksProvider,
	createReadonlyProvider,
	createStoredDecisionProvider,
	createToolGateProvider,
	getPermissionProfile,
	isPermissionProfileInput,
	type LegacyPermissionProfileName,
	matchPathGlob,
	normalizePermissionProfile,
	type PermissionContext,
	type PermissionDecision,
	type PermissionProfile,
	type PermissionProfileName,
	type PermissionProvider,
	type PermissionProviderId,
	type PermissionRequest,
	PermissionRuntime,
	PermissionStore,
} from "./permissions/index.ts";
import { expandPromptTemplate, type PromptTemplate } from "./prompt-templates.ts";
import type { ResourceExtensionPaths, ResourceLoader } from "./resource-loader.ts";
import { clearSessionHooks, clearSessionHooksBySource, registerSessionHooks } from "./session-hooks.ts";
import type { BranchSummaryEntry, CompactionEntry, CustomEntry, SessionManager } from "./session-manager.ts";
import { CURRENT_SESSION_VERSION, getLatestCompactionEntry, type SessionHeader } from "./session-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";
import type { Skill } from "./skills.ts";
import type { SlashCommandInfo } from "./slash-commands.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";
import {
	getCwdDataDir,
	getGlobalDataDir,
	getProjectDataDir,
	getSessionDataDir,
	resolveProjectIdentity,
} from "./storage.ts";
import type { SubtaskContext } from "./subtask.ts";
import {
	type BuildSystemPromptOptions,
	buildSystemPromptWithBreakdown,
	type SystemPromptBreakdown,
} from "./system-prompt.ts";
import { normalizeTierModelsForAvailableModels } from "./tier-models.ts";
import {
	estimateContentTokens,
	estimateContentTokensFromChars,
	identifyProvider,
	estimateCharsAsTokens as tokenizerEstimateCharsAsTokens,
} from "./tokenizer/index.ts";
import {
	checkToolEnd,
	createLoopDetectionState,
	type LoopDetectionResult,
	type LoopDetectionState,
	recordToolStart,
	resetLoopDetection,
} from "./tool-loop-detector.ts";
import { type BashOperations, createLocalBashOperations } from "./tools/bash.ts";
import {
	createAllToolDefinitions,
	createSkillToolDefinition,
	createTool,
	type ToolName,
	type ToolOperationsProvider,
	toolsOptionsFromProvider,
} from "./tools/index.ts";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.ts";

// ============================================================================
// Skill Block Parsing
// ============================================================================

const EMPTY_CALL_LLM_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function textFromAssistantMessage(message: AssistantMessage): string {
	return message.content
		.filter((content): content is TextContent => content.type === "text")
		.map((content) => content.text)
		.join("\n");
}

function toCallLlmMessages(messages: CallLLMOptions["messages"], model: Model<any>): Message[] {
	return messages.map((message) => {
		const content: TextContent[] = [{ type: "text", text: message.content }];
		if (message.role === "user") {
			return {
				role: "user",
				content,
				timestamp: Date.now(),
			};
		}
		return {
			role: "assistant",
			content,
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: EMPTY_CALL_LLM_USAGE,
			stopReason: "stop",
			timestamp: Date.now(),
		};
	});
}

/** Parsed skill block from a user message */
export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage: string | undefined;
}

/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
	const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
	if (!match) return null;
	return {
		name: match[1],
		location: match[2],
		content: match[3],
		userMessage: match[4]?.trim() || undefined,
	};
}

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| Exclude<AgentEvent, { type: "agent_end" | "message_end" }>
	| (Extract<AgentEvent, { type: "message_end" }> & { entryId?: string })
	| {
			type: "agent_end";
			messages: AgentMessage[];
			willRetry: boolean;
	  }
	| {
			type: "queue_update";
			steering: readonly string[];
			followUp: readonly string[];
	  }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| { type: "session_info_changed"; name: string | undefined }
	| { type: "thinking_level_changed"; level: ThinkingLevel }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "auto_continue"; reason: string; iteration: number }
	| { type: "custom_entry"; customType: string; data?: unknown; id: string };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	cwd: string;
	/** Models to cycle through with Ctrl+P (from --models flag) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
	/** Resource loader for skills, prompts, themes, context files, system prompt */
	resourceLoader: ResourceLoader;
	/** SDK custom tools registered outside extensions */
	customTools?: ToolDefinition[];
	/** Model registry for API key resolution and model discovery */
	modelRegistry: ModelRegistry;
	/** Initial active built-in tool names. Default: [read, bash, edit, write] */
	initialActiveToolNames?: string[];
	/** Optional allowlist of tool names. When provided, only these tool names are exposed. */
	allowedToolNames?: string[];
	/** Optional denylist of tool names. When provided, these tool names are not exposed. */
	excludedToolNames?: string[];
	/**
	 * Override base tools (useful for custom runtimes).
	 *
	 * These are synthesized into minimal ToolDefinitions internally so AgentSession can keep
	 * a definition-first registry even when callers provide plain AgentTool instances.
	 */
	baseToolsOverride?: Record<string, AgentTool>;
	/** Mutable ref used by Agent to access the current ExtensionRunner */
	extensionRunnerRef?: { current?: ExtensionRunner };
	/** Session start event metadata emitted when extensions bind to this runtime. */
	sessionStartEvent?: SessionStartEvent;
	/** Optional operation overrides for built-in tools. */
	toolOperationsProvider?: ToolOperationsProvider;
	/** Maximum number of agent turns before stopping. */
	maxTurns?: number;
}

export interface ExtensionBindings {
	uiContext?: ExtensionUIContext;
	mode?: ExtensionMode;
	commandContextActions?: ExtensionCommandContextActions;
	abortHandler?: () => void;
	shutdownHandler?: ShutdownHandler;
	onError?: ExtensionErrorListener;
	registerChannel?: (name: string) => Channel;
	/**
	 * Same-cwd session switch: adopt this manager instead of reconnecting
	 * all MCP servers. The previous session must hand over ownership (it no
	 * longer disposes it).
	 */
	mcpManagerFrom?: AgentSession;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
	/** Whether to expand file-based prompt templates (default: true) */
	expandPromptTemplates?: boolean;
	/** Image attachments */
	images?: ImageContent[];
	/** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). Required if streaming. */
	streamingBehavior?: "steer" | "followUp";
	/** Source of input for extension input event handlers. Defaults to "interactive". */
	source?: InputSource;
	/** Internal hook used by RPC mode to observe prompt preflight acceptance or rejection. */
	preflightResult?: (success: boolean) => void;
}

/** Result from cycleModel() */
export interface ModelCycleResult {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	/** Whether cycling through scoped models (--models flag) or all available */
	isScoped: boolean;
}

/** Session statistics for /session command */
export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: ContextUsage;
}

export type PermissionMode = PermissionProfileName;
/** @deprecated Use "normal" or "yolo" */
export type LegacyPermissionMode = LegacyPermissionProfileName;

export type QueueItemRef = { type: "steering" | "followUp"; index: number; text: string };
export type FollowUpQueueItemRef = { type: "followUp"; index: number; text: string };

type QueuedUserMessage = {
	text: string;
	images?: ImageContent[];
};

function normalizePermissionMode(mode: string): PermissionMode {
	return normalizePermissionProfile(mode);
}

interface ToolDefinitionEntry {
	definition: ToolDefinition;
	sourceInfo: SourceInfo;
}

// ============================================================================
// Constants
// ============================================================================

/** Standard thinking levels */
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

function isThinkingLevel(level: string): level is ThinkingLevel {
	return (THINKING_LEVELS as readonly string[]).includes(level);
}

function isPermissionMode(mode: string): mode is PermissionMode | LegacyPermissionMode {
	return isPermissionProfileInput(mode);
}

function buildAgentSystemPrompt(agent: AgentConfig): string | undefined {
	const sections: string[] = [];
	if (agent.paths) {
		const pathLines = ["## Path Guidance", "", "This agent is configured with path-level guidance:"];
		if (agent.paths.write && agent.paths.write.length > 0) {
			pathLines.push(`- Write paths: ${agent.paths.write.join(", ")}`);
		}
		if (agent.paths.read && agent.paths.read.length > 0) {
			pathLines.push(`- Read paths: ${agent.paths.read.join(", ")}`);
		}
		if (agent.paths.bash && agent.paths.bash.length > 0) {
			pathLines.push(`- Bash paths: ${agent.paths.bash.join(", ")}`);
		}
		sections.push(pathLines.join("\n"));
	}
	if (agent.effort) {
		sections.push(`## Effort Level\n\n${agent.effort}`);
	}
	if (agent.systemPrompt.trim()) {
		sections.push(agent.systemPrompt.trim());
	}
	return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function normalizeAgentPath(filePath: string): string {
	let normalized = filePath.startsWith("file://") ? filePath.slice("file://".length) : filePath;
	normalized = normalized.replace(/\\/g, "/");
	const parts = normalized.split("/");
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === "..") {
			if (resolved.length > 0 && resolved[resolved.length - 1] !== "") {
				resolved.pop();
			}
		} else if (part !== "." && part !== "") {
			resolved.push(part);
		} else if (part === "" && resolved.length === 0) {
			resolved.push("");
		}
	}
	if (normalized.startsWith("/")) {
		return `/${resolved.filter((part) => part !== "").join("/")}`;
	}
	return resolved.join("/") || ".";
}

/** Resolve a path (relative or absolute) against cwd, returning an absolute path. */
function resolvePathAgainstCwd(filePath: string, cwd: string): string {
	if (filePath.startsWith("/")) return filePath;
	// Relative path — join with cwd
	const parts = [
		...cwd.split("/").filter((p) => p !== ""),
		...filePath.split("/").filter((p) => p !== "." && p !== ""),
	];
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === "..") {
			if (resolved.length > 0) resolved.pop();
		} else {
			resolved.push(part);
		}
	}
	return `/${resolved.join("/")}`;
}

function estimateCharsAsTokens(chars: number): number {
	return Math.ceil(Math.max(chars, 0) / 4);
}

function textAndImageContentToText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter(
			(block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

function getMessageText(message: AgentMessage): string {
	switch (message.role) {
		case "user":
		case "custom":
		case "toolResult":
			return textAndImageContentToText(message.content);
		case "assistant":
			return message.content
				.map((block) => {
					if (block.type === "text") return block.text;
					if (block.type === "thinking") return block.thinking;
					if (block.type === "toolCall") return `${block.name} ${JSON.stringify(block.arguments)}`;
					return "";
				})
				.filter((text) => text.length > 0)
				.join("\n");
		case "bashExecution":
			return `${message.command}\n${message.output}`;
		case "branchSummary":
		case "compactionSummary":
			return message.summary;
	}
}

function isDisplayableSessionMessage(message: AgentMessage): boolean {
	return message.role !== "custom" || message.customType !== "system_event" || message.display !== false;
}

function classifyContextMessage(message: AgentMessage): "conversation" | "memory" | "rules" | "lsp" {
	const text = getMessageText(message);
	if (message.role === "custom") {
		if (message.customType === "lsp_diagnostics") return "lsp";
		if (message.customType === "memory_relevant") return "memory";
		if (message.customType === "rules-engine") return "rules";
	}
	if ((message.role === "user" || message.role === "custom") && text.includes("<memory_context")) return "memory";
	if ((message.role === "user" || message.role === "custom") && text.includes("<system-reminder")) return "rules";
	return "conversation";
}

function estimateAssistantMessageParts(
	message: AssistantMessage,
	model?: { provider?: string; id?: string } | null,
): {
	conversation: number;
	thinking: number;
	toolInputs: number;
} {
	let conversationChars = 0;
	let thinkingChars = 0;
	let toolInputChars = 0;
	const provider = identifyProvider(model);

	for (const block of message.content) {
		if (block.type === "thinking") {
			thinkingChars += block.thinking.length;
			thinkingChars += (block.thinkingSignature ?? "").length;
		} else if (block.type === "text") {
			conversationChars += block.text.length;
		} else if (block.type === "toolCall") {
			toolInputChars += block.name.length + JSON.stringify(block.arguments).length;
			// OpenAI tool_call format serialization overhead (measured):
			// {"id":"...","type":"function","function":{"name":"...","arguments":"..."}}
			// = ~65 chars of structure, plus the id content (NOT counted above)
			// Structure uses chars/4 (same as provider side), content uses provider factor
			toolInputChars += (block.id ?? "").length + 65;
		}
	}

	// Content tokens use provider-specific factor (accurate for Chinese/code mix)
	// Structure tokens use chars/4 (matches provider snapshot measurement)

	// Compute per-message JSON structure overhead based on actual content blocks.
	// Measured overhead for each element (OpenAI completions format):
	//   text content:  33 chars — {"role":"assistant","content":""}
	//   null content:  35 chars — {"role":"assistant","content":null}
	//   reasoning:     23 chars — ,"reasoning_content":""
	//   tool_calls:    16 chars — ,"tool_calls":[]
	const hasTextContent = message.content.some((b) => b.type === "text" && (b.text?.length ?? 0) > 0);
	const hasThinking = message.content.some((b) => b.type === "thinking");
	const hasToolCalls = message.content.some((b) => b.type === "toolCall");

	// Base envelope (structure → chars/4)
	conversationChars += hasTextContent ? 33 : 35;

	// reasoning_content field wrapper (structure → chars/4)
	if (hasThinking) conversationChars += 23;

	// tool_calls array wrapper (structure → chars/4)
	if (hasToolCalls) conversationChars += 16;

	return {
		conversation: estimateContentTokensFromChars(conversationChars, provider),
		thinking: estimateContentTokensFromChars(thinkingChars, provider),
		toolInputs: estimateContentTokensFromChars(toolInputChars, provider),
	};
}

function providerSectionTokens(
	providerRequest: ProviderRequestContextUsage | undefined,
	id: "system" | "messages" | "tools" | "options",
): number {
	return providerRequest?.sections.find((section) => section.id === id)?.tokens ?? 0;
}

function positiveDeltaTokens(actual: number, accounted: number): number {
	return Math.max(0, Math.round(actual) - Math.round(accounted));
}

function providerToolInteractionTokens(
	providerRequest: ProviderRequestContextUsage | undefined,
	kind: "input" | "output",
): number {
	return (providerRequest?.toolInteractions ?? []).reduce(
		(sum, tool) => sum + (kind === "input" ? tool.inputTokens : tool.outputTokens),
		0,
	);
}

function getLastAssistantUsage(messages: AgentMessage[]): Usage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "assistant") return message.usage;
	}
	return undefined;
}

// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;

	private _scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;

	// Event subscription state
	private _unsubscribeAgent?: () => void;
	private _eventListeners: AgentSessionEventListener[] = [];

	/** Tracks pending steering messages for UI display. Removed when delivered. */
	private _steeringMessages: string[] = [];
	private _steeringQueueEntries: QueuedUserMessage[] = [];
	/** Tracks pending follow-up messages for UI display. Removed when delivered. */
	private _followUpMessages: string[] = [];
	private _followUpQueueEntries: QueuedUserMessage[] = [];
	/** Messages queued to be included with the next user prompt as context ("asides"). */
	private _pendingNextTurnMessages: CustomMessage[] = [];

	// Compaction state
	private _compactionAbortController: AbortController | undefined = undefined;
	private _autoCompactionAbortController: AbortController | undefined = undefined;
	private _overflowRecoveryAttempts = 0;
	private _skipNextThresholdCheck = false;
	private _consecutiveAutoCompactFailures = 0;

	private static readonly MAX_CONSECUTIVE_AUTO_COMPACT_FAILURES = 3;
	private static readonly MAX_COMPACT_STREAMING_RETRIES = 2;
	private static readonly MAX_OVERFLOW_RECOVERY_ROUNDS = 5;
	/** Safety limit: max post-agent-run iterations before forcing the loop to stop. */
	private static readonly MAX_POST_RUN_ITERATIONS = 10;

	// Branch summarization state
	private _branchSummaryAbortController: AbortController | undefined = undefined;

	// Retry state
	private _retryAbortController: AbortController | undefined = undefined;
	private _retryAttempt = 0;

	// Bash execution state
	private _bashAbortController: AbortController | undefined = undefined;
	private _pendingBashMessages: BashExecutionMessage[] = [];

	/** Set to true when abort() is called, checked by _handlePostAgentRun to break loops. */
	private _aborted = false;

	// Tool-loop detection state
	// Persists across compaction (in-memory, not in message stream) so loops
	// are detected even after contextFold erases the message history.
	private _loopState: LoopDetectionState = createLoopDetectionState();
	private _loopAbortInProgress = false;

	// Extension system
	private _extensionRunner!: ExtensionRunner;
	private _turnIndex = 0;
	private _maxTurns: number | undefined;
	private _activeSkillNames: Set<string> | undefined;

	private _resourceLoader: ResourceLoader;
	private _customTools: ToolDefinition[];
	private _baseToolDefinitions: Map<string, ToolDefinition> = new Map();
	private _cwd: string;
	private _extensionRunnerRef?: { current?: ExtensionRunner };
	private _initialActiveToolNames?: string[];
	private _allowedToolNames?: Set<string>;
	private _excludedToolNames?: Set<string>;
	private _baseToolsOverride?: Record<string, AgentTool>;
	private _toolOperationsProvider?: ToolOperationsProvider;
	private _sessionStartEvent: SessionStartEvent;
	private _extensionUIContext?: ExtensionUIContext;
	private _extensionMode: ExtensionMode = "print";
	private _extensionCommandContextActions?: ExtensionCommandContextActions;
	private _extensionAbortHandler?: () => void;
	private _extensionShutdownHandler?: ShutdownHandler;
	private _extensionErrorListener?: ExtensionErrorListener;
	private _extensionErrorUnsubscriber?: () => void;
	private _registerChannel?: (name: string) => Channel;

	// Model registry for API key resolution
	private _modelRegistry: ModelRegistry;
	private _tierModels: Record<string, string>;
	private _fileSnapshotManager: FileSnapshotManager | null = null;

	// Tool registry for extension getTools/setTools
	private _toolRegistry: Map<string, AgentTool> = new Map();
	private _toolDefinitions: Map<string, ToolDefinitionEntry> = new Map();
	private _toolPromptSnippets: Map<string, string> = new Map();
	private _toolPromptGuidelines: Map<string, string[]> = new Map();
	private _permissionMode: PermissionMode = "normal";
	private _mcpManager: McpManager | undefined;
	private _mcpToolNames: Set<string> = new Set();
	private _currentAgentName = "build";
	private _agentSystemPromptOverride: string | undefined;
	private _currentAgentPaths: PathConfig | undefined;
	private _currentAgentTools: string[] | undefined;
	private _currentAgentDisallowedTools: string[] | undefined;
	private _activeAgentHookSource: string | undefined;

	// Base system prompt (without extension appends) - used to apply fresh appends each turn
	private _baseSystemPrompt = "";
	private _baseSystemPromptOptions!: BuildSystemPromptOptions;
	private _baseSystemPromptBreakdown: SystemPromptBreakdown = {
		systemBaseChars: 0,
		toolsChars: 0,
		contextFilesChars: 0,
		skillsChars: 0,
		agentsChars: 0,
	};

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settingsManager = config.settingsManager;
		this._tierModels = this.settingsManager.getTierModels();
		this._scopedModels = config.scopedModels ?? [];
		this._resourceLoader = config.resourceLoader;
		this._customTools = config.customTools ?? [];
		this._cwd = config.cwd;
		this._modelRegistry = config.modelRegistry;
		this._extensionRunnerRef = config.extensionRunnerRef;
		this._initialActiveToolNames = config.initialActiveToolNames;
		this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
		this._excludedToolNames = config.excludedToolNames ? new Set(config.excludedToolNames) : undefined;
		this._baseToolsOverride = config.baseToolsOverride;
		this._toolOperationsProvider = config.toolOperationsProvider;
		this._sessionStartEvent = config.sessionStartEvent ?? { type: "session_start", reason: "startup" };
		this._maxTurns = config.maxTurns !== undefined && config.maxTurns > 0 ? config.maxTurns : undefined;

		// Always subscribe to agent events for internal handling
		// (session persistence, extensions, auto-compaction, retry logic)
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
		this._installAgentToolHooks();

		this._buildRuntime({
			activeToolNames: this._initialActiveToolNames,
			includeAllExtensionTools: true,
		});
	}

	/** Model registry for API key resolution and model discovery */
	get modelRegistry(): ModelRegistry {
		return this._modelRegistry;
	}

	get fileSnapshotManager(): FileSnapshotManager | null {
		return this._fileSnapshotManager;
	}

	set toolOperationsProvider(provider: ToolOperationsProvider | undefined) {
		this._toolOperationsProvider = provider;
		if (provider?.fs) {
			void this._fileSnapshotManager?.reinitializeWorkspaceAsync(this._cwd);
		}
		this._baseToolDefinitions = new Map(
			Object.entries(this._createBaseToolDefinitions()).map(([name, tool]) => [name, tool as ToolDefinition]),
		);
		this._refreshToolRegistry();
	}

	get toolOperationsProvider(): ToolOperationsProvider | undefined {
		return this._toolOperationsProvider;
	}

	private async _getRequiredRequestAuth(model: Model<any>): Promise<{
		apiKey: string;
		headers?: Record<string, string>;
	}> {
		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		if (!result.ok) {
			if (result.error.startsWith("No API key found")) {
				throw new Error(formatNoApiKeyFoundMessage(model.provider));
			}
			throw new Error(result.error);
		}
		if (result.apiKey) {
			return { apiKey: result.apiKey, headers: result.headers };
		}

		const isOAuth = this._modelRegistry.isUsingOAuth(model);
		if (isOAuth) {
			throw new Error(
				`Authentication failed for "${model.provider}". ` +
					`Credentials may have expired or network is unavailable. ` +
					`Run '/login ${model.provider}' to re-authenticate.`,
			);
		}
		throw new Error(formatNoApiKeyFoundMessage(model.provider));
	}

	private async _getCompactionRequestAuth(model: Model<any>): Promise<{
		apiKey?: string;
		headers?: Record<string, string>;
	}> {
		if (this.agent.streamFn === streamSimple) {
			return this._getRequiredRequestAuth(model);
		}

		const result = await this._modelRegistry.getApiKeyAndHeaders(model);
		return result.ok ? { apiKey: result.apiKey, headers: result.headers } : {};
	}

	/**
	 * Install tool hooks once on the Agent instance.
	 *
	 * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
	 * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
	 * registered tool execution to the extension context. Tool call and tool result interception now
	 * happens here instead of in wrappers.
	 */
	private async _evaluateToolPermission(
		toolName: string,
		toolCallId: string | undefined,
		args: unknown,
	): Promise<{ block: true; reason: string } | undefined> {
		const input = asRecord(args);
		const context = this._createPermissionContext(toolName, toolCallId, input);
		const profile = this._getPermissionProfile();

		const preDecision = await new PermissionRuntime({
			providers: this._createToolPermissionProviders(profile.preProviders),
			defaultDecision: { type: "pass" },
		}).evaluate(context);
		const preResult = await this._applyPermissionDecision(preDecision, input);
		if (preResult) return preResult;
		if (preDecision.type === "allow") return undefined;

		const postDecision = await new PermissionRuntime({
			providers: this._createToolPermissionProviders(profile.postProviders),
		}).evaluate({ ...context, input });
		return this._applyPermissionDecision(postDecision, input);
	}

	private _createPermissionContext(
		toolName: string,
		toolCallId: string | undefined,
		input: Record<string, unknown>,
	): PermissionContext {
		return {
			sessionId: this.sessionManager.getSessionId(),
			cwd: this._cwd,
			permissionProfile: this._permissionMode,
			toolName,
			toolCallId,
			input,
			agent: {
				name: this._currentAgentName,
				tools: this._currentAgentTools,
				disallowedTools: this._currentAgentDisallowedTools,
				paths: this._currentAgentPaths,
			},
		};
	}

	private _getPermissionProfile(): PermissionProfile {
		return getPermissionProfile(this._permissionMode);
	}

	private _createToolPermissionProviders(providerIds: PermissionProviderId[]): PermissionProvider[] {
		const providers: PermissionProvider[] = [];
		for (const [index, providerId] of providerIds.entries()) {
			const provider = this._createToolPermissionProvider(providerId, (index + 1) * 10);
			if (provider) providers.push(provider);
		}
		return providers;
	}

	private _createToolPermissionProvider(
		providerId: PermissionProviderId,
		priority: number,
	): PermissionProvider | undefined {
		switch (providerId) {
			case "tool-gate":
				return createToolGateProvider({ priority });
			case "readonly":
				return createReadonlyProvider({ priority });
			case "stored-decision":
				return createStoredDecisionProvider({
					priority,
					store: new PermissionStore(this.settingsManager),
				});
			case "auto-approver":
				return createAutoApproverProvider({ priority });
			case "pi-hooks": {
				const runner = this._extensionRunner;
				if (!runner.hasHandlers("tool_call")) return undefined;
				return createPiHooksProvider({
					priority,
					emitToolCall: (event) => runner.emitToolCall(event),
				});
			}
			case "path-access":
				return createPathAccessProvider({ priority });
			case "dangerous-command":
				return createDangerousCommandProvider({ priority, action: "ask" });
			case "file-time-guard":
				return undefined;
			default: {
				const provider = this._extensionRunner.getPermissionProvider(providerId);
				if (!provider) return undefined;
				return { ...provider, priority };
			}
		}
	}

	private async _applyPermissionDecision(
		decision: PermissionDecision,
		input: Record<string, unknown>,
	): Promise<{ block: true; reason: string } | undefined> {
		switch (decision.type) {
			case "deny":
				return { block: true, reason: decision.reason };
			case "ask":
				return this._applyPermissionDecision(await this._askPermission(decision.request, input), input);
			case "mutate":
				for (const key of Object.keys(input)) {
					delete input[key];
				}
				Object.assign(input, decision.input);
				return undefined;
			case "allow":
			case "pass":
				return undefined;
		}
	}

	private async _askPermission(
		request: PermissionRequest,
		input: Record<string, unknown>,
	): Promise<PermissionDecision> {
		const runner = this._extensionRunner;
		return askPermission({
			request,
			input,
			uiContext: runner.hasUI() ? runner.getUIContext() : null,
			emitPermissionRequest: runner.hasPermissionRequestHandlers()
				? (event) => runner.emitPermissionRequest(event)
				: undefined,
			store: new PermissionStore(this.settingsManager),
		});
	}

	private _installAgentToolHooks(): void {
		this.agent.beforeToolCall = async ({ toolCall, args }) => {
			const permissionResult = await this._evaluateToolPermission(toolCall.name, toolCall.id, args);
			if (permissionResult) return permissionResult;

			const boundaryResult = await this._checkPathBoundary(toolCall.name, toolCall.id, args);
			if (boundaryResult?.block) {
				return { block: true, reason: boundaryResult.reason };
			}
		};

		this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
			const runner = this._extensionRunner;
			if (!runner.hasHandlers("tool_result")) {
				return undefined;
			}

			const hookResult = await runner.emitToolResult({
				type: "tool_result",
				toolName: toolCall.name,
				toolCallId: toolCall.id,
				input: asRecord(args),
				content: result.content,
				details: result.details,
				isError,
			});

			if (!hookResult) {
				return undefined;
			}

			return {
				content: hookResult.content,
				details: hookResult.details,
				isError: hookResult.isError ?? isError,
			};
		};
	}

	private _initFileSnapshotManager(): void {
		try {
			const git = InternalGit.createForProject(join(getAgentDir(), "file-store"), this._cwd);
			const manager = new FileSnapshotManager(git, { workspaceFs: () => this.toolOperationsProvider?.fs });
			manager.rebuildIndex(this.sessionManager.getEntries(), this.sessionManager.getLeafId());
			manager.initialize(this._cwd);
			void git.enforceLimit(100 * 1024 * 1024, manager.getActiveTreeHashes()).catch((err: unknown) => {
				console.warn(
					"[initFileSnapshotManager] file store cleanup failed:",
					err instanceof Error ? err.message : String(err),
				);
			});
			this._fileSnapshotManager = manager;
		} catch (err) {
			console.warn(
				"[initFileSnapshotManager] failed, file snapshots disabled:",
				err instanceof Error ? err.message : String(err),
			);
			this._fileSnapshotManager = null;
		}
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	private _emit(event: AgentSessionEvent): void {
		for (const l of this._eventListeners) {
			l(event);
		}
	}

	private _emitQueueUpdate(): void {
		this._emit({
			type: "queue_update",
			steering: [...this._steeringMessages],
			followUp: [...this._followUpMessages],
		});
	}

	private _emitEntriesInvalidated(
		invalidatedEntryIds: string[],
		reason: "deletion" | "segment_summary",
		operationEntryId: string,
	): void {
		if (!this._extensionRunner || invalidatedEntryIds.length === 0) return;

		const invalidatedToolCallIds: string[] = [];
		for (const id of invalidatedEntryIds) {
			const entry = this.sessionManager.getEntry(id);
			if (entry?.type === "message" && entry.message.role === "toolResult") {
				invalidatedToolCallIds.push(entry.message.toolCallId);
			}
		}

		this._extensionRunner
			.emit({
				type: "entries_invalidated",
				invalidatedEntryIds,
				reason,
				operationEntryId,
				invalidatedToolCallIds,
			})
			.catch(() => {});
	}

	// Track last assistant message for auto-compaction check
	private _lastAssistantMessage: AssistantMessage | undefined = undefined;

	/** Internal handler for agent events - shared by subscribe and reconnect */
	private _handleAgentEvent = async (event: AgentEvent, signal: AbortSignal): Promise<void> => {
		// When a queued user/custom message starts, remove it BEFORE emitting.
		// This ensures the UI sees the updated queue state
		if (event.type === "message_start" && (event.message.role === "user" || event.message.role === "custom")) {
			if (event.message.role === "user") {
				this._overflowRecoveryAttempts = 0;
				resetLoopDetection(this._loopState);
			}
			const messageText = getMessageText(event.message);
			if (messageText) {
				// Check steering queue first
				const steeringIndex = this._steeringMessages.indexOf(messageText);
				if (steeringIndex !== -1) {
					this._steeringMessages.splice(steeringIndex, 1);
					this._steeringQueueEntries.splice(steeringIndex, 1);
					this._emitQueueUpdate();
				} else {
					// Check follow-up queue
					const followUpIndex = this._followUpMessages.indexOf(messageText);
					if (followUpIndex !== -1) {
						this._followUpMessages.splice(followUpIndex, 1);
						this._followUpQueueEntries.splice(followUpIndex, 1);
						this._emitQueueUpdate();
					}
				}
			}
		}

		// Emit to extensions first
		await this._emitExtensionEvent(event, signal);

		// Handle session persistence
		let persistedEntryId: string | undefined;
		if (event.type === "message_end") {
			// Check if this is a custom message from extensions
			if (event.message.role === "custom") {
				// Persist as CustomMessageEntry
				persistedEntryId = this.sessionManager.appendCustomMessageEntry(
					event.message.customType,
					event.message.content,
					event.message.display,
					event.message.details,
				);
			} else if (
				event.message.role === "user" ||
				event.message.role === "assistant" ||
				event.message.role === "toolResult"
			) {
				// Regular LLM message - persist as SessionMessageEntry
				persistedEntryId = this.sessionManager.appendMessage(event.message);
			}
			// Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere

			// Track assistant message for auto-compaction (checked on agent_end)
			if (event.message.role === "assistant") {
				this._lastAssistantMessage = event.message;

				const assistantMsg = event.message as AssistantMessage;
				if (assistantMsg.stopReason !== "error") {
					this._overflowRecoveryAttempts = 0;
				}

				// Reset retry counter immediately on successful assistant response
				// This prevents accumulation across multiple LLM calls within a turn
				if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
					this._emit({
						type: "auto_retry_end",
						success: true,
						attempt: this._retryAttempt,
					});
					this._retryAttempt = 0;
				}
			}
		}

		const publicEvent =
			event.type === "message_end" && persistedEntryId
				? { ...event, entryId: persistedEntryId }
				: event.type === "agent_end"
					? { ...event, willRetry: this._willRetryAfterAgentEnd(event) }
					: event;

		// Notify all listeners
		this._emit(publicEvent);
	};

	private _willRetryAfterAgentEnd(event: Extract<AgentEvent, { type: "agent_end" }>): boolean {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled || this._retryAttempt >= settings.maxRetries) {
			return false;
		}

		for (let i = event.messages.length - 1; i >= 0; i--) {
			const message = event.messages[i];
			if (message.role === "assistant") {
				return this._isRetryableError(message as AssistantMessage);
			}
		}
		return false;
	}

	/** Find the last assistant message in agent state (including aborted ones) */
	private _findLastAssistantMessage(): AssistantMessage | undefined {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				return msg as AssistantMessage;
			}
		}
		return undefined;
	}

	private _replaceMessageInPlace(target: AgentMessage, replacement: AgentMessage): void {
		// Agent-core stores the finalized message object in its state before emitting message_end.
		// SessionManager persistence happens later in _handleAgentEvent() with event.message.
		// Mutating this object in place keeps agent state, later turn/agent events, listeners,
		// and the eventual SessionManager.appendMessage(event.message) persistence in sync.
		if (target === replacement) {
			return;
		}

		const targetRecord = target as unknown as UnknownRecord;
		for (const key of Object.keys(targetRecord)) {
			delete targetRecord[key];
		}
		Object.assign(targetRecord, replacement);
	}

	/** Emit extension events based on agent events */
	private async _emitExtensionEvent(event: AgentEvent, signal?: AbortSignal): Promise<void> {
		if (event.type === "agent_start") {
			this._turnIndex = 0;
			await this._extensionRunner.emit({ type: "agent_start" });
		} else if (event.type === "agent_end") {
			await this._extensionRunner.emit({ type: "agent_end", messages: event.messages });
		} else if (event.type === "turn_start") {
			const extensionEvent: TurnStartEvent = {
				type: "turn_start",
				turnIndex: this._turnIndex,
				timestamp: Date.now(),
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "turn_end") {
			const extensionEvent: TurnEndEvent = {
				type: "turn_end",
				turnIndex: this._turnIndex,
				message: event.message,
				toolResults: event.toolResults,
			};
			await this._extensionRunner.emit(extensionEvent);
			try {
				await this._fileSnapshotManager?.onTurnEndAsync(
					this._cwd,
					this._turnIndex,
					(type, data) => this.sessionManager.appendCustomEntry(type, data),
					signal,
				);
			} catch (error) {
				if (!signal?.aborted) throw error;
			}
			this._turnIndex++;
			if (this._maxTurns !== undefined && this._turnIndex >= this._maxTurns) {
				this.agent.abort();
			}
		} else if (event.type === "message_start") {
			const extensionEvent: MessageStartEvent = {
				type: "message_start",
				message: event.message,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "message_update") {
			const extensionEvent: MessageUpdateEvent = {
				type: "message_update",
				message: event.message,
				assistantMessageEvent: event.assistantMessageEvent,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "message_end") {
			const extensionEvent: MessageEndEvent = {
				type: "message_end",
				message: event.message,
			};
			const replacement = await this._extensionRunner.emitMessageEnd(extensionEvent);
			if (replacement) {
				this._replaceMessageInPlace(event.message, replacement);
			}
		} else if (event.type === "tool_execution_start") {
			const extensionEvent: ToolExecutionStartEvent = {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				timestamp: event.timestamp,
			};
			await this._extensionRunner.emit(extensionEvent);

			// Cache args for loop detection (tool_execution_end doesn't carry args)
			recordToolStart(
				this._loopState,
				event.toolCallId,
				event.toolName,
				event.args as Record<string, unknown> | undefined,
			);
		} else if (event.type === "tool_execution_update") {
			const extensionEvent: ToolExecutionUpdateEvent = {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: event.partialResult,
			};
			await this._extensionRunner.emit(extensionEvent);
		} else if (event.type === "tool_execution_end") {
			const extensionEvent: ToolExecutionEndEvent = {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
				isError: event.isError,
				timestamp: event.timestamp,
				durationMs: event.durationMs,
			};
			await this._extensionRunner.emit(extensionEvent);

			// Check for tool-call loops (consecutive identical calls with errors)
			// Fire-and-forget: abort must happen after this handler returns to avoid
			// deadlocking with agent.waitForIdle() inside the event emission chain.
			void this._checkToolLoop(event.toolCallId, event.toolName, event.isError);
		}
	}

	/**
	 * Check for tool-call loops after each tool_execution_end.
	 * If a loop is detected (consecutive identical calls with errors),
	 * aborts the current run and injects a corrective message.
	 */
	private async _checkToolLoop(toolCallId: string, toolName: string, isError: boolean): Promise<void> {
		const result: LoopDetectionResult | undefined = checkToolEnd(this._loopState, toolCallId, toolName, isError);
		if (!result || !result.detected) return;
		if (this._loopAbortInProgress) return; // Prevent re-entrant aborts

		this._loopAbortInProgress = true;
		try {
			// Abort the current agent run
			await this.abort();

			// Inject corrective message that triggers a new turn
			await this.sendCustomMessage(
				{
					customType: "tool_loop_detected",
					content: result.message,
					display: true,
					details: { toolName: result.toolName, count: result.count, hadErrors: result.hadErrors },
				},
				{ triggerTurn: true },
			);
		} finally {
			this._loopAbortInProgress = false;
		}
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		this._eventListeners.push(listener);

		// Return unsubscribe function for this specific listener
		return () => {
			const index = this._eventListeners.indexOf(listener);
			if (index !== -1) {
				this._eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Temporarily disconnect from agent events.
	 * User listeners are preserved and will receive events again after resubscribe().
	 * Used internally during operations that need to pause event processing.
	 */
	private _disconnectFromAgent(): void {
		if (this._unsubscribeAgent) {
			this._unsubscribeAgent();
			this._unsubscribeAgent = undefined;
		}
	}

	/**
	 * Reconnect to agent events after _disconnectFromAgent().
	 * Preserves all existing listeners.
	 */
	private _reconnectToAgent(): void {
		if (this._unsubscribeAgent) return; // Already connected
		this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
	}

	/**
	 * Remove all listeners and disconnect from agent.
	 * Call this when completely done with the session.
	 *
	 * @param options.invalidateRuntime When false (same-cwd session switch,
	 * where a successor session reuses the same services), skip poisoning the
	 * shared ExtensionRuntime: the runner wrapper is still marked stale so the
	 * outgoing session's captured contexts fail fast, but the shared runtime —
	 * and extension-captured `pi` references bound to it — stays usable for
	 * the successor. Full teardown (quit, reload, cwd change) keeps the
	 * default `invalidateRuntime: true`.
	 */
	dispose(options?: { invalidateRuntime?: boolean }): void {
		try {
			this.abortRetry();
			this.abortCompaction();
			this.abortBranchSummary();
			this.abortBash();
			this.agent.abort();
		} catch {
			// Dispose must succeed even if an abort hook throws.
		}

		const invalidateRuntime = options?.invalidateRuntime ?? true;
		this._extensionRunner.invalidate(
			"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
			{ shared: !invalidateRuntime },
		);
		this._disconnectFromAgent();
		this._eventListeners = [];
		clearSessionHooks(this.sessionId);
		cleanupSessionResources(this.sessionId);
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be undefined if not yet selected) */
	get model(): Model<any> | undefined {
		return this.agent.state.model;
	}

	getTierModels(): Record<string, string> {
		return normalizeTierModelsForAvailableModels(this._tierModels, this.modelRegistry.getAvailable(), this.model);
	}

	setTierModels(mapping: Record<string, string>): void {
		this._tierModels = { ...mapping };
		this.sessionManager.appendTierModelsChange(mapping);
		this.settingsManager.setTierModels(mapping);
		this._refreshSystemPromptForRuntimeContext();
	}

	/** Current thinking level */
	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	/** Whether agent is currently streaming a response */
	get isStreaming(): boolean {
		return this.agent.state.isStreaming;
	}

	/** Current effective system prompt (includes any per-turn extension modifications) */
	get systemPrompt(): string {
		return this.agent.state.systemPrompt;
	}

	/** Current retry attempt (0 if not retrying) */
	get retryAttempt(): number {
		return this._retryAttempt;
	}

	/**
	 * Get the names of currently active tools.
	 * Returns the names of tools currently set on the agent.
	 */
	getActiveToolNames(): string[] {
		return this.agent.state.tools.map((t) => t.name);
	}

	/**
	 * Get all configured tools with name, description, parameter schema, prompt guidelines, and source metadata.
	 */
	getAllTools(): ToolInfo[] {
		return Array.from(this._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
			name: definition.name,
			description: definition.description,
			parameters: definition.parameters,
			promptGuidelines: definition.promptGuidelines,
			sourceInfo,
		}));
	}

	getToolDefinition(name: string): ToolDefinition | undefined {
		return this._toolDefinitions.get(name)?.definition;
	}

	/**
	 * Set active tools by name.
	 * Only tools in the registry can be enabled. Unknown tool names are ignored.
	 * Also rebuilds the system prompt to reflect the new tool set.
	 * Changes take effect on the next agent turn.
	 */
	setActiveToolsByName(toolNames: string[]): void {
		const tools: AgentTool[] = [];
		const validToolNames: string[] = [];
		for (const name of toolNames) {
			const tool = this._toolRegistry.get(name);
			if (tool) {
				tools.push(tool);
				validToolNames.push(name);
			}
		}
		this.agent.state.tools = tools;

		// Rebuild base system prompt with new tool set
		this._baseSystemPrompt = this._rebuildSystemPrompt(validToolNames);
		this.agent.state.systemPrompt = this._baseSystemPrompt;
	}

	get permissionMode(): PermissionMode {
		return this._permissionMode;
	}

	setPermissionMode(mode: PermissionMode | LegacyPermissionMode): void {
		this._permissionMode = normalizePermissionMode(mode);
	}

	getCurrentAgent(): string {
		return this._currentAgentName;
	}

	private static readonly _SYSTEM_PATH_ALLOWLIST = ["/tmp/**", "/private/tmp/**", "/var/folders/**", "/dev/null"];
	private static readonly _READ_ONLY_PATH_TOOLS = new Set(["read", "grep", "glob", "find", "ls"]);
	private static readonly _WRITE_PATH_TOOLS = new Set(["edit", "write", "multiedit", "patch"]);
	private static readonly _SENSITIVE_READ_PATHS = [
		"/etc/passwd",
		"/etc/shadow",
		"/etc/sudoers",
		"/private/etc/passwd",
		"/private/etc/shadow",
		"/private/etc/sudoers",
		"**/.aws/**",
		"**/.config/opencode/**",
		"**/.docker/**",
		"**/.gnupg/**",
		"**/.kube/**",
		"**/.netrc",
		"**/.npmrc",
		"**/.ssh/**",
		"**/*credentials*",
		"**/id_ed25519",
		"**/id_rsa",
		"**/*.key",
		"**/*.pem",
	];

	private async _checkPathBoundary(
		toolName: string,
		toolCallId: string | undefined,
		args: unknown,
	): Promise<{ block: true; reason: string } | undefined> {
		const FILE_TOOLS = new Set([...AgentSession._READ_ONLY_PATH_TOOLS, ...AgentSession._WRITE_PATH_TOOLS]);
		if (!FILE_TOOLS.has(toolName)) return undefined;

		const rawPath = getPathArg(args);
		if (!rawPath) return undefined;

		// Resolve relative paths against cwd before checking
		const normalizedPath = resolvePathAgainstCwd(normalizeAgentPath(rawPath), this._cwd);

		// Is path inside cwd?
		if (normalizedPath === this._cwd || normalizedPath.startsWith(`${this._cwd}/`)) {
			return undefined;
		}

		// System paths: always allow (tmp, var/folders, etc.)
		for (const pattern of AgentSession._SYSTEM_PATH_ALLOWLIST) {
			if (matchPathGlob(normalizedPath, pattern)) return undefined;
		}

		if (this._getPermissionProfile().skipPathBoundaryApproval) return undefined;

		const scope = AgentSession._WRITE_PATH_TOOLS.has(toolName) ? "write" : "read";
		if (scope === "read" && !AgentSession._isSensitiveReadPath(normalizedPath)) {
			return undefined;
		}
		const subject = scope === "write" ? "file.write" : "file.read";
		const parentDir = `${normalizedPath.split("/").slice(0, -1).join("/")}/**`;
		const input = asRecord(args);
		const request: PermissionRequest = {
			requestId: `perm_${randomUUID()}`,
			sessionId: this.sessionManager.getSessionId(),
			toolCallId,
			provider: "path-access",
			subject,
			title: "Path outside project",
			message: `Allow ${toolName} to ${scope} ${normalizedPath} outside ${this._cwd}?`,
			actions: ["allow_once", "always_allow_project", "deny_once", "always_deny_project"],
			rememberOptions: [
				{
					id: "path-allow-parent",
					label: "This parent directory",
					subject,
					pattern: parentDir,
					scope: "project",
					action: "allow",
					metadata: { provider: "path-access", type: "path_boundary" },
				},
				{
					id: "path-deny-exact",
					label: "This exact path",
					subject,
					pattern: normalizedPath,
					scope: "project",
					action: "deny",
					metadata: { provider: "path-access", type: "path_boundary" },
				},
			],
			metadata: {
				type: "path_boundary",
				path: normalizedPath,
				cwd: this._cwd,
				toolName,
				scope,
				relativeTo: "outside project directory",
			},
			createdAt: new Date().toISOString(),
		};

		return this._applyPermissionDecision(await this._askPermission(request, input), input);
	}

	private static _isSensitiveReadPath(normalizedPath: string): boolean {
		return AgentSession._SENSITIVE_READ_PATHS.some((pattern) => matchPathGlob(normalizedPath, pattern));
	}

	applyAgentConfig(agent: AgentConfig): void {
		this._currentAgentName = agent.name;
		if (this._activeAgentHookSource) {
			clearSessionHooksBySource(this.sessionId, this._activeAgentHookSource);
			this._activeAgentHookSource = undefined;
		}
		if (agent.hooks) {
			const source = `agent:${agent.name}`;
			registerSessionHooks(this.sessionId, source, agent.hooks, { mapAgentStop: true });
			this._activeAgentHookSource = source;
		}
		this._currentAgentPaths = agent.paths;
		this._currentAgentTools = agent.tools && agent.tools.length > 0 ? agent.tools : undefined;
		this._currentAgentDisallowedTools =
			agent.disallowedTools && agent.disallowedTools.length > 0 ? agent.disallowedTools : undefined;

		const permissionProfile = agent.permissionProfile ?? agent.permissionMode;
		if (permissionProfile && isPermissionMode(permissionProfile)) {
			this.setPermissionMode(permissionProfile);
		}

		if (agent.thinkingLevel && isThinkingLevel(agent.thinkingLevel)) {
			this.setThinkingLevel(agent.thinkingLevel);
		}

		this._maxTurns = agent.maxTurns !== undefined && agent.maxTurns > 0 ? agent.maxTurns : undefined;
		this._activeSkillNames = agent.skills && agent.skills.length > 0 ? new Set(agent.skills) : undefined;

		if (agent.tools && agent.tools.length > 0) {
			this.setActiveToolsByName(agent.tools);
		} else {
			this.setActiveToolsByName([...this._toolRegistry.keys()]);
		}

		if (agent.disallowedTools && agent.disallowedTools.length > 0) {
			const disallowedTools = new Set(agent.disallowedTools);
			this.setActiveToolsByName(this.getActiveToolNames().filter((toolName) => !disallowedTools.has(toolName)));
		}

		this._agentSystemPromptOverride = buildAgentSystemPrompt(agent);
		this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
		this.agent.state.systemPrompt = this._baseSystemPrompt;

		this.sessionManager.appendAgentChange(agent.name, {
			description: agent.description,
			tools: agent.tools,
			disallowedTools: agent.disallowedTools,
			permissionMode: permissionProfile,
			tier: agent.tier,
			thinkingLevel: agent.thinkingLevel,
			model: agent.model,
			paths: agent.paths,
			maxTurns: agent.maxTurns,
			effort: agent.effort,
			skills: agent.skills,
		});
	}

	private _registerSkillHooks(skill: Skill): void {
		if (!skill.hooks) return;
		registerSessionHooks(this.sessionId, `skill:${skill.name}`, skill.hooks);
	}

	/** Whether compaction or branch summarization is currently running */
	get isCompacting(): boolean {
		return (
			this._autoCompactionAbortController !== undefined ||
			this._compactionAbortController !== undefined ||
			this._branchSummaryAbortController !== undefined
		);
	}

	/** Messages intended for external/runtime display. Hidden system events remain in agent state for LLM context. */
	get messages(): AgentMessage[] {
		return this.agent.state.messages.filter(isDisplayableSessionMessage);
	}

	/** Current steering mode */
	get steeringMode(): "all" | "one-at-a-time" {
		return this.agent.steeringMode;
	}

	/** Current follow-up mode */
	get followUpMode(): "all" | "one-at-a-time" {
		return this.agent.followUpMode;
	}

	/** Current session file path, or undefined if sessions are disabled */
	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}

	/** Current session ID */
	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}

	/** Current session display name, if set */
	get sessionName(): string | undefined {
		return this.sessionManager.getSessionName();
	}

	/** Scoped models for cycling (from --models flag) */
	get scopedModels(): ReadonlyArray<{ model: Model<any>; thinkingLevel?: ThinkingLevel }> {
		return this._scopedModels;
	}

	/** Update scoped models for cycling */
	setScopedModels(scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>): void {
		this._scopedModels = scopedModels;
	}

	/** File-based prompt templates */
	get promptTemplates(): ReadonlyArray<PromptTemplate> {
		return this._resourceLoader.getPrompts().prompts;
	}

	private _normalizePromptSnippet(text: string | undefined): string | undefined {
		if (!text) return undefined;
		const oneLine = text
			.replace(/[\r\n]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return oneLine.length > 0 ? oneLine : undefined;
	}

	private _normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
		if (!guidelines || guidelines.length === 0) {
			return [];
		}

		const unique = new Set<string>();
		for (const guideline of guidelines) {
			const normalized = guideline.trim();
			if (normalized.length > 0) {
				unique.add(normalized);
			}
		}
		return Array.from(unique);
	}

	private _getCurrentModelContext(): BuildSystemPromptOptions["modelContext"] {
		const model = this.model;
		const modelKey = model ? `${model.provider}/${model.id}` : undefined;
		const normalizedTierModels = this.getTierModels();
		const tier = modelKey ? ["fast", "pro", "max"].find((key) => normalizedTierModels[key] === modelKey) : undefined;

		if (!model && !tier && !this.thinkingLevel) {
			return undefined;
		}

		return {
			tier,
			provider: model?.provider,
			modelId: model?.id,
			modelName: model?.name,
			thinkingLevel: this.thinkingLevel,
			reasoning: model?.reasoning,
		};
	}

	private _refreshSystemPromptForRuntimeContext(): void {
		if (!this._baseSystemPrompt) return;
		this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
		this.agent.state.systemPrompt = this._baseSystemPrompt;
	}

	private _rebuildSystemPrompt(toolNames: string[]): string {
		const validToolNames = toolNames.filter((name) => this._toolRegistry.has(name));
		const toolSnippets: Record<string, string> = {};
		const promptGuidelines: string[] = [];
		for (const name of validToolNames) {
			const snippet = this._toolPromptSnippets.get(name);
			if (snippet) {
				toolSnippets[name] = snippet;
			}

			const toolGuidelines = this._toolPromptGuidelines.get(name);
			if (toolGuidelines) {
				promptGuidelines.push(...toolGuidelines);
			}
		}

		const loaderSystemPrompt = this._agentSystemPromptOverride ?? this._resourceLoader.getSystemPrompt();
		const loaderAppendSystemPrompt = this._resourceLoader.getAppendSystemPrompt();
		const appendSystemPrompt =
			loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : undefined;
		const loadedSkills = this._resourceLoader.getSkills().skills;
		const activeSkills = this._activeSkillNames
			? loadedSkills.filter((skill) => this._activeSkillNames?.has(skill.name))
			: loadedSkills;
		const loadedContextFiles = this._resourceLoader.getAgentsFiles().agentsFiles;
		const availableAgents = discoverAgents(this._cwd, "both").agents;

		this._baseSystemPromptOptions = {
			cwd: this._cwd,
			modelContext: this._getCurrentModelContext(),
			skills: activeSkills,
			agents: availableAgents,
			contextFiles: loadedContextFiles,
			customPrompt: loaderSystemPrompt,
			appendSystemPrompt,
			selectedTools: validToolNames,
			toolSnippets,
			promptGuidelines,
		};
		const result = buildSystemPromptWithBreakdown(this._baseSystemPromptOptions);
		this._baseSystemPromptBreakdown = result.breakdown;
		return result.prompt;
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
		try {
			await this.agent.prompt(messages);
			await this._runPostAgentLoop("Post-run");
		} finally {
			this._flushPendingBashMessages();
		}
	}

	private async _runPostAgentLoop(label: string): Promise<void> {
		let iterations = 0;
		while (await this._handlePostAgentRun()) {
			if (++iterations > AgentSession.MAX_POST_RUN_ITERATIONS) {
				console.warn(
					`[AgentSession] ${label} loop exceeded ${AgentSession.MAX_POST_RUN_ITERATIONS} iterations, breaking.`,
				);
				break;
			}
			// Notify user when a plugin/extension triggers an automatic continue.
			// This makes implicit loops visible so users aren't confused by
			// unexpected additional LLM turns.
			if (this.agent.hasQueuedMessages()) {
				this._emit({
					type: "auto_continue",
					reason: "queued messages",
					iteration: iterations,
				});
			}
			await this.agent.continue();
		}
	}

	private async _handlePostAgentRun(): Promise<boolean> {
		if (this._aborted) return false;

		const msg = this._lastAssistantMessage;
		this._lastAssistantMessage = undefined;
		if (!msg) {
			return false;
		}

		if (this._isRetryableError(msg) && (await this._prepareRetry(msg))) {
			return true;
		}

		if (msg.stopReason === "error" && this._retryAttempt > 0) {
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt: this._retryAttempt,
				finalError: msg.errorMessage,
			});
			this._retryAttempt = 0;
		}

		// Non-retryable provider limit errors (billing/balance/quota) should not
		// trigger compaction or continuation — the error is permanent until the
		// user fixes their account. Without this, compaction succeeds on the
		// summarized context and loops indefinitely on the same billing error.
		if (msg.stopReason === "error" && msg.errorMessage && this._isNonRetryableProviderLimitError(msg.errorMessage)) {
			return false;
		}

		if (await this._checkCompaction(msg)) {
			return true;
		}

		// The agent loop drains both queues before emitting agent_end. Any messages
		// here were queued by agent_end extension handlers and need a continuation.
		return this.agent.hasQueuedMessages();
	}

	/**
	 * Send a prompt to the agent.
	 * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
	 * - Expands file-based prompt templates by default
	 * - During streaming, queues via steer() or followUp() based on streamingBehavior option
	 * - Validates model and API key before sending (when not streaming)
	 * @throws Error if streaming and no streamingBehavior specified
	 * @throws Error if no model selected or no API key available (when not streaming)
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {
		this._aborted = false;
		resetLoopDetection(this._loopState);
		const expandPromptTemplates = options?.expandPromptTemplates ?? true;
		const preflightResult = options?.preflightResult;
		let messages: AgentMessage[] | undefined;

		try {
			// Handle extension commands first (execute immediately, even during streaming)
			// Extension commands manage their own LLM interaction via pi.sendMessage()
			if (expandPromptTemplates && text.startsWith("/")) {
				const handled = await this._tryExecuteExtensionCommand(text);
				if (handled) {
					// Extension command executed, no prompt to send
					preflightResult?.(true);
					return;
				}
			}

			// Emit input event for extension interception (before skill/template expansion)
			let currentText = text;
			let currentImages = options?.images;
			if (this._extensionRunner.hasHandlers("input")) {
				const inputResult = await this._extensionRunner.emitInput(
					currentText,
					currentImages,
					options?.source ?? "interactive",
					this.isStreaming ? options?.streamingBehavior : undefined,
				);
				if (inputResult.action === "handled") {
					preflightResult?.(true);
					return;
				}
				if (inputResult.action === "transform") {
					currentText = inputResult.text;
					currentImages = inputResult.images ?? currentImages;
				}
			}

			// Expand skill commands (/skill:name args) and prompt templates (/template args)
			let expandedText = currentText;
			if (expandPromptTemplates) {
				expandedText = this._expandSkillCommand(expandedText);
				expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
			}

			// If streaming, queue via steer() or followUp() based on option
			if (this.isStreaming) {
				if (!options?.streamingBehavior) {
					throw new Error(
						"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
					);
				}
				const { text: finalText } = handleLargeInput(expandedText);
				if (options.streamingBehavior === "followUp") {
					await this._queueFollowUp(finalText, currentImages);
				} else {
					await this._queueSteer(finalText, currentImages);
				}
				preflightResult?.(true);
				return;
			}

			// Flush any pending bash messages before the new prompt
			this._flushPendingBashMessages();

			// Validate model
			if (!this.model) {
				throw new Error(formatNoModelSelectedMessage());
			}

			if (!this._modelRegistry.hasConfiguredAuth(this.model)) {
				const isOAuth = this._modelRegistry.isUsingOAuth(this.model);
				if (isOAuth) {
					throw new Error(
						`Authentication failed for "${this.model.provider}". ` +
							`Credentials may have expired or network is unavailable. ` +
							`Run '/login ${this.model.provider}' to re-authenticate.`,
					);
				}
				throw new Error(formatNoApiKeyFoundMessage(this.model.provider));
			}

			// Pre-flight: estimate current context size independently of stale usage data.
			// After session resume or rollback, agent.state.messages may contain far more
			// content than the last assistant message's usage reflects. Re-estimate from
			// scratch so we compact before sending an oversized request.
			const contextWindow = this.model?.contextWindow ?? 0;
			const compactionSettings = this.settingsManager.getCompactionSettings();
			if (compactionSettings.enabled && contextWindow > 0) {
				const currentMessages = this.agent.state.messages;
				let estimatedTotal = 0;
				for (const msg of currentMessages) {
					estimatedTotal += estimateTokens(msg);
				}
				if (shouldCompact(estimatedTotal, contextWindow, compactionSettings)) {
					// When context is extremely large (>2x window), LLM summarization
					// will also overflow. Use emergency truncation instead: find cut point
					// and use a plain-text summary instead of calling the LLM.
					const useEmergencyTruncation = estimatedTotal > contextWindow * 2;
					if (useEmergencyTruncation) {
						await this._emergencyTruncation(estimatedTotal);
					} else {
						await this._runAutoCompaction("threshold", false);
					}
				}
			}

			// Check if we need to compact before sending (catches aborted responses)
			const lastAssistant = this._findLastAssistantMessage();
			if (lastAssistant && (await this._checkCompaction(lastAssistant, false))) {
				try {
					await this.agent.continue();
					await this._runPostAgentLoop("Pre-prompt post-run");
				} finally {
					this._flushPendingBashMessages();
				}
			}

			// Build messages array (custom message if any, then user message)
			messages = [];

			const { text: finalText } = handleLargeInput(expandedText);

			// Add user message
			const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: finalText }];
			if (currentImages) {
				userContent.push(...currentImages);
			}
			messages.push({
				role: "user",
				content: userContent,
				timestamp: Date.now(),
			});

			// Inject any pending "nextTurn" messages as context alongside the user message
			for (const msg of this._pendingNextTurnMessages) {
				messages.push(msg);
			}
			this._pendingNextTurnMessages = [];

			// Emit before_agent_start extension event
			const result = await this._extensionRunner.emitBeforeAgentStart(
				expandedText,
				currentImages,
				this._baseSystemPrompt,
				this._baseSystemPromptOptions,
				options?.source ?? "interactive",
			);
			// Add all custom messages from extensions
			if (result?.messages) {
				for (const msg of result.messages) {
					messages.push({
						role: "custom",
						customType: msg.customType,
						content: msg.content,
						display: msg.display,
						details: msg.details,
						timestamp: Date.now(),
					});
				}
			}
			// Apply extension-modified system prompt, or reset to base
			if (result?.systemPrompt) {
				this.agent.state.systemPrompt = result.systemPrompt;
			} else {
				// Ensure we're using the base prompt (in case previous turn had modifications)
				this.agent.state.systemPrompt = this._baseSystemPrompt;
			}
		} catch (error) {
			preflightResult?.(false);
			throw error;
		}

		if (!messages) {
			return;
		}

		preflightResult?.(true);
		await this._runAgentPrompt(messages);
	}

	/**
	 * Try to execute an extension command. Returns true if command was found and executed.
	 */
	private async _tryExecuteExtensionCommand(text: string): Promise<boolean> {
		// Parse command name and args
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

		const command = this._extensionRunner.getCommand(commandName);
		if (!command) return false;

		// Get command context from extension runner (includes session control methods)
		const ctx = this._extensionRunner.createCommandContext();

		try {
			await command.handler(args, ctx);
			return true;
		} catch (err) {
			// Emit error via extension runner
			this._extensionRunner.emitError({
				extensionPath: `command:${commandName}`,
				event: "command",
				error: err instanceof Error ? err.message : String(err),
			});
			return true;
		}
	}

	/**
	 * Expand skill commands (/skill:name args) to their full content.
	 * Returns the expanded text, or the original text if not a skill command or skill not found.
	 * Emits errors via extension runner if file read fails.
	 */
	private _expandSkillCommand(text: string): string {
		if (!text.startsWith("/skill:")) return text;

		const spaceIndex = text.indexOf(" ");
		const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

		const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
		if (!skill) return text; // Unknown skill, pass through

		this._registerSkillHooks(skill);

		try {
			const content = readFileSync(skill.filePath, "utf-8");
			const body = stripFrontmatter(content).trim();
			const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
			return args ? `${skillBlock}\n\n${args}` : skillBlock;
		} catch (err) {
			// Emit error like extension commands do
			this._extensionRunner.emitError({
				extensionPath: skill.filePath,
				event: "skill_expansion",
				error: err instanceof Error ? err.message : String(err),
			});
			return text; // Return original on error
		}
	}

	/**
	 * Queue a steering message.
	 *
	 * - `steer(text, images?)`: backward-compatible, queues new text content.
	 * - `steer({ text, images, promote, immediate })`: full options.
	 *
	 * When `promote` is set, the message at that index in the follow-up queue is
	 * promoted to steer (moved, not copied). `immediate` triggers a soft interrupt
	 * so the queued prompt takes effect without waiting for the current tool turn
	 * to complete.
	 *
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @throws Error if text is an extension command
	 */
	steer(text: string, images?: ImageContent[]): Promise<void>;
	steer(opts: {
		/** Text to steer the agent with. Optional — if omitted with `promote`, only queue promotion happens. */
		text?: string;
		/** Optional image attachments to include with the message. */
		images?: ImageContent[];
		/** Index in the follow-up queue to promote to steer. Takes priority over `text` if both are set. */
		promote?: number;
		/** If true, interrupt the current tool execution so this steer takes effect immediately. */
		immediate?: boolean;
	}): Promise<void>;
	async steer(
		input:
			| string
			| {
					text?: string;
					images?: ImageContent[];
					promote?: number;
					immediate?: boolean;
			  },
		images?: ImageContent[],
	): Promise<void> {
		if (typeof input === "string") {
			return this._steerText(input, images);
		}
		const opts = input;

		if (opts.promote !== undefined) {
			// Promote from follow-up queue, no text expansion needed
			this.agent.steer({ promote: opts.promote, immediate: opts.immediate });
			await this._runIfIdle();
			return;
		}

		if (opts.text) {
			// New message with optional interrupt
			await this._steerText(opts.text, opts.images, opts.immediate);
			return;
		}

		// Only immediate flag, no content — just interrupt
		if (opts.immediate) {
			this.agent.interrupt();
			await this._runIfIdle();
		}
	}

	/**
	 * If the agent is idle and the steering queue has messages, drain them
	 * and start a new run. This ensures that steer({ immediate }) or
	 * steer({ promote, immediate }) triggers a cycle even when issued
	 * outside an active run.
	 */
	private async _runIfIdle(): Promise<void> {
		if (this.isStreaming) return;
		const msgs = this.agent.drainSteeringMessages();
		if (msgs.length > 0) {
			await this.agent.prompt(msgs);
		}
	}

	/**
	 * Old-style steer: text + images, with optional immediate.
	 */
	private async _steerText(text: string, images?: ImageContent[], immediate?: boolean): Promise<void> {
		// Check for extension commands (cannot be queued)
		if (text.startsWith("/")) {
			this._throwIfExtensionCommand(text);
		}

		// Expand skill commands and prompt templates
		let expandedText = this._expandSkillCommand(text);
		expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

		const { text: finalText } = handleLargeInput(expandedText);
		if (!this.isStreaming) {
			await this.prompt(finalText, { images, expandPromptTemplates: false });
			return;
		}
		await this._queueSteer(finalText, images);
		if (immediate) {
			this.agent.interrupt();
		}
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 * Delivered only when agent has no more tool calls or steering messages.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 * @param images Optional image attachments to include with the message
	 * @throws Error if text is an extension command
	 */
	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		// Check for extension commands (cannot be queued)
		if (text.startsWith("/")) {
			this._throwIfExtensionCommand(text);
		}

		// Expand skill commands and prompt templates
		let expandedText = this._expandSkillCommand(text);
		expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

		const { text: finalText } = handleLargeInput(expandedText);
		if (!this.isStreaming) {
			await this.prompt(finalText, { images, expandPromptTemplates: false });
			return;
		}
		await this._queueFollowUp(finalText, images);
	}

	/**
	 * Continue from the current transcript without adding a new user message.
	 * Calls the underlying agent.continue() then runs the post-agent-run loop
	 * (compaction, retry, queued messages). Useful for re-prompting after a
	 * model switch or billing error where the last message is already a valid
	 * user/tool-result message.
	 */
	async continue(): Promise<void> {
		this._aborted = false;
		this._overflowRecoveryAttempts = 0;
		resetLoopDetection(this._loopState);
		await this.agent.continue();
		await this._runPostAgentLoop("Continue post-run");
		this._flushPendingBashMessages();
	}

	/**
	 * Internal: Queue a steering message (already expanded, no extension command check).
	 */
	private async _queueSteer(text: string, images?: ImageContent[]): Promise<void> {
		this._steeringMessages.push(text);
		this._steeringQueueEntries.push({ text, images });
		this._emitQueueUpdate();
		this.agent.steer(this._queuedUserMessageToAgentMessage({ text, images }));
	}

	/**
	 * Internal: Queue a follow-up message (already expanded, no extension command check).
	 */
	private async _queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
		this._followUpMessages.push(text);
		this._followUpQueueEntries.push({ text, images });
		this._emitQueueUpdate();
		this.agent.followUp(this._queuedUserMessageToAgentMessage({ text, images }));
	}

	private _queuedUserMessageToAgentMessage(entry: QueuedUserMessage): AgentMessage {
		const content: (TextContent | ImageContent)[] = [{ type: "text", text: entry.text }];
		if (entry.images) {
			content.push(...entry.images);
		}
		return {
			role: "user",
			content,
			timestamp: Date.now(),
		};
	}

	private _rebuildAgentQueues(): void {
		this.agent.clearAllQueues();
		for (const entry of this._steeringQueueEntries) {
			this.agent.steer(this._queuedUserMessageToAgentMessage(entry));
		}
		for (const entry of this._followUpQueueEntries) {
			this.agent.followUp(this._queuedUserMessageToAgentMessage(entry));
		}
	}

	/**
	 * Throw an error if the text is an extension command.
	 */
	private _throwIfExtensionCommand(text: string): void {
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const command = this._extensionRunner.getCommand(commandName);

		if (command) {
			throw new Error(
				`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
			);
		}
	}

	/**
	 * Send a custom message to the session. Creates a CustomMessageEntry.
	 *
	 * Handles three cases:
	 * - Streaming: queues message, processed when loop pulls from queue
	 * - Not streaming + triggerTurn: appends to state/session, starts new turn
	 * - Not streaming + no trigger: appends to state/session, no turn
	 *
	 * @param message Custom message with customType, content, display, details
	 * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
	 * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
	 */
	async sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void> {
		const appMessage = {
			role: "custom" as const,
			customType: message.customType,
			content: message.content,
			display: message.display,
			details: message.details,
			timestamp: Date.now(),
		} satisfies CustomMessage<T>;
		if (options?.deliverAs === "nextTurn") {
			this._pendingNextTurnMessages.push(appMessage);
		} else if (this.isStreaming) {
			const queueText = getMessageText(appMessage);
			if (options?.deliverAs === "followUp") {
				this._followUpMessages.push(queueText);
				this._emitQueueUpdate();
				this.agent.followUp(appMessage);
			} else {
				this._steeringMessages.push(queueText);
				this._emitQueueUpdate();
				this.agent.steer(appMessage);
			}
		} else if (options?.triggerTurn) {
			await this._runAgentPrompt(appMessage);
		} else {
			this.agent.state.messages.push(appMessage);
			this.sessionManager.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
			this._emit({ type: "message_start", message: appMessage });
			this._emit({ type: "message_end", message: appMessage });
		}
	}

	/**
	 * Send a user message to the agent. Always triggers a turn.
	 * When the agent is streaming, use deliverAs to specify how to queue the message.
	 *
	 * @param content User message content (string or content array)
	 * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
	 */
	async sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		// Normalize content to text string + optional images
		let text: string;
		let images: ImageContent[] | undefined;

		if (typeof content === "string") {
			text = content;
		} else {
			const textParts: string[] = [];
			images = [];
			for (const part of content) {
				if (part.type === "text") {
					textParts.push(part.text);
				} else {
					images.push(part);
				}
			}
			text = textParts.join("\n");
			if (images.length === 0) images = undefined;
		}

		// Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
		await this.prompt(text, {
			expandPromptTemplates: false,
			streamingBehavior: options?.deliverAs,
			images,
			source: "extension",
		});
	}

	/**
	 * Clear all queued messages and return them.
	 * Useful for restoring to editor when user aborts.
	 * @returns Object with steering and followUp arrays
	 */
	clearQueue(item?: QueueItemRef): { steering: string[]; followUp: string[] } {
		if (item) {
			const messages = item.type === "steering" ? this._steeringMessages : this._followUpMessages;
			const entries = item.type === "steering" ? this._steeringQueueEntries : this._followUpQueueEntries;
			if (messages[item.index] !== item.text) {
				this._emitQueueUpdate();
				return { steering: [], followUp: [] };
			}
			const removed = messages.splice(item.index, 1);
			entries.splice(item.index, 1);
			this._rebuildAgentQueues();
			this._emitQueueUpdate();
			return item.type === "steering" ? { steering: removed, followUp: [] } : { steering: [], followUp: removed };
		}

		const steering = [...this._steeringMessages];
		const followUp = [...this._followUpMessages];
		this._steeringMessages = [];
		this._steeringQueueEntries = [];
		this._followUpMessages = [];
		this._followUpQueueEntries = [];
		this.agent.clearAllQueues();
		this._emitQueueUpdate();
		return { steering, followUp };
	}

	promoteQueuedFollowUp(item: FollowUpQueueItemRef): { steering: string[]; followUp: string[] } {
		if (this._followUpMessages[item.index] !== item.text) {
			this._emitQueueUpdate();
			return {
				steering: [...this._steeringMessages],
				followUp: [...this._followUpMessages],
			};
		}

		const [text] = this._followUpMessages.splice(item.index, 1);
		const [entry] = this._followUpQueueEntries.splice(item.index, 1);
		this._steeringMessages.push(text);
		this._steeringQueueEntries.push(entry);
		this._rebuildAgentQueues();
		this._emitQueueUpdate();
		return {
			steering: [...this._steeringMessages],
			followUp: [...this._followUpMessages],
		};
	}

	/** Number of pending messages (includes both steering and follow-up) */
	get pendingMessageCount(): number {
		return this._steeringMessages.length + this._followUpMessages.length;
	}

	/** Get pending steering messages (read-only) */
	getSteeringMessages(): readonly string[] {
		return this._steeringMessages;
	}

	/** Get pending follow-up messages (read-only) */
	getFollowUpMessages(): readonly string[] {
		return this._followUpMessages;
	}

	get resourceLoader(): ResourceLoader {
		return this._resourceLoader;
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this._aborted = true;
		this.abortRetry();
		this.agent.abort();
		await this.agent.waitForIdle();
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	private async _emitModelSelect(
		nextModel: Model<any>,
		previousModel: Model<any> | undefined,
		source: "set" | "cycle" | "restore",
	): Promise<void> {
		if (modelsAreEqual(previousModel, nextModel)) return;
		await this._extensionRunner.emit({
			type: "model_select",
			model: nextModel,
			previousModel,
			source,
		});
	}

	/**
	 * Set model directly.
	 * Validates that auth is configured, saves to session and settings.
	 * @throws Error if no auth is configured for the model
	 */
	async setModel(model: Model<any>): Promise<void> {
		if (!this._modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		const previousModel = this.model;
		const thinkingLevel = this._getThinkingLevelForModelSwitch();
		this.agent.state.model = model;
		this.sessionManager.appendModelChange(model.provider, model.id);
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(model, previousModel, "set");
	}

	/**
	 * Cycle to next/previous model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @param direction - "forward" (default) or "backward"
	 * @returns The new model info, or undefined if only one model available
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this._scopedModels.length > 0) {
			return this._cycleScopedModel(direction);
		}
		return this._cycleAvailableModel(direction);
	}

	private async _cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const scopedModels = this._scopedModels.filter((scoped) => this._modelRegistry.hasConfiguredAuth(scoped.model));
		if (scopedModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = scopedModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const next = scopedModels[nextIndex];
		const thinkingLevel = this._getThinkingLevelForModelSwitch(next.thinkingLevel);

		// Apply model
		this.agent.state.model = next.model;
		this.sessionManager.appendModelChange(next.model.provider, next.model.id);
		this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);

		// Apply thinking level.
		// - Explicit scoped model thinking level overrides current session level
		// - Undefined scoped model thinking level inherits the current session preference
		// setThinkingLevel clamps to model capabilities.
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(next.model, currentModel, "cycle");

		return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
	}

	private async _cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const availableModels = await this._modelRegistry.getAvailable();
		if (availableModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = availableModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const nextModel = availableModels[nextIndex];

		const thinkingLevel = this._getThinkingLevelForModelSwitch();
		this.agent.state.model = nextModel;
		this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
		this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);

		// Re-clamp thinking level for new model's capabilities
		this.setThinkingLevel(thinkingLevel);

		await this._emitModelSelect(nextModel, currentModel, "cycle");

		return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
	}

	// =========================================================================
	// Thinking Level Management
	// =========================================================================

	/**
	 * Set thinking level.
	 * Clamps to model capabilities based on available thinking levels.
	 * Saves to session and settings only if the level actually changes.
	 */
	setThinkingLevel(level: ThinkingLevel): void {
		const availableLevels = this.getAvailableThinkingLevels();
		const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);

		// Only persist if actually changing
		const previousLevel = this.agent.state.thinkingLevel;
		const isChanging = effectiveLevel !== previousLevel;

		this.agent.state.thinkingLevel = effectiveLevel;

		if (isChanging) {
			this.sessionManager.appendThinkingLevelChange(effectiveLevel);
			if (this.supportsThinking() || effectiveLevel !== "off") {
				this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
			}
			this._emit({ type: "thinking_level_changed", level: effectiveLevel });
			void this._extensionRunner.emit({
				type: "thinking_level_select",
				level: effectiveLevel,
				previousLevel,
			});
		}
		this._refreshSystemPromptForRuntimeContext();
	}

	/**
	 * Cycle to next thinking level.
	 * @returns New level, or undefined if model doesn't support thinking
	 */
	cycleThinkingLevel(): ThinkingLevel | undefined {
		if (!this.supportsThinking()) return undefined;

		const levels = this.getAvailableThinkingLevels();
		const currentIndex = levels.indexOf(this.thinkingLevel);
		const nextIndex = (currentIndex + 1) % levels.length;
		const nextLevel = levels[nextIndex];

		this.setThinkingLevel(nextLevel);
		return nextLevel;
	}

	/**
	 * Get available thinking levels for current model.
	 * The provider will clamp to what the specific model supports internally.
	 */
	getAvailableThinkingLevels(): ThinkingLevel[] {
		if (!this.model) return THINKING_LEVELS;
		return getSupportedThinkingLevels(this.model) as ThinkingLevel[];
	}

	/**
	 * Check if current model supports thinking/reasoning.
	 */
	supportsThinking(): boolean {
		return !!this.model?.reasoning;
	}

	private _getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel {
		if (explicitLevel !== undefined) {
			return explicitLevel;
		}
		if (!this.supportsThinking()) {
			return this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
		}
		return this.thinkingLevel;
	}

	private _clampThinkingLevel(level: ThinkingLevel, _availableLevels: ThinkingLevel[]): ThinkingLevel {
		return this.model ? (clampThinkingLevel(this.model, level) as ThinkingLevel) : "off";
	}

	// =========================================================================
	// Queue Mode Management
	// =========================================================================

	private syncQueueModesFromSettings(): void {
		// Steering messages are interventions for the next LLM turn and should be
		// delivered together even when older settings still say one-at-a-time.
		this.agent.steeringMode = "all";
		this.agent.followUpMode = this.settingsManager.getFollowUpMode();
	}

	/**
	 * Set steering message mode.
	 * Saves to settings.
	 */
	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.agent.steeringMode = "all";
		this.settingsManager.setSteeringMode(mode);
	}

	/**
	 * Set follow-up message mode.
	 * Saves to settings.
	 */
	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.agent.followUpMode = mode;
		this.settingsManager.setFollowUpMode(mode);
	}

	// =========================================================================
	// Compaction
	// =========================================================================

	/**
	 * Manually compact the session context.
	 * Aborts current agent operation first.
	 * @param customInstructions Optional instructions for the compaction summary
	 */
	async compact(customInstructions?: string): Promise<CompactionResult> {
		this._disconnectFromAgent();
		await this.abort();
		this._compactionAbortController = new AbortController();
		this._emit({ type: "compaction_start", reason: "manual" });

		try {
			if (!this.model) {
				throw new Error(formatNoModelSelectedMessage());
			}

			const { apiKey, headers } = await this._getCompactionRequestAuth(this.model);

			const pathEntries = this.sessionManager.getBranch();
			const settings = this.settingsManager.getCompactionSettings();

			const preparation = prepareCompaction(pathEntries, settings);
			if (!preparation) {
				// Check why we can't compact
				const lastEntry = pathEntries[pathEntries.length - 1];
				if (lastEntry?.type === "compaction") {
					throw new Error("Already compacted");
				}
				throw new Error("Nothing to compact (session too small)");
			}

			let extensionCompaction: CompactionResult | undefined;
			let fromExtension = false;

			if (this._extensionRunner.hasHandlers("session_before_compact")) {
				const result = (await this._extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions,
					signal: this._compactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (result?.cancel) {
					throw new Error("Compaction cancelled");
				}

				if (result?.compaction) {
					extensionCompaction = result.compaction;
					fromExtension = true;
				}
			}

			let summary: string;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let details: unknown;

			if (extensionCompaction) {
				// Extension provided compaction content
				summary = extensionCompaction.summary;
				firstKeptEntryId = extensionCompaction.firstKeptEntryId;
				tokensBefore = extensionCompaction.tokensBefore;
				details = extensionCompaction.details;
			} else {
				// Generate compaction result
				const result = await compact(
					preparation,
					this.model,
					apiKey,
					headers,
					customInstructions,
					this._compactionAbortController.signal,
					this.thinkingLevel,
					this.agent.streamFn,
				);
				summary = result.summary;
				firstKeptEntryId = result.firstKeptEntryId;
				tokensBefore = result.tokensBefore;
				details = result.details;
			}

			if (this._compactionAbortController.signal.aborted) {
				throw new Error("Compaction cancelled");
			}

			this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension);
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.state.messages = sessionContext.messages;

			// Get the saved compaction entry for the extension event
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this._extensionRunner && savedCompactionEntry) {
				await this._extensionRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromExtension,
				});
			}

			const compactionResult = {
				summary,
				firstKeptEntryId,
				tokensBefore,
				details,
			};
			this._emit({
				type: "compaction_end",
				reason: "manual",
				result: compactionResult,
				aborted: false,
				willRetry: false,
			});
			return compactionResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const aborted = message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");
			this._emit({
				type: "compaction_end",
				reason: "manual",
				result: undefined,
				aborted,
				willRetry: false,
				errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
			});
			throw error;
		} finally {
			this._compactionAbortController = undefined;
			this._reconnectToAgent();
		}
	}

	/**
	 * Cancel in-progress compaction (manual or auto).
	 */
	abortCompaction(): void {
		this._compactionAbortController?.abort();
		this._autoCompactionAbortController?.abort();
	}

	/**
	 * Cancel in-progress branch summarization.
	 */
	abortBranchSummary(): void {
		this._branchSummaryAbortController?.abort();
	}

	/**
	 * Check if compaction is needed and run it.
	 * Called after agent_end and before prompt submission.
	 *
	 * Two cases:
	 * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
	 * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
	 *
	 * @param assistantMessage The assistant message to check
	 * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
	 */
	private async _checkCompaction(assistantMessage: AssistantMessage, skipAbortedCheck = true): Promise<boolean> {
		const settings = this.settingsManager.getCompactionSettings();
		if (!settings.enabled) return false;

		// Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
		if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;

		const contextWindow = this.model?.contextWindow ?? 0;

		// Skip overflow check if the message came from a different model.
		// This handles the case where user switched from a smaller-context model (e.g. opus)
		// to a larger-context model (e.g. codex) - the overflow error from the old model
		// shouldn't trigger compaction for the new model.
		const sameModel =
			this.model && assistantMessage.provider === this.model.provider && assistantMessage.model === this.model.id;

		// Skip compaction checks if this assistant message is older than the latest
		// compaction boundary. This prevents a stale pre-compaction usage/error
		// from retriggering compaction on the first prompt after compaction.
		const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
		const assistantIsFromBeforeCompaction =
			compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
		if (assistantIsFromBeforeCompaction) {
			return false;
		}

		// Case 1: Overflow - LLM returned context overflow error
		// Note: we intentionally don't gate on sameModel here. The overflow
		// happened because the current messages exceed *some* model's context
		// window, and compaction reduces the context — this is always the
		// right move regardless of which model last produced the error.
		if (isContextOverflow(assistantMessage, contextWindow)) {
			if (this._overflowRecoveryAttempts >= AgentSession.MAX_OVERFLOW_RECOVERY_ROUNDS) {
				this._emit({
					type: "compaction_end",
					reason: "overflow",
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage: `Context overflow recovery failed after ${AgentSession.MAX_OVERFLOW_RECOVERY_ROUNDS} compact-and-retry attempts. Try reducing context or switching to a larger-context model.`,
				});
				return false;
			}

			this._overflowRecoveryAttempts++;
			// Remove trailing assistant error messages from agent state (they ARE saved
			// to session for history, but we don't want them in context for the retry)
			const messages = this.agent.state.messages;
			while (
				messages.length > 0 &&
				messages[messages.length - 1].role === "assistant" &&
				(messages[messages.length - 1] as AssistantMessage).stopReason === "error"
			) {
				messages.pop();
			}
			return await this._runAutoCompaction("overflow", true);
		}

		// Case 2: Threshold - context is getting large
		// For error messages (no usage data), estimate from last successful response.
		// This ensures sessions that hit persistent API errors (e.g. 529) can still compact.
		let contextTokens: number;
		if (assistantMessage.stopReason === "error") {
			const messages = this.agent.state.messages;
			const estimate = estimateContextTokens(messages);
			if (estimate.lastUsageIndex === null) return false; // No usage data at all
			// Verify the usage source is post-compaction. Kept pre-compaction messages
			// have stale usage reflecting the old (larger) context and would falsely
			// trigger compaction right after one just finished.
			const usageMsg = messages[estimate.lastUsageIndex];
			if (
				compactionEntry &&
				usageMsg.role === "assistant" &&
				(usageMsg as AssistantMessage).timestamp <= new Date(compactionEntry.timestamp).getTime()
			) {
				return false;
			}
			contextTokens = estimate.tokens;
		} else {
			contextTokens = calculateContextTokens(assistantMessage.usage);
		}
		if (this._skipNextThresholdCheck) {
			this._skipNextThresholdCheck = false;
		} else if (shouldCompact(contextTokens, contextWindow, settings)) {
			this._skipNextThresholdCheck = true;
			return await this._runAutoCompaction("threshold", false);
		}
		return false;
	}

	/**
	 * Emergency truncation: when context is so large that LLM summarization would also
	 * overflow, skip the LLM call and use a plain-text summary. This handles the case
	 * where session resume or rollback produces a context >>2x the model's window.
	 */
	private async _emergencyTruncation(estimatedTokens: number): Promise<void> {
		const settings = this.settingsManager.getCompactionSettings();
		const pathEntries = this.sessionManager.getBranch();

		this._emit({ type: "compaction_start", reason: "overflow" });
		this._autoCompactionAbortController = new AbortController();

		try {
			if (!this.model) {
				this._emit({
					type: "compaction_end",
					reason: "overflow",
					result: undefined,
					aborted: false,
					willRetry: false,
				});
				return;
			}

			const preparation = prepareCompaction(pathEntries, settings);
			if (!preparation) {
				this._emit({
					type: "compaction_end",
					reason: "overflow",
					result: undefined,
					aborted: false,
					willRetry: false,
				});
				return;
			}

			// Build a plain-text summary instead of calling the LLM
			const msgCount = preparation.messagesToSummarize.length;
			const summary =
				`[Emergency truncation] ${msgCount} messages (${Math.round(estimatedTokens / 1000)}k tokens) ` +
				`were truncated to fit within the model's context window. ` +
				`The conversation history has been preserved in the session file.`;

			// Extract file operations from the discarded messages
			const { readFiles, modifiedFiles } = computeFileLists(preparation.fileOps);
			const summaryWithFiles = summary + formatFileOperations(readFiles, modifiedFiles);

			this.sessionManager.appendCompaction(
				summaryWithFiles,
				preparation.firstKeptEntryId,
				preparation.tokensBefore,
				{ readFiles, modifiedFiles },
				false,
			);

			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.state.messages = sessionContext.messages;
			this._overflowRecoveryAttempts = 0;

			this._emit({
				type: "compaction_end",
				reason: "overflow",
				result: {
					summary: summaryWithFiles,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
					details: { readFiles, modifiedFiles },
				},
				aborted: false,
				willRetry: false,
			});
		} catch (err) {
			this._consecutiveAutoCompactFailures++;
			this._emit({
				type: "compaction_end",
				reason: "overflow",
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage: `Emergency truncation failed: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	/**
	 * Internal: Run auto-compaction with events.
	 */
	private async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean> {
		// Circuit breaker: skip if too many consecutive failures
		if (this._consecutiveAutoCompactFailures >= AgentSession.MAX_CONSECUTIVE_AUTO_COMPACT_FAILURES) {
			this._emit({
				type: "compaction_end",
				reason,
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage: `Auto-compaction skipped: ${this._consecutiveAutoCompactFailures} consecutive failures (max ${AgentSession.MAX_CONSECUTIVE_AUTO_COMPACT_FAILURES}). Try /compact-force or restart the session.`,
			});
			return false;
		}

		const settings = this.settingsManager.getCompactionSettings();

		this._emit({ type: "compaction_start", reason });
		this._autoCompactionAbortController = new AbortController();

		try {
			if (!this.model) {
				this._emit({
					type: "compaction_end",
					reason,
					result: undefined,
					aborted: false,
					willRetry: false,
				});
				return false;
			}

			let apiKey: string | undefined;
			let headers: Record<string, string> | undefined;
			if (this.agent.streamFn === streamSimple) {
				const authResult = await this._modelRegistry.getApiKeyAndHeaders(this.model);
				if (!authResult.ok || !authResult.apiKey) {
					this._emit({
						type: "compaction_end",
						reason,
						result: undefined,
						aborted: false,
						willRetry: false,
					});
					return false;
				}
				apiKey = authResult.apiKey;
				headers = authResult.headers;
			} else {
				({ apiKey, headers } = await this._getCompactionRequestAuth(this.model));
			}

			const pathEntries = this.sessionManager.getBranch();

			const preparation = prepareCompaction(pathEntries, settings);
			if (!preparation) {
				this._emit({
					type: "compaction_end",
					reason,
					result: undefined,
					aborted: false,
					willRetry: false,
				});
				return false;
			}

			let extensionCompaction: CompactionResult | undefined;
			let fromExtension = false;

			if (this._extensionRunner.hasHandlers("session_before_compact")) {
				const extensionResult = (await this._extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions: undefined,
					signal: this._autoCompactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (extensionResult?.cancel) {
					this._emit({
						type: "compaction_end",
						reason,
						result: undefined,
						aborted: true,
						willRetry: false,
					});
					return false;
				}

				if (extensionResult?.compaction) {
					extensionCompaction = extensionResult.compaction;
					fromExtension = true;
				}
			}

			let summary: string;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let details: unknown;

			if (extensionCompaction) {
				// Extension provided compaction content
				summary = extensionCompaction.summary;
				firstKeptEntryId = extensionCompaction.firstKeptEntryId;
				tokensBefore = extensionCompaction.tokensBefore;
				details = extensionCompaction.details;
			} else {
				// Generate compaction result with streaming retry
				let compactResult: CompactionResult | undefined;
				let lastError: Error | undefined;
				for (let attempt = 0; attempt <= AgentSession.MAX_COMPACT_STREAMING_RETRIES; attempt++) {
					try {
						compactResult = await compact(
							preparation,
							this.model,
							apiKey,
							headers,
							undefined,
							this._autoCompactionAbortController!.signal,
							this.thinkingLevel,
							this.agent.streamFn,
						);
						break;
					} catch (err) {
						lastError = err instanceof Error ? err : new Error(String(err));
						if (this._autoCompactionAbortController!.signal.aborted) break;
						if (attempt < AgentSession.MAX_COMPACT_STREAMING_RETRIES) {
							console.debug(
								`[compaction] streaming retry ${attempt + 1}/${AgentSession.MAX_COMPACT_STREAMING_RETRIES}: ${lastError.message}`,
							);
						}
					}
				}
				if (!compactResult) throw lastError ?? new Error("Compaction failed after retries");
				summary = compactResult.summary;
				firstKeptEntryId = compactResult.firstKeptEntryId;
				tokensBefore = compactResult.tokensBefore;
				details = compactResult.details;
			}

			if (this._autoCompactionAbortController.signal.aborted) {
				this._emit({
					type: "compaction_end",
					reason,
					result: undefined,
					aborted: true,
					willRetry: false,
				});
				return false;
			}

			this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension);
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.state.messages = sessionContext.messages;

			// Get the saved compaction entry for the extension event
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this._extensionRunner && savedCompactionEntry) {
				await this._extensionRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromExtension,
				});
			}

			const result: CompactionResult = {
				summary,
				firstKeptEntryId,
				tokensBefore,
				details,
			};
			this._consecutiveAutoCompactFailures = 0;
			this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

			if (willRetry) {
				// Remove trailing assistant error messages so agent.continue() can proceed.
				// buildSessionContext() may include multiple error messages from previous
				// overflow attempts — we need to strip all of them.
				const messages = this.agent.state.messages;
				while (
					messages.length > 0 &&
					messages[messages.length - 1].role === "assistant" &&
					(messages[messages.length - 1] as AssistantMessage).stopReason === "error"
				) {
					messages.pop();
				}
				return true;
			}

			// Threshold compaction: queue a continuation prompt so the agent resumes
			// after compression. continue() throws when the last message is assistant
			// with no queued messages, so we inject a followUp to unblock it.
			// The _skipNextThresholdCheck flag prevents the next _handlePostAgentRun
			// from immediately re-compacting.
			if (reason === "threshold") {
				this.agent.followUp({
					role: "user",
					content: [{ type: "text", text: "Continue with the previous task." }],
					timestamp: Date.now(),
				});
				return true;
			}

			// Auto-compaction can complete while follow-up/steering/custom messages are waiting.
			// Continue once so queued messages are delivered.
			return this.agent.hasQueuedMessages();
		} catch (error) {
			this._consecutiveAutoCompactFailures++;
			const errorMessage = error instanceof Error ? error.message : "compaction failed";
			this._emit({
				type: "compaction_end",
				reason,
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage:
					reason === "overflow"
						? `Context overflow recovery failed: ${errorMessage}`
						: `Auto-compaction failed: ${errorMessage}`,
			});
			return false;
		} finally {
			this._autoCompactionAbortController = undefined;
		}
	}

	/**
	 * Toggle auto-compaction setting.
	 */
	setAutoCompactionEnabled(enabled: boolean): void {
		this.settingsManager.setCompactionEnabled(enabled);
	}

	/** Whether auto-compaction is enabled */
	get autoCompactionEnabled(): boolean {
		return this.settingsManager.getCompactionEnabled();
	}

	async bindExtensions(bindings: ExtensionBindings): Promise<void> {
		if (bindings.uiContext !== undefined) {
			this._extensionUIContext = bindings.uiContext;
		}
		if (bindings.mode !== undefined) {
			this._extensionMode = bindings.mode;
		}
		if (bindings.commandContextActions !== undefined) {
			this._extensionCommandContextActions = bindings.commandContextActions;
		}
		if (bindings.abortHandler !== undefined) {
			this._extensionAbortHandler = bindings.abortHandler;
		}
		if (bindings.shutdownHandler !== undefined) {
			this._extensionShutdownHandler = bindings.shutdownHandler;
		}
		if (bindings.onError !== undefined) {
			this._extensionErrorListener = bindings.onError;
		}
		if (bindings.registerChannel !== undefined) {
			this._registerChannel = bindings.registerChannel;
			this._extensionRunner.flushPendingChannels(bindings.registerChannel);
			this._extensionRunner.updateRegisterChannel(bindings.registerChannel);
		}

		this._applyExtensionBindings(this._extensionRunner);
		await this._extensionRunner.emit(this._sessionStartEvent);
		await this.extendResourcesFromExtensions(this._sessionStartEvent.reason === "reload" ? "reload" : "startup");
		await this._initMcpServers(bindings.mcpManagerFrom);
	}

	get mcpManager(): McpManager | undefined {
		return this._mcpManager;
	}

	private async _initMcpServers(reuseFrom?: AgentSession): Promise<void> {
		// 子代理进程跳过 MCP 连接（环境变量 PI_SKIP_MCP=1）
		// 避免 multiple CLI 进程竞争同一个 stdio MCP server 导致死锁
		if (process.env.PI_SKIP_MCP === "1") return;

		// Same-cwd session switch: adopt the previous session's manager as-is.
		// Connections (stdio children, HTTP sessions) stay alive across the
		// switch — full reconnect-all costs seconds per switch. Settings changes
		// still go through reload (full rebuild path).
		if (reuseFrom?.mcpManager) {
			this._mcpManager = reuseFrom.mcpManager;
			reuseFrom._mcpManager = undefined;
			// Re-wire the connection-change listener to the new session
			this._mcpManager.setOnConnectionChange((conn: McpConnection) => {
				this._handleMcpConnectionChange(conn);
			});
			this._registerMcpTools();
			return;
		}

		// Dispose any existing MCP manager (e.g., on reload)
		if (this._mcpManager) {
			await this._mcpManager.dispose();
			this._mcpManager = undefined;
		}
		this._mcpToolNames = new Set();

		const mcpSettings = this.settingsManager.getMcpSettings();
		const servers = mcpSettings.servers;
		if (!servers || Object.keys(servers).length === 0) return;

		this._mcpManager = new McpManager({
			...mcpSettings.options,
			onConnectionChange: (conn: McpConnection) => {
				this._handleMcpConnectionChange(conn);
			},
		});

		await this._mcpManager.connectAll(servers as UnknownRecord as Record<string, McpServerConfig>);

		// Register discovered tools into the extension system
		this._registerMcpTools();
	}

	private _registerMcpTools(): void {
		if (!this._mcpManager) return;
		const tools = this._mcpManager.getAllTools();
		this._mcpToolNames = new Set(tools.map((tool) => tool.fullName));
		for (const tool of tools) {
			const definition = createMcpToolDefinition(tool, this._mcpManager);
			this._customTools = [...(this._customTools ?? []), definition];
		}
		// Rebuild tool registry to include MCP tools
		this._refreshToolRegistry({
			activeToolNames: this.getActiveToolNames(),
			includeAllExtensionTools: true,
		});
	}

	private _handleMcpConnectionChange(conn: McpConnection): void {
		// Emit as a custom event for the RPC layer to forward to the frontend
		for (const listener of this._eventListeners) {
			try {
				listener({
					type: "mcp_connection_change",
					server: {
						name: conn.name,
						status: conn.status,
						error: conn.error,
						tools: conn.tools,
					},
				} as unknown as AgentSessionEvent);
			} catch {}
		}
	}

	private async extendResourcesFromExtensions(reason: "startup" | "reload"): Promise<void> {
		if (!this._extensionRunner.hasHandlers("resources_discover")) {
			return;
		}

		const { skillPaths, promptPaths, themePaths } = await this._extensionRunner.emitResourcesDiscover(
			this._cwd,
			reason,
		);

		if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
			return;
		}

		const extensionPaths: ResourceExtensionPaths = {
			skillPaths: this.buildExtensionResourcePaths(skillPaths),
			promptPaths: this.buildExtensionResourcePaths(promptPaths),
			themePaths: this.buildExtensionResourcePaths(themePaths),
		};

		this._resourceLoader.extendResources(extensionPaths);
		this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
		this.agent.state.systemPrompt = this._baseSystemPrompt;
	}

	private buildExtensionResourcePaths(entries: Array<{ path: string; extensionPath: string }>): Array<{
		path: string;
		metadata: PathMetadata;
	}> {
		return entries.map((entry) => {
			const source = this.getExtensionSourceLabel(entry.extensionPath);
			const baseDir = entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath);
			return {
				path: entry.path,
				metadata: {
					source,
					scope: "temporary",
					origin: "top-level",
					baseDir,
				},
			};
		});
	}

	private getExtensionSourceLabel(extensionPath: string): string {
		if (extensionPath.startsWith("<")) {
			return `extension:${extensionPath.replace(/[<>]/g, "")}`;
		}
		const base = basename(extensionPath);
		const name = base.replace(/\.(ts|js)$/, "");
		return `extension:${name}`;
	}

	private _applyExtensionBindings(runner: ExtensionRunner): void {
		runner.setUIContext(this._extensionUIContext, this._extensionMode);
		runner.bindCommandContext(this._extensionCommandContextActions);
		this.sessionManager.setOnEntryAppended((entry) => {
			if (entry.type === "deletion") {
				this._emitEntriesInvalidated(entry.targetIds, "deletion", entry.id);
				return;
			}
			if (entry.type === "segment_summary") {
				this._emitEntriesInvalidated(entry.targetIds, "segment_summary", entry.id);
			}
		});
		const projectRoot = resolveProjectIdentity(this._cwd);
		runner.setContextDirFns({
			getProjectRoot: () => projectRoot,
			getSessionDataDir: (extName: string) =>
				getSessionDataDir(this.sessionManager.getSessionDir(), this.sessionManager.getSessionId(), extName),
			getProjectDataDir: (extName: string) => getProjectDataDir(projectRoot, extName),
			getCwdDataDir: (extName: string) => getCwdDataDir(this._cwd, extName),
			getGlobalDataDir: (extName: string) => getGlobalDataDir(extName),
		});

		this._extensionErrorUnsubscriber?.();
		this._extensionErrorUnsubscriber = this._extensionErrorListener
			? runner.onError(this._extensionErrorListener)
			: undefined;
	}

	private _refreshCurrentModelFromRegistry(): void {
		const currentModel = this.model;
		if (!currentModel) {
			return;
		}

		const refreshedModel = this._modelRegistry.find(currentModel.provider, currentModel.id);
		if (!refreshedModel || refreshedModel === currentModel) {
			return;
		}

		this.agent.state.model = refreshedModel;
	}

	private _bindExtensionCore(runner: ExtensionRunner): void {
		const getCommands = (): SlashCommandInfo[] => {
			const extensionCommands: SlashCommandInfo[] = runner.getRegisteredCommands().map((command) => ({
				name: command.invocationName,
				description: command.description,
				source: "extension",
				sourceInfo: command.sourceInfo,
			}));

			const templates: SlashCommandInfo[] = this.promptTemplates.map((template) => ({
				name: template.name,
				description: template.description,
				source: "prompt",
				sourceInfo: template.sourceInfo,
			}));

			const skills: SlashCommandInfo[] = this._resourceLoader.getSkills().skills.map((skill) => ({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
				sourceInfo: skill.sourceInfo,
			}));

			return [...extensionCommands, ...templates, ...skills];
		};

		runner.bindCore(
			{
				sendMessage: (message, options) => {
					this.sendCustomMessage(message, options).catch((err) => {
						runner.emitError({
							extensionPath: "<runtime>",
							event: "send_message",
							error: err instanceof Error ? err.message : String(err),
						});
					});
				},
				sendUserMessage: (content, options) => {
					this.sendUserMessage(content, options).catch((err) => {
						runner.emitError({
							extensionPath: "<runtime>",
							event: "send_user_message",
							error: err instanceof Error ? err.message : String(err),
						});
					});
				},
				appendEntry: (customType, data) => {
					const id = this.sessionManager.appendCustomEntry(customType, data);
					this._emit({ type: "custom_entry", customType, data, id });
				},
				deleteEntries: (targetIds) => {
					this.sessionManager.appendDeletion(targetIds);
					this.agent.state.messages = this.sessionManager.buildSessionContext().messages;
				},
				summarizeEntries: (targetIds, summary) => {
					this.sessionManager.appendSegmentSummary(targetIds, summary);
					this.agent.state.messages = this.sessionManager.buildSessionContext().messages;
				},
				setSessionName: (name) => {
					this.setSessionName(name);
				},
				getSessionName: () => {
					return this.sessionManager.getSessionName();
				},
				setLabel: (entryId, label) => {
					this.sessionManager.appendLabelChange(entryId, label);
				},
				getActiveTools: () => this.getActiveToolNames(),
				getAllTools: () => this.getAllTools(),
				setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
				refreshTools: () => this._refreshToolRegistry(),
				setToolOperationsProvider: (provider) => {
					this.toolOperationsProvider = provider;
				},
				getToolOperationsProvider: () => this.toolOperationsProvider,
				getCommands,
				setModel: async (model) => {
					if (!this.modelRegistry.hasConfiguredAuth(model)) return false;
					await this.setModel(model);
					return true;
				},
				getThinkingLevel: () => this.thinkingLevel,
				setThinkingLevel: (level) => this.setThinkingLevel(level),
				registerChannel:
					this._registerChannel ??
					((name: string) => {
						throw new Error(`registerChannel("${name}") is only available in RPC mode`);
					}),
				callLLM: (options) => this.callLLM(options),
			},
			{
				getModel: () => this.model,
				isIdle: () => !this.isStreaming,
				isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
				getSignal: () => this.agent.signal,
				abort: () => {
					if (this._extensionAbortHandler) {
						this._extensionAbortHandler();
						return;
					}
					void this.abort();
				},
				hasPendingMessages: () => this.pendingMessageCount > 0,
				shutdown: () => {
					this._extensionShutdownHandler?.();
				},
				getContextUsage: () => this.getContextUsage(),
				compact: (options) => {
					void (async () => {
						try {
							const result = await this.compact(options?.customInstructions);
							options?.onComplete?.(result);
						} catch (error) {
							const err = error instanceof Error ? error : new Error(String(error));
							options?.onError?.(err);
						}
					})();
				},
				getSystemPrompt: () => this.systemPrompt,
				getSystemPromptOptions: () => this._baseSystemPromptOptions,
				getSettings: () => this.settingsManager.getSettings(),
			},
			{
				registerProvider: (name, config) => {
					this._modelRegistry.registerProvider(name, config);
					this._refreshCurrentModelFromRegistry();
				},
				unregisterProvider: (name) => {
					this._modelRegistry.unregisterProvider(name);
					this._refreshCurrentModelFromRegistry();
				},
			},
		);
	}

	async callLLM(options: CallLLMOptions): Promise<string> {
		const model = this.model;
		if (!model) {
			throw new Error("No model selected");
		}
		if (options.signal?.aborted) {
			throw new Error("Aborted");
		}

		const context: Context = {
			systemPrompt: options.systemPrompt ?? "",
			messages: toCallLlmMessages(options.messages, model),
		};
		const tools = options.tools
			?.map((name) => this._toolRegistry.get(name) ?? this._createBuiltinTool(name))
			.filter((tool): tool is AgentTool => tool !== undefined);

		if (!tools || tools.length === 0) {
			const stream = await this.agent.streamFn(model, context, {
				maxTokens: options.maxTokens,
				signal: options.signal,
				sessionId: this.sessionId,
				reasoning: this.thinkingLevel === "off" ? undefined : this.thinkingLevel,
			});
			const response = await stream.result();
			return textFromAssistantMessage(response);
		}

		const agent = new CoreAgent({
			initialState: {
				systemPrompt: options.systemPrompt ?? "",
				model,
				thinkingLevel: "off",
				tools,
			},
			convertToLlm: this.agent.convertToLlm,
			streamFn: this.agent.streamFn,
			sessionId: this.sessionId,
			transport: this.agent.transport,
			thinkingBudgets: this.agent.thinkingBudgets,
			maxRetryDelayMs: this.agent.maxRetryDelayMs,
		});

		const abort = () => agent.abort();
		options.signal?.addEventListener("abort", abort, { once: true });
		let resultText = "";
		let turnIndex = 0;
		const unsubscribe = agent.subscribe((event) => {
			if (event.type === "turn_end") {
				turnIndex++;
				if (options.maxTurns !== undefined && options.maxTurns > 0 && turnIndex >= options.maxTurns) {
					agent.abort();
				}
				return;
			}
			if (event.type !== "message_end" || event.message.role !== "assistant") {
				return;
			}
			resultText = textFromAssistantMessage(event.message);
		});

		try {
			await agent.prompt(options.messages[0]?.content ?? "");
		} finally {
			unsubscribe();
			options.signal?.removeEventListener("abort", abort);
		}

		return resultText;
	}

	private _createBuiltinTool(name: string): AgentTool | undefined {
		if (!this._baseToolDefinitions.has(name)) {
			return undefined;
		}
		try {
			return createTool(name as ToolName, this._cwd, toolsOptionsFromProvider(this.toolOperationsProvider ?? {}));
		} catch {
			return undefined;
		}
	}

	private _refreshToolRegistry(options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void {
		const previousRegistryNames = new Set(this._toolRegistry.keys());
		const previousActiveToolNames = this.getActiveToolNames();
		const allowedToolNames = this._allowedToolNames;
		const excludedToolNames = this._excludedToolNames;
		const isAllowedTool = (name: string): boolean =>
			(!allowedToolNames || allowedToolNames.has(name)) && !excludedToolNames?.has(name);

		const registeredTools = this._extensionRunner.getAllRegisteredTools();
		const allCustomTools = [
			...registeredTools,
			...this._customTools.map((definition) => ({
				definition,
				sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
			})),
		].filter((tool) => isAllowedTool(tool.definition.name));
		const definitionRegistry = new Map<string, ToolDefinitionEntry>(
			Array.from(this._baseToolDefinitions.entries())
				.filter(([name]) => isAllowedTool(name))
				.map(([name, definition]) => [
					name,
					{
						definition,
						sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" }),
					},
				]),
		);
		for (const tool of allCustomTools) {
			definitionRegistry.set(tool.definition.name, {
				definition: tool.definition,
				sourceInfo: tool.sourceInfo,
			});
		}
		this._toolDefinitions = definitionRegistry;
		this._toolPromptSnippets = new Map(
			Array.from(definitionRegistry.values())
				.map(({ definition }) => {
					const snippet = this._normalizePromptSnippet(definition.promptSnippet);
					return snippet ? ([definition.name, snippet] as const) : undefined;
				})
				.filter((entry): entry is readonly [string, string] => entry !== undefined),
		);
		this._toolPromptGuidelines = new Map(
			Array.from(definitionRegistry.values())
				.map(({ definition }) => {
					const guidelines = this._normalizePromptGuidelines(definition.promptGuidelines);
					return guidelines.length > 0 ? ([definition.name, guidelines] as const) : undefined;
				})
				.filter((entry): entry is readonly [string, string[]] => entry !== undefined),
		);
		const runner = this._extensionRunner;
		const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
		const wrappedBuiltInTools = wrapRegisteredTools(
			Array.from(this._baseToolDefinitions.values())
				.filter((definition) => isAllowedTool(definition.name))
				.map((definition) => ({
					definition,
					sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
				})),
			runner,
		);

		const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
		for (const tool of wrappedExtensionTools as AgentTool[]) {
			toolRegistry.set(tool.name, tool);
		}
		this._toolRegistry = toolRegistry;

		const nextActiveToolNames = (
			options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]
		).filter((name) => isAllowedTool(name));

		if (allowedToolNames) {
			for (const toolName of this._toolRegistry.keys()) {
				if (allowedToolNames.has(toolName)) {
					nextActiveToolNames.push(toolName);
				}
			}
		} else if (options?.includeAllExtensionTools) {
			for (const tool of wrappedExtensionTools) {
				nextActiveToolNames.push(tool.name);
			}
		} else if (!options?.activeToolNames) {
			for (const toolName of this._toolRegistry.keys()) {
				if (!previousRegistryNames.has(toolName)) {
					nextActiveToolNames.push(toolName);
				}
			}
		}

		this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
	}

	private _createBaseToolDefinitions(): Record<string, ToolDefinition> {
		const autoResizeImages = this.settingsManager.getImageAutoResize();
		const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
		const shellPath = this.settingsManager.getShellPath();
		const providerOptions = this._toolOperationsProvider
			? toolsOptionsFromProvider(this._toolOperationsProvider)
			: {};

		const baseDefs: Record<string, ToolDefinition> = this._baseToolsOverride
			? Object.fromEntries(
					Object.entries(this._baseToolsOverride).map(([name, tool]) => [
						name,
						createToolDefinitionFromAgentTool(tool),
					]),
				)
			: createAllToolDefinitions(this._cwd, {
					read: { autoResizeImages, ...providerOptions.read },
					bash: { commandPrefix: shellCommandPrefix, shellPath, ...providerOptions.bash },
					write: providerOptions.write,
					edit: providerOptions.edit,
					grep: providerOptions.grep,
					find: providerOptions.find,
					ls: providerOptions.ls,
				});

		// Register skill tool with access to resource loader
		const skills = this._resourceLoader.getSkills().skills;
		if (skills.length > 0) {
			const subtaskContext: SubtaskContext = {
				modelRegistry: this._modelRegistry,
				resourceLoader: this._resourceLoader,
				model: this.model ?? this._modelRegistry.getAvailable()[0],
				getApiKey: (provider: string) => {
					const auth = this._modelRegistry.authStorage.get(provider);
					return auth?.type === "api_key" ? auth.key : undefined;
				},
				cwd: this._cwd,
				messages: this.agent.state.messages,
			};
			baseDefs.skill = createSkillToolDefinition({
				getSkills: () => this._resourceLoader.getSkills().skills,
				registerSkillHooks: (skill) => this._registerSkillHooks(skill),
				subtaskContext,
				onSubtaskEvent: (subtaskId, label, inner) => {
					const id = this.sessionManager.appendCustomEntry("subtask_progress", {
						subtaskId,
						label,
						eventType: inner.type,
						data: inner,
					});
					this._emit({
						type: "custom_entry",
						customType: "subtask_progress",
						data: { subtaskId, label, eventType: inner.type, data: inner },
						id,
					});
				},
				onSubtaskComplete: (subtaskId, label, result) => {
					const id = this.sessionManager.appendCustomEntry("subtask", {
						subtaskId,
						label,
						success: result.success,
						text: result.text,
						error: result.error,
						startedAt: result.startedAt,
						completedAt: result.completedAt,
					});
					this._emit({ type: "custom_entry", customType: "subtask", data: { subtaskId, label, ...result }, id });
				},
			}) as ToolDefinition;
		}

		return baseDefs;
	}

	private _buildRuntime(options: {
		activeToolNames?: string[];
		flagValues?: Map<string, boolean | string>;
		includeAllExtensionTools?: boolean;
	}): void {
		const baseToolDefinitions = this._createBaseToolDefinitions();

		this._baseToolDefinitions = new Map(
			Object.entries(baseToolDefinitions).map(([name, tool]) => [name, tool as ToolDefinition]),
		);

		const extensionsResult = this._resourceLoader.getExtensions();
		if (options.flagValues) {
			for (const [name, value] of options.flagValues) {
				extensionsResult.runtime.flagValues.set(name, value);
			}
		}

		this._extensionRunner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			this._cwd,
			this.sessionManager,
			this._modelRegistry,
		);
		if (this._extensionRunnerRef) {
			this._extensionRunnerRef.current = this._extensionRunner;
		}
		this._bindExtensionCore(this._extensionRunner);
		this._applyExtensionBindings(this._extensionRunner);
		this._initFileSnapshotManager();
		this._extensionRunner.setFileSnapshotManagerFn(() => this._fileSnapshotManager);
		this._extensionRunner.setPermissionModeFn(() => this._permissionMode);
		this._extensionRunner.setPermissionAskFn((request, input) => this._askPermission(request, input ?? {}));

		const defaultActiveToolNames = this._baseToolsOverride
			? Object.keys(this._baseToolsOverride)
			: this._resourceLoader.getSkills().skills.length > 0
				? ["read", "bash", "edit", "write", "skill"]
				: ["read", "bash", "edit", "write"];
		const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
		this._refreshToolRegistry({
			activeToolNames: baseActiveToolNames,
			includeAllExtensionTools: options.includeAllExtensionTools,
		});
	}

	async reload(): Promise<void> {
		const previousFlagValues = this._extensionRunner.getFlagValues();
		await emitSessionShutdownEvent(this._extensionRunner, { type: "session_shutdown", reason: "reload" });
		await this.settingsManager.reload();
		this._modelRegistry.authStorage.reload();
		this._modelRegistry.refresh();
		this._refreshCurrentModelFromRegistry();
		this.syncQueueModesFromSettings();
		resetApiProviders();
		await this._resourceLoader.reload();
		this._buildRuntime({
			activeToolNames: this.getActiveToolNames(),
			flagValues: previousFlagValues,
			includeAllExtensionTools: true,
		});

		const hasBindings =
			this._extensionUIContext ||
			this._extensionCommandContextActions ||
			this._extensionShutdownHandler ||
			this._extensionErrorListener;
		if (hasBindings) {
			await this._extensionRunner.emit({ type: "session_start", reason: "reload" });
			await this.extendResourcesFromExtensions("reload");
			await this._initMcpServers();
		}
	}

	// =========================================================================
	// Auto-Retry
	// =========================================================================

	private _isNonRetryableProviderLimitError(errorMessage: string): boolean {
		return /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient[_ ]?balance|insufficient_quota|out of budget|quota exceeded|billing|\b402\b/i.test(
			errorMessage,
		);
	}

	/**
	 * Check if an error is retryable (overloaded, rate limit, server errors).
	 * Context overflow errors are NOT retryable (handled by compaction instead).
	 */
	private _isRetryableError(message: AssistantMessage): boolean {
		if (message.stopReason !== "error" || !message.errorMessage) return false;

		// Context overflow is handled by compaction, not retry
		const contextWindow = this.model?.contextWindow ?? 0;
		if (isContextOverflow(message, contextWindow)) return false;

		const err = message.errorMessage;
		if (this._isNonRetryableProviderLimitError(err)) return false;
		// Match: overloaded_error, provider returned error, rate limit, 429, 500, 502, 503, 504, service unavailable, network/connection errors (including connection lost), WebSocket transport closes/errors, fetch failed, premature stream endings, HTTP/2 closed before response, terminated, retry delay exceeded
		return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
			err,
		);
	}

	/**
	 * Prepare a retryable error for continuation with exponential backoff.
	 * @returns true if the caller should continue the agent, false otherwise
	 */
	private async _prepareRetry(message: AssistantMessage): Promise<boolean> {
		const settings = this.settingsManager.getRetrySettings();
		if (!settings.enabled) {
			return false;
		}

		this._retryAttempt++;

		if (this._retryAttempt > settings.maxRetries) {
			// Preserve the completed attempt count so post-run handling can emit the final failure.
			this._retryAttempt--;
			return false;
		}

		const delayMs = Math.min(settings.baseDelayMs * 2 ** (this._retryAttempt - 1), settings.maxDelayMs);

		this._emit({
			type: "auto_retry_start",
			attempt: this._retryAttempt,
			maxAttempts: settings.maxRetries,
			delayMs,
			errorMessage: message.errorMessage || "Unknown error",
		});

		// Remove error message from agent state (keep in session for history)
		const messages = this.agent.state.messages;
		if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
			this.agent.state.messages = messages.slice(0, -1);
		}

		// Wait with exponential backoff (abortable)
		this._retryAbortController = new AbortController();
		try {
			await sleep(delayMs, this._retryAbortController.signal);
		} catch {
			// Aborted during sleep - emit end event so UI can clean up
			const attempt = this._retryAttempt;
			this._retryAttempt = 0;
			this._emit({
				type: "auto_retry_end",
				success: false,
				attempt,
				finalError: "Retry cancelled",
			});
			return false;
		} finally {
			this._retryAbortController = undefined;
		}

		return true;
	}

	/**
	 * Cancel in-progress retry.
	 */
	abortRetry(): void {
		this._retryAbortController?.abort();
	}

	/** Whether auto-retry is currently in progress */
	get isRetrying(): boolean {
		return this._retryAbortController !== undefined;
	}

	/** Whether auto-retry is enabled */
	get autoRetryEnabled(): boolean {
		return this.settingsManager.getRetryEnabled();
	}

	/**
	 * Toggle auto-retry setting.
	 */
	setAutoRetryEnabled(enabled: boolean): void {
		this.settingsManager.setRetryEnabled(enabled);
	}

	// =========================================================================
	// Bash Execution
	// =========================================================================

	/**
	 * Execute a bash command.
	 * Adds result to agent context and session.
	 * @param command The bash command to execute
	 * @param onChunk Optional streaming callback for output
	 * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
	 * @param options.operations Custom BashOperations for remote execution
	 */
	async executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { excludeFromContext?: boolean; operations?: BashOperations },
	): Promise<BashResult> {
		this._bashAbortController = new AbortController();

		// Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
		const prefix = this.settingsManager.getShellCommandPrefix();
		const shellPath = this.settingsManager.getShellPath();
		const resolvedCommand = prefix ? `${prefix}\n${command}` : command;

		try {
			const result = await executeBashWithOperations(
				resolvedCommand,
				this.sessionManager.getCwd(),
				options?.operations ?? this._toolOperationsProvider?.bash ?? createLocalBashOperations({ shellPath }),
				{
					onChunk,
					signal: this._bashAbortController.signal,
				},
			);

			this.recordBashResult(command, result, options);
			return result;
		} finally {
			this._bashAbortController = undefined;
		}
	}

	/**
	 * Record a bash execution result in session history.
	 * Used by executeBash and by extensions that handle bash execution themselves.
	 */
	recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void {
		const bashMessage: BashExecutionMessage = {
			role: "bashExecution",
			command,
			output: result.output,
			exitCode: result.exitCode,
			cancelled: result.cancelled,
			truncated: result.truncated,
			fullOutputPath: result.fullOutputPath,
			timestamp: Date.now(),
			excludeFromContext: options?.excludeFromContext,
		};

		// If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
		if (this.isStreaming) {
			// Queue for later - will be flushed on agent_end
			this._pendingBashMessages.push(bashMessage);
		} else {
			// Add to agent state immediately
			this.agent.state.messages.push(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}
	}

	/**
	 * Cancel running bash command.
	 */
	abortBash(): void {
		this._bashAbortController?.abort();
	}

	/** Whether a bash command is currently running */
	get isBashRunning(): boolean {
		return this._bashAbortController !== undefined;
	}

	/** Whether there are pending bash messages waiting to be flushed */
	get hasPendingBashMessages(): boolean {
		return this._pendingBashMessages.length > 0;
	}

	/**
	 * Flush pending bash messages to agent state and session.
	 * Called after agent turn completes to maintain proper message ordering.
	 */
	private _flushPendingBashMessages(): void {
		if (this._pendingBashMessages.length === 0) return;

		for (const bashMessage of this._pendingBashMessages) {
			// Add to agent state
			this.agent.state.messages.push(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}

		this._pendingBashMessages = [];
	}

	// =========================================================================
	// Session Management
	// =========================================================================

	/**
	 * Set a display name for the current session.
	 */
	setSessionName(name: string): void {
		this.sessionManager.appendSessionInfo(name);
		this._emit({ type: "session_info_changed", name: this.sessionManager.getSessionName() });
	}

	// =========================================================================
	// Tree Navigation
	// =========================================================================

	/**
	 * Navigate to a different node in the session tree.
	 * Unlike fork() which creates a new session file, this stays in the same file.
	 *
	 * @param targetId The entry ID to navigate to
	 * @param options.summarize Whether user wants to summarize abandoned branch
	 * @param options.customInstructions Custom instructions for summarizer
	 * @param options.replaceInstructions If true, customInstructions replaces the default prompt
	 * @param options.label Label to attach to the branch summary entry
	 * @returns Result with editorText (if user message) and cancelled status
	 */
	async navigateTree(
		targetId: string,
		options: {
			summarize?: boolean;
			customInstructions?: string;
			replaceInstructions?: boolean;
			label?: string;
			skipFiles?: boolean;
		} = {},
	): Promise<{
		editorText?: string;
		cancelled: boolean;
		aborted?: boolean;
		summaryEntry?: BranchSummaryEntry;
		reason?: string;
	}> {
		const oldLeafId = this.sessionManager.getLeafId();

		// No-op if already at target
		if (targetId === oldLeafId) {
			return { cancelled: false };
		}

		// Model required for summarization
		if (options.summarize && !this.model) {
			throw new Error("No model available for summarization");
		}

		const targetEntry = this.sessionManager.getEntry(targetId);
		if (!targetEntry) {
			throw new Error(`Entry ${targetId} not found`);
		}

		// Collect entries to summarize (from old leaf to common ancestor)
		const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
			this.sessionManager,
			oldLeafId,
			targetId,
		);

		// Prepare event data - mutable so extensions can override
		let customInstructions = options.customInstructions;
		let replaceInstructions = options.replaceInstructions;
		let label = options.label;

		const preparation: TreePreparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize,
			userWantsSummary: options.summarize ?? false,
			customInstructions,
			replaceInstructions,
			label,
		};

		// Set up abort controller for summarization
		this._branchSummaryAbortController = new AbortController();

		try {
			let extensionSummary: { summary: string; details?: unknown } | undefined;
			let fromExtension = false;

			// Emit session_before_tree event
			if (this._extensionRunner.hasHandlers("session_before_tree")) {
				const result = (await this._extensionRunner.emit({
					type: "session_before_tree",
					preparation,
					signal: this._branchSummaryAbortController.signal,
				})) as SessionBeforeTreeResult | undefined;

				if (result?.cancel) {
					return { cancelled: true };
				}

				if (result?.summary && options.summarize) {
					extensionSummary = result.summary;
					fromExtension = true;
				}

				// Allow extensions to override instructions and label
				if (result?.customInstructions !== undefined) {
					customInstructions = result.customInstructions;
				}
				if (result?.replaceInstructions !== undefined) {
					replaceInstructions = result.replaceInstructions;
				}
				if (result?.label !== undefined) {
					label = result.label;
				}
			}

			// Run default summarizer if needed
			let summaryText: string | undefined;
			let summaryDetails: unknown;
			if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
				const model = this.model!;
				const { apiKey, headers } = await this._getRequiredRequestAuth(model);
				const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
				const result = await generateBranchSummary(entriesToSummarize, {
					model,
					apiKey,
					headers,
					signal: this._branchSummaryAbortController.signal,
					customInstructions,
					replaceInstructions,
					reserveTokens: branchSummarySettings.reserveTokens,
					streamFn: this.agent.streamFn,
				});
				if (result.aborted) {
					return { cancelled: true, aborted: true };
				}
				if (result.error) {
					throw new Error(result.error);
				}
				summaryText = result.summary;
				summaryDetails = {
					readFiles: result.readFiles || [],
					modifiedFiles: result.modifiedFiles || [],
				};
			} else if (extensionSummary) {
				summaryText = extensionSummary.summary;
				summaryDetails = extensionSummary.details;
			}

			// Determine the new leaf position based on target type
			let newLeafId: string | null;
			let editorText: string | undefined;

			if (targetEntry.type === "message" && targetEntry.message.role === "user") {
				// User message: skip custom ancestors, then leaf = first non-custom ancestor.
				newLeafId = this.sessionManager.findBranchPointAbove(targetId);
				editorText = this._extractUserMessageText(targetEntry.message.content);
			} else if (targetEntry.type === "custom_message") {
				// Custom message: skip custom ancestors, then leaf = first non-custom ancestor.
				newLeafId = this.sessionManager.findBranchPointAbove(targetId);
				editorText =
					typeof targetEntry.content === "string"
						? targetEntry.content
						: targetEntry.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("");
			} else {
				// Non-user message: leaf = selected node
				newLeafId = targetId;
			}

			if (options.skipFiles !== true) {
				const userMessageCount = this.sessionManager.countUserMessagesOnPath(newLeafId);
				if (userMessageCount === 0) {
					return {
						cancelled: true,
						reason: `Navigation to "${targetId}" would remove all user messages and restore files to their pre-session state. Use message-only rollback (skipFiles: true) to undo without file changes.`,
					};
				}
			}

			// Switch leaf (with or without summary)
			// Summary is attached at the navigation target position (newLeafId), not the old branch
			let summaryEntry: BranchSummaryEntry | undefined;
			if (summaryText) {
				// Create summary at target position (can be null for root)
				const summaryId = this.sessionManager.branchWithSummary(
					newLeafId,
					summaryText,
					summaryDetails,
					fromExtension,
				);
				summaryEntry = this.sessionManager.getEntry(summaryId) as BranchSummaryEntry;

				// Attach label to the summary entry
				if (label) {
					this.sessionManager.appendLabelChange(summaryId, label);
				}
			} else if (newLeafId === null) {
				// No summary, navigating to root - reset leaf
				this.sessionManager.resetLeaf();
			} else {
				// No summary, navigating to non-root
				this.sessionManager.branch(newLeafId);
			}

			// Attach label to target entry when not summarizing (no summary entry to label)
			if (label && !summaryText) {
				this.sessionManager.appendLabelChange(targetId, label);
			}

			// Update agent state
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.state.messages = sessionContext.messages;

			if (this._fileSnapshotManager && options.skipFiles !== true) {
				await this._fileSnapshotManager.restoreFiles(this._cwd, {
					targetEntryId: newLeafId ?? undefined,
					currentLeafId: oldLeafId,
					entries: this.sessionManager.getEntries(),
				});
			}

			// Emit session_tree event
			await this._extensionRunner.emit({
				type: "session_tree",
				newLeafId: this.sessionManager.getLeafId(),
				oldLeafId,
				summaryEntry,
				fromExtension: summaryText ? fromExtension : undefined,
				skipFiles: options.skipFiles === true,
			});

			// Emit to custom tools

			return { editorText, cancelled: false, summaryEntry };
		} finally {
			this._branchSummaryAbortController = undefined;
		}
	}

	/**
	 * Get all user messages from session for fork selector.
	 */
	getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
		const entries = this.sessionManager.getEntries();
		const result: Array<{ entryId: string; text: string }> = [];

		for (const entry of entries) {
			if (entry.type !== "message") continue;
			if (entry.message.role !== "user") continue;

			const text = this._extractUserMessageText(entry.message.content);
			if (text) {
				result.push({ entryId: entry.id, text });
			}
		}

		return result;
	}

	private _extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
		}
		return "";
	}

	/**
	 * Get session statistics.
	 */
	getSessionStats(): SessionStats {
		const entries = this.sessionManager.getEntries();
		const messages = entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
		const userMessages = messages.filter((m) => m.role === "user").length;
		const assistantMessages = messages.filter((m) => m.role === "assistant").length;
		const toolResults = messages.filter((m) => m.role === "toolResult").length;

		let toolCalls = 0;
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		return {
			sessionFile: this.sessionFile,
			sessionId: this.sessionId,
			userMessages,
			assistantMessages,
			toolCalls,
			toolResults,
			totalMessages: messages.length,
			tokens: {
				input: totalInput,
				output: totalOutput,
				cacheRead: totalCacheRead,
				cacheWrite: totalCacheWrite,
				total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
			},
			cost: totalCost,
			contextUsage: this.getContextUsage(),
		};
	}

	getContextUsage(): ContextUsage | undefined {
		const model = this.model;
		if (!model) return undefined;

		const contextWindow = model.contextWindow ?? 0;
		if (contextWindow <= 0) return undefined;

		const materializedMessages = this.sessionManager.buildSessionContext().messages;
		const contextMessages = materializedMessages.length > 0 ? materializedMessages : this.messages;
		const latestCompactionTimestamp = this._getLatestCompactionTimestamp();
		const breakdown = this._buildContextUsageBreakdown(contextMessages, latestCompactionTimestamp);
		const breakdownTokens = this._sumContextUsageBreakdownTokens(breakdown);
		// Always read from the session branch — this.agent.state.messages may
		// be empty right after process startup (before the first prompt()),
		// which would cause context usage to report near-zero tokens even
		// for sessions with thousands of messages on disk.
		const providerRequest = this._getLatestProviderRequestContextUsage(latestCompactionTimestamp);

		// Find the last assistant message with valid usage from the materialized
		// context. Matching inside one message array avoids relying on Usage object
		// identity, which can change after restart or JSONL re-materialization.
		// This is authoritative — the provider tells us exactly how many
		// input tokens the model consumed.
		let lastUsage: Usage | undefined;
		let lastUsageMessageIndex = -1;
		for (let i = contextMessages.length - 1; i >= 0; i--) {
			const message = contextMessages[i];
			if (message.role !== "assistant") continue;
			const assistant = message;
			if (assistant.stopReason === "aborted" || assistant.stopReason === "error") continue;
			if (!assistant.usage) continue;
			if (!this._isTimestampAfterLatestCompaction(assistant.timestamp, latestCompactionTimestamp)) continue;
			lastUsage = assistant.usage;
			lastUsageMessageIndex = i;
			break;
		}

		if (lastUsage) {
			// Count trailing messages (after the last assistant with usage)
			// to estimate tokens added since that response.
			let trailingTokens = 0;
			for (let i = lastUsageMessageIndex + 1; i < contextMessages.length; i++) {
				trailingTokens += estimateTokens(contextMessages[i]);
			}
			const contextTokens = calculateInputContextTokens(lastUsage) + trailingTokens;
			const tokens = Math.max(contextTokens, breakdownTokens > 0 ? 1 : 0);
			const percent = (tokens / contextWindow) * 100;
			const reconciledBreakdown = this._reconcileContextUsageBreakdown(breakdown, tokens, {
				usage: lastUsage,
				trailingTokens,
			});
			return {
				tokens,
				contextWindow,
				percent,
				breakdown: reconciledBreakdown,
				...(providerRequest ? { providerRequest } : {}),
			};
		}

		// No usage data at all — use breakdown estimate
		const tokens = breakdownTokens;
		const percent = (tokens / contextWindow) * 100;
		const reconciledBreakdown = this._reconcileContextUsageBreakdown(breakdown, tokens, undefined);
		return {
			tokens,
			contextWindow,
			percent,
			breakdown: reconciledBreakdown,
			...(providerRequest ? { providerRequest } : {}),
		};
	}

	private _getLatestCompactionTimestamp(): number | null {
		const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
		if (!compactionEntry) return null;
		const timestamp = new Date(compactionEntry.timestamp).getTime();
		return Number.isFinite(timestamp) ? timestamp : null;
	}

	private _isTimestampAfterLatestCompaction(
		timestamp: number | string | undefined,
		latestCompactionTimestamp: number | null,
	): boolean {
		if (latestCompactionTimestamp === null) return true;
		const value = typeof timestamp === "number" ? timestamp : timestamp ? new Date(timestamp).getTime() : NaN;
		return Number.isFinite(value) && value > latestCompactionTimestamp;
	}

	private _getLatestProviderRequestContextUsage(
		latestCompactionTimestamp: number | null = this._getLatestCompactionTimestamp(),
	): ProviderRequestContextUsage | undefined {
		const branchEntries = this.sessionManager.getBranch();
		for (let i = branchEntries.length - 1; i >= 0; i--) {
			const entry = branchEntries[i];
			if (entry.type !== "custom" || entry.customType !== "provider_request_context_usage") continue;
			const data = (entry as CustomEntry).data as ProviderRequestContextUsage | undefined;
			if (data?.version === 1 && typeof data.payloadChars === "number") {
				const timestamp = data.timestamp ?? (entry as CustomEntry).timestamp;
				if (!this._isTimestampAfterLatestCompaction(timestamp, latestCompactionTimestamp)) continue;
				return data;
			}
		}
		return undefined;
	}

	private _sumContextUsageBreakdownTokens(breakdown: ContextUsageBreakdownItem[]): number {
		return breakdown.reduce((sum, item) => sum + item.tokens, 0);
	}

	private _reconcileContextUsageBreakdown(
		breakdown: ContextUsageBreakdownItem[],
		totalTokens: number | null | undefined,
		evidence?: { usage?: Usage; trailingTokens?: number },
	): ContextUsageBreakdownItem[] {
		if (!totalTokens || totalTokens <= 0) return breakdown;
		const knownTokens = this._sumContextUsageBreakdownTokens(breakdown);
		if (knownTokens > totalTokens) {
			const capped = breakdown.map((item) => ({ ...item }));
			let excess = knownTokens - totalTokens;
			for (let i = capped.length - 1; i >= 0 && excess > 0; i--) {
				const item = capped[i];
				if (!item.id.startsWith("provider_") || item.tokens <= 0) continue;
				const reduction = Math.min(item.tokens, excess);
				item.tokens -= reduction;
				excess -= reduction;
			}
			return capped;
		}
		const unclassifiedTokens = Math.max(0, totalTokens - knownTokens);
		if (unclassifiedTokens <= 0) return breakdown;
		return [
			...breakdown,
			{
				id: "unclassified",
				label: "未归因差额",
				tokens: unclassifiedTokens,
				source: "core",
				estimated: true,
				details: [
					...(evidence?.usage
						? [
								{ label: "Provider input", tokens: evidence.usage.input },
								{ label: "Provider cacheRead", tokens: evidence.usage.cacheRead },
								{ label: "Provider cacheWrite", tokens: evidence.usage.cacheWrite },
							]
						: []),
					...(evidence?.trailingTokens ? [{ label: "本地尾部估算", tokens: evidence.trailingTokens }] : []),
					{ label: "本地已归因合计", tokens: knownTokens },
					{ label: "差额", tokens: unclassifiedTokens },
				].filter((item) => item.tokens > 0),
			},
		];
	}

	private _buildContextUsageBreakdown(
		messages: AgentMessage[] = this.messages,
		latestCompactionTimestamp: number | null = this._getLatestCompactionTimestamp(),
	): ContextUsageBreakdownItem[] {
		const systemBreakdown = { ...this._baseSystemPromptBreakdown };
		const currentSystemPrompt = this.agent.state.systemPrompt || this._baseSystemPrompt;
		const extraSystemChars = Math.max(0, currentSystemPrompt.length - this._baseSystemPrompt.length);
		systemBreakdown.systemBaseChars += extraSystemChars;
		const toolDefinitionChars = this._estimateActiveToolDefinitionChars();
		const providerRequest = this._getLatestProviderRequestContextUsage(latestCompactionTimestamp);

		const messageTokens = {
			conversation: 0,
			thinking: 0,
			toolInputs: 0,
			toolOutputs: 0,
			memory: 0,
			rules: 0,
			lsp: 0,
		};

		for (const message of messages) {
			if (message.role === "assistant") {
				const assistantTokens = estimateAssistantMessageParts(message, this.model);
				messageTokens.conversation += assistantTokens.conversation;
				messageTokens.thinking += assistantTokens.thinking;
				messageTokens.toolInputs += assistantTokens.toolInputs;
				continue;
			}
			if (message.role === "toolResult") {
				// Provider serializes as: {"role":"tool","content":"...","tool_call_id":"..."}
				// Measured structure overhead: ~46 chars (role, content wrapper, tool_call_id field)
				// plus tool_call_id content (not counted by content chars).
				const contentChars = getMessageText(message).length;
				const toolCallIdChars = (message.toolCallId ?? "").length;
				const provider = identifyProvider(this.model);
				messageTokens.toolOutputs +=
					estimateContentTokensFromChars(contentChars, provider) + estimateCharsAsTokens(46 + toolCallIdChars);
				continue;
			}
			// Provider serializes as: {"role":"user","content":"..."} or {"role":"user","content":[...]}
			// Measured structure overhead: ~28 chars (role label, content wrapper).
			const category = classifyContextMessage(message);
			const contentChars = getMessageText(message).length;
			const provider = identifyProvider(this.model);
			messageTokens[category] += estimateContentTokensFromChars(contentChars, provider) + estimateCharsAsTokens(28);
		}

		const compaction = this._getContextUsageCompactionInfo();
		const systemTokens = estimateCharsAsTokens(systemBreakdown.systemBaseChars);
		const contextFileTokens = estimateCharsAsTokens(systemBreakdown.contextFilesChars);
		const skillTokens = estimateCharsAsTokens(systemBreakdown.skillsChars);
		const agentTokens = estimateCharsAsTokens(systemBreakdown.agentsChars);
		const builtinAndExtensionToolTokens = estimateCharsAsTokens(toolDefinitionChars.builtinAndExtensionChars);
		const mcpToolTokens = estimateCharsAsTokens(toolDefinitionChars.mcpChars);
		const providerToolInputTokens = providerToolInteractionTokens(providerRequest, "input");
		const providerToolOutputTokens = providerToolInteractionTokens(providerRequest, "output");
		// When provider tool interaction data is available, it gives content-only tokens.
		// Add per-interaction JSON structure overhead (tool_call wrapper / tool_result wrapper)
		// that the provider's content-only estimate misses.
		const toolInteractionInputCount =
			providerRequest?.toolInteractions?.reduce((sum, t) => sum + t.inputCount, 0) ?? 0;
		const toolInteractionOutputCount =
			providerRequest?.toolInteractions?.reduce((sum, t) => sum + t.outputCount, 0) ?? 0;
		const toolInputTokens =
			providerToolInputTokens > 0
				? providerToolInputTokens + estimateCharsAsTokens(toolInteractionInputCount * 65)
				: messageTokens.toolInputs;
		const toolOutputTokens =
			providerToolOutputTokens > 0
				? providerToolOutputTokens + estimateCharsAsTokens(toolInteractionOutputCount * 46)
				: messageTokens.toolOutputs;
		const localMessageTokens =
			messageTokens.conversation +
			messageTokens.thinking +
			toolInputTokens +
			toolOutputTokens +
			messageTokens.memory +
			messageTokens.rules +
			messageTokens.lsp;
		const localSystemTokens = systemTokens + contextFileTokens + skillTokens + agentTokens;
		const localToolTokens = builtinAndExtensionToolTokens + mcpToolTokens;
		// openai-completions 系（DeepSeek/OpenAI 等）把 system prompt 放在 messages[0]
		// (role:"system")，而不是顶层 system key。此时 provider 快照的 system section 为空
		// （JSON.stringify(null) = 4 chars → 1 token），但 messages section 包含了 system
		// prompt 内容。而 localSystemTokens 已经被归入 system_base/skills/agents breakdown 项，
		// 如果不对 messages section 做修正，system prompt 会被 messages delta 双重归因（虚高）。
		// 判定依据：当 provider system section tokens ≤ 1（只有 null/空值）时，说明 system
		// prompt 不在独立 system key 里，而是混在了 messages 中。
		const providerSystemSectionTokens = providerSectionTokens(providerRequest, "system");
		const systemPromptInMessages = providerSystemSectionTokens <= 1;
		const providerDeltas = {
			system: positiveDeltaTokens(providerSystemSectionTokens, localSystemTokens),
			messages: positiveDeltaTokens(
				providerSectionTokens(providerRequest, "messages") - (systemPromptInMessages ? localSystemTokens : 0),
				localMessageTokens,
			),
			tools: positiveDeltaTokens(providerSectionTokens(providerRequest, "tools"), localToolTokens),
			options: providerSectionTokens(providerRequest, "options"),
		};

		return [
			{
				id: "system_base",
				label: "系统提示词",
				tokens: systemTokens,
				source: "core",
				estimated: true,
			},
			{
				id: "tools",
				label: "内置/扩展工具定义",
				tokens: builtinAndExtensionToolTokens,
				source: "core",
				estimated: true,
			},
			{
				id: "mcp_tools",
				label: "MCP 工具定义",
				tokens: mcpToolTokens,
				source: "extension",
				estimated: true,
			},
			{
				id: "context_files",
				label: "项目上下文文件",
				tokens: contextFileTokens,
				source: "core",
				estimated: true,
			},
			{
				id: "skills",
				label: "Skills",
				tokens: skillTokens,
				source: "core",
				estimated: true,
			},
			{
				id: "agents",
				label: "Agents",
				tokens: agentTokens,
				source: "core",
				estimated: true,
			},
			{
				id: "conversation",
				label: "对话历史",
				tokens: messageTokens.conversation,
				source: "core",
				estimated: true,
				...(compaction ? { compaction } : {}),
			},
			{
				id: "tool_inputs",
				label: "工具输入/调用参数",
				tokens: toolInputTokens,
				source: "core",
				estimated: true,
			},
			{
				id: "tool_outputs",
				label: "工具输出/结果",
				tokens: toolOutputTokens,
				source: "core",
				estimated: true,
			},
			{
				id: "thinking",
				label: "思考",
				tokens: messageTokens.thinking,
				source: "core",
				estimated: true,
			},
			{
				id: "memory",
				label: "记忆",
				tokens: messageTokens.memory,
				source: "extension",
				estimated: true,
			},
			{
				id: "rules",
				label: "规则",
				tokens: messageTokens.rules,
				source: "extension",
				estimated: true,
			},
			{
				id: "lsp",
				label: "LSP 诊断",
				tokens: messageTokens.lsp,
				source: "extension",
				estimated: true,
			},
			{
				id: "provider_system",
				label: "Provider 系统包装/转换差额",
				tokens: providerDeltas.system,
				source: "core",
				estimated: true,
			},
			{
				id: "provider_messages",
				label: "Provider 消息包装/转换差额",
				tokens: providerDeltas.messages,
				source: "core",
				estimated: true,
			},
			{
				id: "provider_tools",
				label: "Provider 工具 schema 差额",
				tokens: providerDeltas.tools,
				source: "core",
				estimated: true,
			},
			{
				id: "provider_options",
				label: "Provider 选项/元数据",
				tokens: providerDeltas.options,
				source: "core",
				estimated: true,
			},
		];
	}

	private _estimateActiveToolDefinitionChars(): { builtinAndExtensionChars: number; mcpChars: number } {
		let builtinAndExtensionChars = 0;
		let mcpChars = 0;

		for (const name of this.getActiveToolNames()) {
			const definition = this._toolDefinitions.get(name)?.definition;
			if (!definition) continue;
			const text = [
				definition.name,
				definition.label,
				definition.description,
				definition.promptSnippet,
				...(definition.promptGuidelines ?? []),
				JSON.stringify(definition.parameters ?? {}),
			]
				.filter((part): part is string => typeof part === "string" && part.length > 0)
				.join("\n");

			if (this._mcpToolNames.has(name)) {
				mcpChars += text.length;
			} else {
				builtinAndExtensionChars += text.length;
			}
		}

		return { builtinAndExtensionChars, mcpChars };
	}

	private _getContextUsageCompactionInfo(): ContextUsageBreakdownItem["compaction"] | undefined {
		let count = 0;
		let tokensBefore = 0;
		let summaryTokens = 0;

		for (const entry of this.sessionManager.getBranch()) {
			if (entry.type !== "compaction") continue;
			count++;
			tokensBefore += entry.tokensBefore;
			summaryTokens += estimateCharsAsTokens(entry.summary.length);
		}

		if (count === 0) {
			return undefined;
		}

		return {
			count,
			tokensBefore,
			summaryTokens,
			estimatedSavedTokens: Math.max(0, tokensBefore - summaryTokens),
		};
	}

	/**
	 * Export session to HTML.
	 * @param outputPath Optional output path (defaults to session directory)
	 * @returns Path to exported file
	 */
	async exportToHtml(outputPath?: string): Promise<string> {
		const themeName = this.settingsManager.getTheme();

		// Create tool renderer if we have an extension runner (for custom tool HTML rendering)
		const toolRenderer: ToolHtmlRenderer = createToolHtmlRenderer({
			getToolDefinition: (name) => this.getToolDefinition(name),
			theme,
			cwd: this.sessionManager.getCwd(),
		});

		return await exportSessionToHtml(this.sessionManager, this.state, {
			outputPath,
			themeName,
			toolRenderer,
		});
	}

	/**
	 * Export the current session branch to a JSONL file.
	 * Writes the session header followed by all entries on the current branch path.
	 * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
	 * @returns The resolved output file path.
	 */
	exportToJsonl(outputPath?: string): string {
		const filePath = resolvePath(
			outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
			process.cwd(),
		);
		const dir = dirname(filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: this.sessionManager.getSessionId(),
			timestamp: new Date().toISOString(),
			cwd: this.sessionManager.getCwd(),
		};

		const branchEntries = this.sessionManager.getBranch();
		const lines = [JSON.stringify(header)];

		// Re-chain parentIds to form a linear sequence
		let prevId: string | null = null;
		for (const entry of branchEntries) {
			const linear = { ...entry, parentId: prevId };
			lines.push(JSON.stringify(linear));
			prevId = entry.id;
		}

		writeFileSync(filePath, `${lines.join("\n")}\n`);
		return filePath;
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Get text content of last assistant message.
	 * Useful for /copy command.
	 * @returns Text content, or undefined if no assistant message exists
	 */
	getLastAssistantText(): string | undefined {
		const lastAssistant = this.messages
			.slice()
			.reverse()
			.find((m) => {
				if (m.role !== "assistant") return false;
				const msg = m as AssistantMessage;
				// Skip aborted messages with no content
				if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
				return true;
			});

		if (!lastAssistant) return undefined;

		let text = "";
		for (const content of (lastAssistant as AssistantMessage).content) {
			if (content.type === "text") {
				text += content.text;
			}
		}

		return text.trim() || undefined;
	}

	async previewRollback(targetId: string): Promise<{
		restored: string[];
		deleted: string[];
		skipped: string[];
		dirty: string[];
		forceRestored: string[];
	}> {
		if (this.isStreaming) {
			throw new Error("Cannot rollback while agent is streaming");
		}
		if (!this._fileSnapshotManager) {
			return { restored: [], deleted: [], skipped: [], dirty: [], forceRestored: [] };
		}

		const targetEntry = this.sessionManager.getEntry(targetId);
		if (!targetEntry) {
			throw new Error(`Entry ${targetId} not found`);
		}

		const newLeafId =
			(targetEntry.type === "message" && targetEntry.message.role === "user") ||
			targetEntry.type === "custom_message"
				? this.sessionManager.findBranchPointAbove(targetId)
				: targetId;

		return this._fileSnapshotManager.restoreFiles(this._cwd, {
			targetEntryId: newLeafId ?? undefined,
			currentLeafId: this.sessionManager.getLeafId(),
			entries: this.sessionManager.getEntries(),
			preview: true,
		});
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	createReplacedSessionContext(): ReplacedSessionContext {
		const context = Object.defineProperties(
			{},
			Object.getOwnPropertyDescriptors(this._extensionRunner.createCommandContext()),
		) as ReplacedSessionContext;
		context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
		context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
		return context;
	}

	/**
	 * Check if extensions have handlers for a specific event type.
	 */
	hasExtensionHandlers(eventType: string): boolean {
		return this._extensionRunner.hasHandlers(eventType);
	}

	/**
	 * Get the extension runner (for setting UI context and error handlers).
	 */
	get extensionRunner(): ExtensionRunner {
		return this._extensionRunner;
	}
}
