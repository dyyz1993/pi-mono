import type { ExtensionAPI, ToolResultEvent, BeforeAgentStartEvent } from "@dyyz1993/pi-coding-agent";
import type { MatcherGroup, HookHandler } from "./types.js";
import { loadConfigs } from "./config-loader.js";
import { matchesMatcher } from "./matcher.js";
import { matchesIfClause } from "./if-parser.js";
import { buildStdinData } from "./stdin-builder.js";
import { runHandler, interpretHookOutput } from "./handler-runner.js";

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

	pi.on("session_start", async (_event, ctx) => {
		configs = loadConfigs(ctx.cwd);
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
					runHandler(handler, stdinData, ctx, runner).then((output) => {
						try {
							const result = interpretHookOutput(output);
							if (handler.asyncRewake && output.exitCode === 2 && result.reason) {
								pi.sendMessage({
									customType: "hook_async_block",
									content: result.reason,
									display: true,
								});
							}
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							if (!/stale/i.test(msg)) console.debug("[hooks-compat] async handler failed:", msg);
						}
					});
					continue;
				}

				const output = await runHandler(handler, stdinData, ctx, getCallLLM(pi));
				const result = interpretHookOutput(output);

				if (result.shouldBlock) {
					return { block: true, reason: result.reason };
				}

				if (result.updatedInput) {
					Object.assign(event.input, result.updatedInput);
				}
			}
		}

		return undefined;
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
