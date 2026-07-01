import { randomUUID } from "node:crypto";
import {
	clearSessionHooks,
	createTypedChannel,
	getAllSessionHookGroups,
	getSessionHookGroups,
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type PermissionDecision,
	type PermissionRequest,
	type ToolResultEvent,
} from "@dyyz1993/pi-coding-agent";
import type { MatcherGroup, HookHandler } from "./types.ts";
import { getConfigSignature, loadConfigs, loadConfigSources, type ConfigSource } from "./config-loader.ts";
import { matchesMatcher } from "./matcher.ts";
import { matchesIfClause } from "./if-parser.ts";
import { buildStdinData } from "./stdin-builder.ts";
import { runHandler, interpretHookOutput } from "./handler-runner.ts";
import { RingBuffer, extractSnippet, computeRuleStats, type HookLogEntry, type HookLogResult, type HookConfigSnapshot, truncateMiddle } from "./hooks-log.ts";
import { HOOKS_CHANNEL_NAME, type HooksChannelContract, type SkippedRuleKey } from "./channel-contract.ts";
import type { HookOutput } from "./types.ts";

function matchesPiVariables(
	handler: HookHandler,
	ctxVars: Record<string, unknown> | undefined,
): boolean {
	const piVars = handler["x-pi-variables"];
	if (!piVars || !ctxVars) return true;

	for (const [key, value] of Object.entries(piVars)) {
		const ctxValue = String(ctxVars[key] ?? "");
		const allowedValues = value.split("|");
		if (!allowedValues.includes(ctxValue)) return false;
	}

	return true;
}

