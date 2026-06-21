import { createTypedChannel, type ExtensionAPI, type ToolResultEvent, type BeforeAgentStartEvent } from "@dyyz1993/pi-coding-agent";
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
	const onceHandlers = new Set<number>();

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
		// If hook exits 0 (no block), treat as allow
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

	pi.on("session_shutdown", async (_event, ctx) => {
		await processHookEvent("SessionEnd", { toolName: "", input: {} }, ctx);
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
		ctx: { cwd: string; hasUI: boolean },
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

		const groups = configs.get(hookEventName) ?? [];
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

		for (const group of groups) {
			if (!matchesMatcher(group.matcher, event.toolName)) continue;

			// Skip this rule if it's in the per-rule skip list
			const ruleKey = `${hookEventName}::${group.matcher ?? "*"}`;
			if (skippedRules.has(ruleKey)) continue;



			for (let i = 0; i < group.hooks.length; i++) {
				const handler = group.hooks[i];

				if (handler.once && onceHandlers.has(handlerIndex(hookEventName, i))) continue;
				if (!matchesIfClause(handler.if, event.toolName, event.input)) continue;
				if (!matchesPiVariables(handler, ctxVars)) continue;

				if (handler.once) onceHandlers.add(handlerIndex(hookEventName, i));

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
								source: (group.__source__ ?? "unknown") as HookLogEntry["source"],
								snippet: extractSnippet(event.input),
							};
							logBuffer.push(entry);
							channel.emit("hook_executed", entry);
							if (decision === "block") channel.emit("hook_blocked", entry);

							if (output.exitCode === 3 && result.shouldBlock) {
								pi.sendMessage(
									{
										customType: "hook_ask_no_ui",
										content: `Hook requires confirmation but is running in async mode: ${result.reason}`,
										display: true,
									},
									{ deliverAs: "nextTurn" },
								);
							} else if (handler.asyncRewake && output.exitCode === 2 && result.reason) {
								pi.sendMessage(
									{
										customType: "hook_async_block",
										content: result.reason,
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
					source: (group.__source__ ?? "unknown") as HookLogEntry["source"],
					snippet: extractSnippet(event.input),
				};
				logBuffer.push(entry);
				channel.emit("hook_executed", entry);
				if (decision === "block") channel.emit("hook_blocked", entry);

				if (result.shouldBlock) {
					if (output.exitCode === 3) {
						const question = result.reason || "Confirm this operation?";
						const uiCtx = ((ctx as Record<string, unknown>).ui) as {
							confirm?: (title: string, message: string, opts?: Record<string, unknown>) => Promise<unknown>;
						} | undefined;
							if (uiCtx?.confirm) {
								const toolLabel = formatToolLabel(event.toolName);
								const command = extractCommand(event.input);
								const description = event.toolName === "bash" ? extractDescription(event.input) : undefined;
								const hookCommand = truncateMiddle(handler.command ?? handler.url ?? handler.prompt ?? "", 200);
								const labels = extractConfirmLabels(output);
								const confirmResult = await uiCtx.confirm(
									`${toolLabel} 确认`,
									question,
									{
										toolCallId: event.toolCallId,
										confirmText: labels.confirmText,
										cancelText: labels.cancelText,
										hookMeta: {
											toolName: event.toolName,
											matcher: group.matcher ?? "*",
											description,
											command,
											hookCommand,
											eventName: hookEventName,
											source: group.__source__ ?? "unknown",
											reason: question,
											confirmText: labels.confirmText,
											cancelText: labels.cancelText,
										},
									},
								) as boolean | { confirmed: boolean };
							const confirmed = typeof confirmResult === "object" ? confirmResult.confirmed : !!confirmResult;
							if (confirmed) {
								entry.decision = "allow";
								return undefined;
							}
							return { block: true, reason: `用户拒绝: ${question}` };
						}
						return { block: true, reason: `需要确认但当前没有可用 UI: ${question}` };
					}
					return { block: true, reason: result.reason };
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
		for (const [eventName, groups] of configs.entries()) {
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

function handlerIndex(event: string, idx: number): number {
	return (hashString(event) * 31 + idx) | 0;
}

function hashString(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0;
	}
	return h;
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
