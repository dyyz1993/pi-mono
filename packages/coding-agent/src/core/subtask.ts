/**
 * runSubtask() - kernel primitive for running an isolated subtask in-memory.
 *
 * Creates a new AgentSession with its own context and runs a single prompt,
 * collecting the result. The session is always disposed, even on error.
 */

import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { Agent } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, Message, Model } from "@dyyz1993/pi-ai";
import { AgentSession, type AgentSessionEvent } from "./agent-session.ts";
import type { AgentConfig } from "./agent-types.ts";
import { discoverAgents } from "./agent-types.ts";
import { createExtensionRuntime } from "./extensions/loader.ts";
import { convertToLlm } from "./messages.ts";
import type { ModelRegistry } from "./model-registry.ts";
import { resolveModelAlias } from "./model-resolver.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { SessionManager } from "./session-manager.ts";
import { SettingsManager } from "./settings-manager.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SubtaskOptions {
	/** Task description (required). */
	task: string;
	/** Agent name to look up from Agent.md files. */
	agent?: string;
	/** Direct AgentConfig (alternative to agent name lookup). */
	agentConfig?: AgentConfig;
	/** Model ID or tier keyword ("fast" / "pro" / "max"). */
	model?: string;
	/** Max agent turns. */
	maxTurns?: number;
	/** Tool whitelist. */
	tools?: string[];
	/** Tool blacklist. */
	disallowedTools?: string[];
	/** Working directory (defaults to parent session's cwd). */
	cwd?: string;
	/** Inherit parent session tools (default: true). */
	inheritTools?: boolean;
	/** Inherit parent session history (default: false). */
	inheritHistory?: boolean;
	/** Inherit parent session extensions (default: true). */
	inheritExtensions?: boolean;
	/** Optional callback invoked for every child session event (for transparency/streaming). */
	onEvent?: (event: AgentSessionEvent) => void;
}

export interface SubtaskContext {
	/** Parent session's model registry. */
	modelRegistry: ModelRegistry;
	/** Parent session's resource loader. */
	resourceLoader: ResourceLoader;
	/** Parent session's model. */
	model: Model<string>;
	/** Parent session's API key resolver. */
	getApiKey: (provider: string) => string | undefined;
	/** Parent session's cwd. */
	cwd: string;
	/** Optional: parent session's messages to copy when inheritHistory is true. */
	messages?: AgentMessage[];
	/** Optional: parent session's system prompt to use as base. */
	systemPrompt?: string;
}

export interface SubtaskResult {
	/** Final text result from the subtask. */
	text: string;
	/** Token usage. */
	inputTokens: number;
	outputTokens: number;
	/** Whether the subtask completed normally. */
	success: boolean;
	/** Error message if failed. */
	error?: string;
	/** Start timestamp (epoch ms). */
	startedAt: number;
	/** Completion timestamp (epoch ms). */
	completedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
	return msg.role === "assistant";
}

function createNoExtensionResourceLoader(): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function extractTextFromMessages(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!isAssistantMessage(msg)) continue;

		const content = msg.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const textParts = content.filter(
				(part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string",
			);
			if (textParts.length > 0) return textParts.map((p) => p.text).join("\n");
		}
	}
	return "";
}

/**
 * Resolve a model specifier (tier alias or model ID) to a Model object.
 * Falls back to the parent model if no match is found.
 */