export default function (pi: ExtensionAPI) {
	let configs: Map<string, MatcherGroup[]> = new Map();
	const onceHandlers = new Set<string>();

	const RING_BUFFER_CAPACITY = 200;
	const logBuffer = new RingBuffer<HookLogEntry>(RING_BUFFER_CAPACITY);
	let logIdCounter = 0;
	let configSources: ConfigSource[] = [];
	let configSignature = "";
	let runtimeEnabled = true;
	const skippedRules = new Map<string, SkippedRuleKey>();

	let currentSessionId: string | undefined;

	const rawChannel = pi.registerChannel(HOOKS_CHANNEL_NAME);
	const channel = createTypedChannel<HooksChannelContract>(rawChannel).server;

	channel.handle("hooks.getLog", (params: { limit?: number; event?: string }) => {
		let entries = logBuffer.snapshot(params.limit);
		if (params.event) {
			entries = entries.filter(e => e.event === params.event);
		}
		return buildLogResult(entries);
	});

	channel.handle("hooks.getConfig", () => {
		return buildLogResult([]);
	});

	channel.handle("hooks.clear", () => {
		logBuffer.clear();
		return { ok: true };
	});

	channel.handle("hooks.getStatus", () => {
		return { enabled: runtimeEnabled };
	});

	channel.handle("hooks.setEnabled", (params: { enabled: boolean }) => {
		runtimeEnabled = params.enabled;
		return { enabled: runtimeEnabled };
	});

	channel.handle("hooks.skipRule", (params: { event: string; matcher: string }) => {
		const key = `${params.event}::${params.matcher}`;
		skippedRules.set(key, { event: params.event, matcher: params.matcher });
		return { skipped: Array.from(skippedRules.values()) };
	});

	channel.handle("hooks.unskipRule", (params: { event: string; matcher: string }) => {
		const key = `${params.event}::${params.matcher}`;
		skippedRules.delete(key);
		return { skipped: Array.from(skippedRules.values()) };
	});

	channel.handle("hooks.getSkippedRules", () => {
		return { skipped: Array.from(skippedRules.values()) };
	});

	function reloadHookConfigs(cwd: string): void {
		configs = loadConfigs(cwd);
		configSources = loadConfigSources(cwd);
		configSignature = getConfigSignature(cwd);
	}

	pi.on("session_start", async (event, ctx) => {
		reloadHookConfigs(ctx.cwd);
		const sm = (ctx as unknown as { sessionManager?: { getSessionId?: () => string } }).sessionManager;
		currentSessionId = sm?.getSessionId?.()
			?? (((ctx as unknown) as Record<string, unknown>).variables as Record<string, unknown> | undefined)?.session_id as string | undefined;

		// Fire SessionStart hooks (Claude Code compat)
		await processHookEvent("SessionStart", { toolName: "", input: { source: "startup" } }, ctx);

		// Fire Setup hooks on first startup (Claude Code compat)
		// Claude Code: Setup fires on --init or --maintenance
		// pi: no --init flag yet, so we fire Setup on initial startup as approximation
		const startEvent = event as { reason?: string };
		if (startEvent.reason === "startup") {
			await processHookEvent("Setup", { toolName: "", input: { trigger: "init" } }, ctx);
		}
	});

	pi.on("permission_request", async (event, ctx) => {
		// Claude Code compat: PermissionRequest hook fires when permission is needed
		// Executes user-configured PermissionRequest hooks and returns allow/deny
		const result = await processHookEvent("PermissionRequest", {
			toolName: event.toolName,
			input: event.input,
			toolCallId: event.toolCallId,
		}, ctx);
			if (result?.block) {
				return { decision: "deny" as const, message: result.reason };
			}
			if (!result) {
				return undefined;
			}
			// If a matching hook exits 0 (no block), treat as allow
			return { decision: "allow" as const };
		});

	pi.on("tool_call", async (event, ctx) => {
		const result = await processHookEvent("PreToolUse", event, ctx);
		return result;
	});

	pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
		const toolOutput = event.content.map((c) => c.type === "text" ? c.text : "").join("");
		const hookName = event.isError ? "PostToolUseFailure" : "PostToolUse";
		await processHookEvent(hookName, {
			toolName: event.toolName,
			input: event.input ?? {},
			toolCallId: event.toolCallId,
			toolOutput,
		}, ctx);
		return undefined;
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const result = await processHookEvent("UserPromptSubmit", {
			toolName: "",
			input: { prompt: event.prompt ?? "" },
		}, ctx);
		if (result?.block) {
			return { message: { customType: "hook_block", content: result.reason, display: true } };
		}
		return undefined;
	});

	pi.on("session_shutdown", async (event, ctx) => {
		await processHookEvent("SessionEnd", { toolName: "", input: {} }, ctx);
		if (event.reason !== "reload" && currentSessionId) {
			clearSessionHooks(currentSessionId);
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		await processHookEvent("PreCompact", { toolName: "", input: {} }, ctx);
	});

	pi.on("message_start", async (event, ctx) => {
		const messageText = typeof event.message === "object" && event.message !== null && "content" in event.message
			? String((event.message as { content: unknown }).content ?? "")
			: "";
		await processHookEvent("Notification", {
			toolName: "",
			input: { message: messageText },
		}, ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		await processHookEvent("SubagentStart", { toolName: "", input: {} }, ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		const result = await processHookEvent("SubagentStop", { toolName: "", input: {} }, ctx);
		// Claude Code compat: SubagentStop exit 2 continues subagent
		if (result?.block && result.reason) {
			pi.sendMessage(
				{
					customType: "hook_subagent_stop_block",
					content: `SubagentStop hook blocked: ${result.reason}. Continue working.`,
					display: true,
				},
				{ deliverAs: "followUp" },
			);
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		const result = await processHookEvent("Stop", { toolName: "", input: {} }, ctx);
		// Claude Code compat: Stop hook exit 2 continues conversation
		// The block reason is injected as a user message so the model keeps running
		if (result?.block && result.reason) {
			pi.sendMessage(
				{
					customType: "hook_stop_block",
					content: `Stop hook blocked: ${result.reason}. Continue working on the task.`,
					display: true,
				},
				{ deliverAs: "followUp" },
			);
		}
	});

	async function processHookEvent(
		hookEventName: string,
		event: { toolName: string; input: Record<string, unknown>; toolCallId?: string; toolOutput?: string },
		ctx: {
			cwd: string;
			hasUI: boolean;
			permissions?: {
				ask(request: PermissionRequest, input?: Record<string, unknown>): Promise<PermissionDecision>;
			};
		},
	): Promise<{ block: boolean; reason: string } | undefined> {
		if (!runtimeEnabled) return undefined;

		const nextConfigSignature = getConfigSignature(ctx.cwd);
		// Reload configs lazily if not yet loaded, or when project/user hook settings changed.
		if (configs.size === 0 || nextConfigSignature !== configSignature) {
			reloadHookConfigs(ctx.cwd);
		}

		if (!currentSessionId) {
			const sm = (ctx as unknown as { sessionManager?: { getSessionId?: () => string } }).sessionManager;
			const fromSm = sm?.getSessionId?.();
			if (fromSm) currentSessionId = fromSm;
		}

		const groups = [
			...(configs.get(hookEventName) ?? []),
			...getSessionHookGroups(currentSessionId, hookEventName),
		];
		if (groups.length === 0) return undefined;

		const ctxVars = ((ctx as unknown) as Record<string, unknown>).variables as Record<string, unknown> | undefined;
		const agentType = (ctxVars?.role ?? ctxVars?.agent_type) as string | undefined;
		const permissionMode =
			((ctx as unknown as { permissionMode?: string }).permissionMode)
			?? (ctxVars?.permission_mode as string | undefined)
			?? (ctxVars?.permissionMode as string | undefined);
		const sm = (ctx as unknown as { sessionManager?: { getSessionFile?: () => string | undefined } }).sessionManager;
		const transcriptPath = sm?.getSessionFile?.() ?? "";
		const stdinData = buildStdinData(hookEventName, {
			toolName: event.toolName,
			toolInput: event.input,
			toolOutput: event.toolOutput,
			toolUseId: event.toolCallId,
			cwd: ctx.cwd,
			agentType,
			permissionMode,
			transcriptPath,
			sessionId: currentSessionId,
		});

		for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
			const group = groups[groupIndex]!;
			if (!matchesMatcher(group.matcher, event.toolName)) continue;
			const source = getHookSource(group);
			const matcher = group.matcher ?? "*";

			// Skip this rule if it's in the per-rule skip list
			const ruleKey = `${hookEventName}::${matcher}`;
			if (skippedRules.has(ruleKey)) continue;

			for (let i = 0; i < group.hooks.length; i++) {
				const handler = group.hooks[i];
				const onceKey = handlerKey(hookEventName, group, groupIndex, handler, i);

				if (handler.once && onceHandlers.has(onceKey)) continue;
				if (!matchesIfClause(handler.if, event.toolName, event.input)) continue;
				if (!matchesPiVariables(handler, ctxVars)) continue;

				if (handler.once) onceHandlers.add(onceKey);

				const isAsync = handler.async ?? handler.asyncRewake ?? false;
				if (isAsync && hookEventName === "PreToolUse") {
					const runner = getCallLLM(pi);
					const asyncT0 = Date.now();
					runHandler(handler, stdinData, ctx, runner).then((output) => {
						try {
							const asyncDuration = Date.now() - asyncT0;
							const result = interpretHookOutput(output);

							const decision: "allow" | "block" | "ask" =
								result.shouldBlock ? (output.exitCode === 3 ? "ask" : "block") : "allow";
							const entry: HookLogEntry = {
								id: ++logIdCounter,
								timestamp: asyncT0,
								durationMs: asyncDuration,
								event: hookEventName,
								toolName: event.toolName,
								matcher: group.matcher ?? "*",
								hookType: handler.type ?? "command",
								command: truncateMiddle(handler.command ?? handler.url ?? handler.prompt ?? "", 200),
								decision,
								reason: result.reason ?? "",
								exitCode: output.exitCode,
								source,
								snippet: extractSnippet(event.input),
							};
							logBuffer.push(entry);
							channel.emit("hook_executed", entry);
							if (decision === "block") channel.emit("hook_blocked", entry);

							if (output.exitCode === 3 && result.shouldBlock) {
								pi.sendMessage(
									{
										customType: "hook_ask_no_ui",
										content: `Hook requires confirmation but is running in async mode: ${formatHookBlockReason({
											source,
											eventName: hookEventName,
											matcher,
											hookType: handler.type ?? "command",
											reason: result.reason,
										})}`,
										display: true,
									},
									{ deliverAs: "nextTurn" },
								);
							} else if (handler.asyncRewake && output.exitCode === 2 && result.reason) {
								pi.sendMessage(
									{
										customType: "hook_async_block",
										content: formatHookBlockReason({
											source,
											eventName: hookEventName,
											matcher,
											hookType: handler.type ?? "command",
											reason: result.reason,
										}),
										display: true,
									},
									{ deliverAs: "nextTurn" },
								);
							}

							// After prompt hook succeeds in async mode, inject the prompt text into conversation
							if (handler.type === "prompt" && handler.prompt && !result.shouldBlock) {
								pi.sendUserMessage(handler.prompt, { deliverAs: "followUp" });
							}
						} catch {
							// async handler failed (stale session is expected)
						}
					});
					continue;
				}

				const t0 = Date.now();
				const output = await runHandler(handler, stdinData, ctx, getCallLLM(pi));
				const durationMs = Date.now() - t0;
				const result = interpretHookOutput(output);

				const decision: "allow" | "block" | "ask" =
					result.shouldBlock ? (output.exitCode === 3 ? "ask" : "block") : "allow";
				const entry: HookLogEntry = {
					id: ++logIdCounter,
					timestamp: t0,
					durationMs,
					event: hookEventName,
					toolName: event.toolName,
					matcher: group.matcher ?? "*",
					hookType: handler.type ?? "command",
					command: truncateMiddle(handler.command ?? handler.url ?? handler.prompt ?? "", 200),
					decision,
					reason: result.reason ?? "",
					exitCode: output.exitCode,
					source,
					snippet: extractSnippet(event.input),
				};
				logBuffer.push(entry);
				channel.emit("hook_executed", entry);
				if (decision === "block") channel.emit("hook_blocked", entry);

				if (result.shouldBlock) {
					const blockReason = formatHookBlockReason({
						source,
						eventName: hookEventName,
						matcher,
						hookType: handler.type ?? "command",
						reason: result.reason,
					});
					if (output.exitCode === 3) {
						const question = result.reason || "Confirm this operation?";
						if (hookEventName === "PreToolUse" && ctx.permissions?.ask) {
							const toolLabel = formatToolLabel(event.toolName);
							const command = extractCommand(event.input);
							const description = event.toolName === "bash" ? extractDescription(event.input) : undefined;
							const hookCommand = truncateMiddle(handler.command ?? handler.url ?? handler.prompt ?? "", 200);
							const labels = extractConfirmLabels(output);
							const permissionDecision = await ctx.permissions.ask(
								buildHookApprovalRequest({
									sessionId: currentSessionId ?? "unknown",
									toolCallId: event.toolCallId,
									title: `${toolLabel} 确认`,
									message: question,
									toolName: event.toolName,
									matcher: group.matcher ?? "*",
									description,
									command,
									hookCommand,
									eventName: hookEventName,
									source,
									confirmText: labels.confirmText,
									cancelText: labels.cancelText,
								}),
								event.input,
							);
							if (permissionDecision.type === "allow" || permissionDecision.type === "pass") {
								entry.decision = "allow";
								return undefined;
							}
							if (permissionDecision.type === "mutate") {
								for (const key of Object.keys(event.input)) {
									delete event.input[key];
								}
								Object.assign(event.input, permissionDecision.input);
								entry.decision = "allow";
								return undefined;
							}
							if (permissionDecision.type === "deny") {
								return {
									block: true,
									reason: formatHookBlockReason({
										source,
										eventName: hookEventName,
										matcher,
										hookType: handler.type ?? "command",
										reason: permissionDecision.reason,
									}),
								};
							}
							return { block: true, reason: `需要确认但权限请求未完成: ${blockReason}` };
						}
						return { block: true, reason: `需要确认但当前没有可用 UI: ${blockReason}` };
					}
					return { block: true, reason: blockReason };
				}

				if (result.updatedInput) {
					Object.assign(event.input, result.updatedInput);
				}

				// After prompt hook succeeds, inject the prompt text into conversation
				if (handler.type === "prompt" && handler.prompt && !result.shouldBlock) {
					pi.sendUserMessage(handler.prompt, { deliverAs: "followUp" });
				}
			}
		}

		return undefined;
	}

	function extractConfirmLabels(output: HookOutput): { confirmText?: string; cancelText?: string } {
		const parsed = output.parsed ?? parseOutputJson(output.stdout);
		return {
			confirmText: firstString(parsed?.allowText, parsed?.confirmText),
			cancelText: firstString(parsed?.denyText, parsed?.cancelText),
		};
	}

	function parseOutputJson(stdout: string): HookOutput["parsed"] | undefined {
		const trimmed = stdout.trim();
		if (!trimmed.startsWith("{")) return undefined;
		try {
			return JSON.parse(trimmed) as HookOutput["parsed"];
		} catch {
			return undefined;
		}
	}

	function firstString(...values: Array<string | undefined>): string | undefined {
		for (const value of values) {
			const trimmed = value?.trim();
			if (trimmed) return trimmed;
		}
		return undefined;
	}

	function buildLogResult(entries: HookLogEntry[]): HookLogResult {
		return {
			entries,
			ruleStats: computeRuleStats(logBuffer.snapshot()),
			totalExecutions: logBuffer.total,
			configSnapshot: buildConfigSnapshot(),
		};
	}

	function buildConfigSnapshot(): HookConfigSnapshot {
		const events: HookConfigSnapshot["events"] = [];
		const eventsByName = new Map<string, MatcherGroup[]>();
		for (const [eventName, groups] of configs.entries()) {
			eventsByName.set(eventName, [...(eventsByName.get(eventName) ?? []), ...groups]);
		}
		for (const [eventName, groups] of getAllSessionHookGroups(currentSessionId).entries()) {
			eventsByName.set(eventName, [...(eventsByName.get(eventName) ?? []), ...groups]);
		}
		for (const [eventName, groups] of eventsByName.entries()) {
			events.push({
				name: eventName,
				groups: groups.map(g => ({
					matcher: g.matcher ?? "*",
					source: g.__source__ ?? "unknown",
					hooks: g.hooks.map(h => ({
						type: h.type ?? "command",
						command: h.command,
						url: h.url,
						prompt: h.prompt,
						timeout: h.timeout,
						async: h.async,
						once: h.once,
						if: h.if,
					})),
				})),
			});
		}
		return {
			runtimeEnabled,
			skippedRules: Array.from(skippedRules.values()),
			sources: configSources.map(s => ({
				path: s.path,
				scope: s.scope,
				exists: s.exists,
				disabled: s.disabled,
			})),
			events,
		};
	}
}

function handlerKey(
	event: string,
	group: MatcherGroup,
	groupIndex: number,
	handler: HookHandler,
	handlerIndex: number,
): string {
	return JSON.stringify({
		event,
		source: group.__source__ ?? "unknown",
		matcher: group.matcher ?? "*",
		groupIndex,
		handlerIndex,
		type: handler.type,
		command: handler.command,
		prompt: handler.prompt,
		url: handler.url,
		server: handler.server,
		tool: handler.tool,
		if: handler.if,
	});
}

function getHookSource(group: MatcherGroup): string {
	return group.__source__ ?? "unknown";
}

function formatHookBlockReason(input: {
	source: string;
	eventName: string;
	matcher: string;
	hookType: string;
	reason?: string;
}): string {
	const reason = input.reason?.trim() || "Hook blocked";
	return `Hook blocked by ${input.source} (${input.eventName}, matcher ${input.matcher}, ${input.hookType}): ${reason}`;
}

function getCallLLM(pi: ExtensionAPI) {
	return ((pi as unknown) as Record<string, unknown>).callLLM as
		| ((options: {
				systemPrompt?: string;
				messages: { role: "user" | "assistant"; content: string }[];
				tools?: string[];
				maxTurns?: number;
				maxTokens?: number;
				signal?: AbortSignal;
		  }) => Promise<string>)
		| undefined;
}

function extractCommand(input: Record<string, unknown>): string | undefined {
	if (typeof input.command === "string") return input.command;
	if (typeof input.filePath === "string") return input.filePath;
	if (typeof input.path === "string") return input.path;
	if (typeof input.pattern === "string") return input.pattern;
	return undefined;
}

function buildHookApprovalRequest(input: {
	sessionId: string;
	toolCallId?: string;
	title: string;
	message: string;
	toolName: string;
	matcher: string;
	description?: string;
	command?: string;
	hookCommand: string;
	eventName: string;
	source: string;
	confirmText?: string;
	cancelText?: string;
}): PermissionRequest {
	const permissionValue = hookApprovalValue(input, "exact");
	const rulePattern = hookApprovalValue(input, "rule");
	const baseMetadata = {
		provider: "pi-hooks",
		eventName: input.eventName,
		toolName: input.toolName,
		matcher: input.matcher,
		hookCommand: input.hookCommand,
		source: input.source,
	};
	return {
		requestId: `perm_hook_${randomUUID()}`,
		sessionId: input.sessionId,
		toolCallId: input.toolCallId,
		provider: "pi-hooks",
		subject: "hook.approval",
		title: input.title,
		message: input.message,
		actions: ["allow_once", "always_allow_project", "deny_once", "always_deny_project"],
		rememberOptions: [
			{
				id: "allow-hook-exact",
				label: "This exact hook request",
				subject: "hook.approval",
				pattern: permissionValue,
				scope: "project",
				action: "allow",
				metadata: { ...baseMetadata, matchKind: "exact" },
			},
			{
				id: "allow-hook-rule",
				label: "This hook rule",
				subject: "hook.approval",
				pattern: rulePattern,
				scope: "project",
				action: "allow",
				metadata: { ...baseMetadata, matchKind: "rule" },
			},
			{
				id: "deny-hook-exact",
				label: "This exact hook request",
				subject: "hook.approval",
				pattern: permissionValue,
				scope: "project",
				action: "deny",
				metadata: { ...baseMetadata, matchKind: "exact" },
			},
			{
				id: "deny-hook-rule",
				label: "This hook rule",
				subject: "hook.approval",
				pattern: rulePattern,
				scope: "project",
				action: "deny",
				metadata: { ...baseMetadata, matchKind: "rule" },
			},
		],
		metadata: {
			...baseMetadata,
			description: input.description,
			command: input.command,
			permissionValue,
			reason: input.message,
			confirmText: input.confirmText,
			cancelText: input.cancelText,
		},
		createdAt: new Date().toISOString(),
	};
}

function hookApprovalValue(
	input: {
		eventName: string;
		toolName: string;
		matcher: string;
		hookCommand: string;
		command?: string;
	},
	scope: "exact" | "rule",
): string {
	const command = scope === "exact" ? normalizeHookValuePart(input.command ?? "") : "*";
	return [
		input.eventName,
		input.toolName,
		input.matcher,
		input.hookCommand,
		command,
	]
		.map((part) => encodeURIComponent(normalizeHookValuePart(part)))
		.join("|");
}

function normalizeHookValuePart(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function extractDescription(input: Record<string, unknown>): string | undefined {
	if (typeof input.description !== "string") return undefined;
	const description = input.description.trim();
	return description.length > 0 ? description : undefined;
}

function formatToolLabel(toolName: string): string {
	const labels: Record<string, string> = {
		bash: "Bash 命令",
		read: "文件读取",
		write: "文件写入",
		edit: "文件编辑",
		grep: "内容搜索",
		find: "文件搜索",
		ls: "目录列表",
		mcp: "MCP 工具",
	};
	if (labels[toolName]) return labels[toolName];
	return toolName.charAt(0).toUpperCase() + toolName.slice(1);
}
