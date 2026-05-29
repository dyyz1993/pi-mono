import { createTypedChannel, type ExtensionAPI, type ToolResultEvent, type BeforeAgentStartEvent } from "@dyyz1993/pi-coding-agent";
import type { MatcherGroup, HookHandler } from "./types.js";
import { loadConfigs, loadConfigSources, type ConfigSource } from "./config-loader.js";
import { matchesMatcher } from "./matcher.js";
import { matchesIfClause } from "./if-parser.js";
import { buildStdinData } from "./stdin-builder.js";
import { runHandler, interpretHookOutput } from "./handler-runner.js";
import { RingBuffer, extractSnippet, computeRuleStats, type HookLogEntry, type HookLogResult, type HookConfigSnapshot, truncateMiddle } from "./hooks-log.js";
import { HOOKS_CHANNEL_NAME, type HooksChannelContract } from "./channel-contract.js";

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

	pi.on("session_start", async (_event, ctx) => {
		configs = loadConfigs(ctx.cwd);
		configSources = loadConfigSources(ctx.cwd);
		const sm = (ctx as unknown as { sessionManager?: { getSessionId?: () => string } }).sessionManager;
		currentSessionId = sm?.getSessionId?.()
			?? (((ctx as unknown) as Record<string, unknown>).variables as Record<string, unknown> | undefined)?.session_id as string | undefined;
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
		await processHookEvent("SubagentStop", { toolName: "", input: {} }, ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await processHookEvent("Stop", { toolName: "", input: {} }, ctx);
	});

	async function processHookEvent(
		hookEventName: string,
		event: { toolName: string; input: Record<string, unknown>; toolCallId?: string; toolOutput?: string },
		ctx: { cwd: string; hasUI: boolean },
	): Promise<{ block: boolean; reason: string } | undefined> {
		if (!currentSessionId) {
			const sm = (ctx as unknown as { sessionManager?: { getSessionId?: () => string } }).sessionManager;
			const fromSm = sm?.getSessionId?.();
			if (fromSm) currentSessionId = fromSm;
		}

		const groups = configs.get(hookEventName) ?? [];
		if (groups.length === 0) return undefined;

		const ctxVars = ((ctx as unknown) as Record<string, unknown>).variables as Record<string, unknown> | undefined;
		const agentType = (ctxVars?.role ?? ctxVars?.agent_type) as string | undefined;
		const stdinData = buildStdinData(hookEventName, {
			toolName: event.toolName,
			toolInput: event.input,
			toolOutput: event.toolOutput,
			toolUseId: event.toolCallId,
			cwd: ctx.cwd,
			agentType,
		});

		for (const group of groups) {
			if (!matchesMatcher(group.matcher, event.toolName)) continue;



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
								source: (group.__source__ ?? "unknown") as "global" | "local" | "policy" | "project" | "unknown",
								snippet: extractSnippet(event.input),
							};
							logBuffer.push(entry);
							channel.emit("hook_executed", entry);
							if (decision === "block") channel.emit("hook_blocked", entry);

							if (output.exitCode === 3 && result.shouldBlock) {
								pi.sendMessage({
									customType: "hook_ask_no_ui",
									content: `Hook requires confirmation but is running in async mode: ${result.reason}`,
									display: true,
								});
							} else if (handler.asyncRewake && output.exitCode === 2 && result.reason) {
								pi.sendMessage({
									customType: "hook_async_block",
									content: result.reason,
									display: true,
								});
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
					source: (group.__source__ ?? "unknown") as "global" | "local" | "policy" | "project" | "unknown",
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
							const confirmResult = await uiCtx.confirm(
								`${toolLabel} 确认`,
								question,
								{
									toolCallId: event.toolCallId,
									hookMeta: {
										toolName: event.toolName,
										matcher: group.matcher ?? "*",
										command,
										reason: question,
									},
								},
							) as boolean | { confirmed: boolean };
							const confirmed = typeof confirmResult === "object" ? confirmResult.confirmed : !!confirmResult;
						if (confirmed) {
								entry.decision = "allow";
								return undefined;
							}
							return { block: true, reason: `[hook] User denied: ${question}` };
						}
						return { block: true, reason: `[hook] Confirmation required (no UI available): ${question}` };
					}
					return { block: true, reason: result.reason };
				}

				if (result.updatedInput) {
					Object.assign(event.input, result.updatedInput);
				}
			}
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