function resolveModel(
	modelSpecifier: string,
	modelRegistry: ModelRegistry,
	tierModels: Record<string, string>,
	fallback: Model<string>,
): Model<string> {
	const allModels = modelRegistry.getAvailable();

	// Try tier alias first (e.g. "fast" -> "claude-sonnet-4-20250514")
	const aliasTarget = resolveModelAlias(modelSpecifier, tierModels);
	const pattern = aliasTarget ?? modelSpecifier;

	// Try exact match on model id across all available models
	const exactMatch = allModels.find((m) => m.id === pattern);
	if (exactMatch) return exactMatch;

	// Try provider/model format
	const slashIndex = pattern.indexOf("/");
	if (slashIndex !== -1) {
		const provider = pattern.substring(0, slashIndex);
		const modelId = pattern.substring(slashIndex + 1);
		const found = modelRegistry.find(provider, modelId);
		if (found) return found;
	}

	// Try substring match on model id
	const substrMatch = allModels.find((m) => m.id.includes(pattern));
	if (substrMatch) return substrMatch;

	return fallback;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function runSubtask(options: SubtaskOptions, context: SubtaskContext): Promise<SubtaskResult> {
	const cwd = options.cwd ?? context.cwd;
	const inheritHistory = options.inheritHistory ?? false;

	// 1. Resolve AgentConfig
	let resolvedConfig: AgentConfig | undefined;

	if (options.agentConfig) {
		resolvedConfig = options.agentConfig;
	} else if (options.agent) {
		const discovery = discoverAgents(cwd, "both");
		const found = discovery.agents.find((a) => a.name === options.agent);
		if (found) {
			resolvedConfig = found;
		}
	}

	// 2. Resolve model
	const modelSpecifier = options.model ?? resolvedConfig?.model;
	const resolvedModel = modelSpecifier
		? resolveModel(modelSpecifier, context.modelRegistry, {}, context.model)
		: context.model;

	// 3. Build system prompt
	const systemPrompt = resolvedConfig?.systemPrompt || context.systemPrompt || "You are a helpful assistant.";

	// 4. Collect inherited history if requested
	let inheritedMessages: AgentMessage[] = [];
	if (inheritHistory && context.messages && context.messages.length > 0) {
		// Only copy standard message types; skip internal types like branch/compaction summaries
		inheritedMessages = context.messages.filter(
			(msg): msg is Message => msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult",
		);
	}

	// 5. Create in-memory session infrastructure
	const sessionManager = SessionManager.inMemory(cwd);
	const settingsManager = SettingsManager.inMemory();

	// 6. Create Agent (seed inherited messages into agent state)
	const agent = new Agent({
		getApiKey: context.getApiKey,
		initialState: {
			model: resolvedModel,
			systemPrompt,
			tools: [],
			messages: inheritedMessages,
		},
		convertToLlm,
	});

	// 7. Create AgentSession (reuse parent's modelRegistry + resourceLoader)
	const inheritExtensions = options.inheritExtensions ?? true;
	const resourceLoader = inheritExtensions ? context.resourceLoader : createNoExtensionResourceLoader();
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd,
		modelRegistry: context.modelRegistry,
		resourceLoader,
		maxTurns: options.maxTurns ?? resolvedConfig?.maxTurns,
	});

	// 8. Apply agent config if resolved
	if (resolvedConfig) {
		session.applyAgentConfig(resolvedConfig);
	}

	// 9. Handle tool inheritance
	if (options.inheritTools === false) {
		session.setActiveToolsByName([]);
	}

	// 10. Override tools if specified
	if (options.tools && options.tools.length > 0) {
		session.setActiveToolsByName(options.tools);
	}
	if (options.disallowedTools && options.disallowedTools.length > 0) {
		const disallowedSet = new Set(options.disallowedTools);
		const current = session.getActiveToolNames();
		session.setActiveToolsByName(current.filter((name) => !disallowedSet.has(name)));
	}

	// 11. Subscribe to events and collect result
	const events: AgentSessionEvent[] = [];
	session.subscribe((event) => {
		events.push(event);
		options.onEvent?.(event);
	});

	let inputTokens = 0;
	let outputTokens = 0;
	const startedAt = Date.now();

	try {
		await session.prompt(options.task);

		// Extract token usage from message_end events
		for (const event of events) {
			if (event.type === "message_end" && isAssistantMessage(event.message)) {
				inputTokens += event.message.usage.input;
				outputTokens += event.message.usage.output;
			}
		}

		// Extract final text from agent_end event
		const agentEndEvent = events.find(
			(e): e is Extract<AgentSessionEvent, { type: "agent_end" }> => e.type === "agent_end" && !e.willRetry,
		);

		const text = agentEndEvent
			? extractTextFromMessages(agentEndEvent.messages)
			: extractTextFromMessages(session.messages);

		return { text, inputTokens, outputTokens, success: true, startedAt, completedAt: Date.now() };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			text: "",
			inputTokens,
			outputTokens,
			success: false,
			error: message,
			startedAt,
			completedAt: Date.now(),
		};
	} finally {
		session.dispose();
	}
}
