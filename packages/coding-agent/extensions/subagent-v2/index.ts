import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@dyyz1993/pi-ai";
import { StringEnum } from "@dyyz1993/pi-ai";
import {
	type AgentScope,
	type ChannelContract,
	type ExtensionAPI,
	RpcClient,
	createTypedChannel,
	discoverAgents,
	getMarkdownTheme,
	withFileMutationQueue,
} from "@dyyz1993/pi-coding-agent";
import type { Theme, ThemeColor } from "@dyyz1993/pi-coding-agent";
import { type Component, Container, Markdown, Spacer, Text } from "@dyyz1993/pi-tui";
import { Type } from "typebox";

// ── Inlined from subagent-shared/contract.ts ──

const SUBAGENT_CHANNEL_NAME = "subagent";

interface SubagentEventPayload {
	event: unknown;
	sessionId: string;
	taskId?: string;
	[key: string]: unknown;
}

interface SubagentStartPayload {
	event: {
		type: "subagent_start";
		toolCallId: string;
		description: string;
		instruction: string;
	};
	sessionId: string;
}

interface SubagentChannelContract extends ChannelContract {
	methods?: Record<string, never>;
	events: {
		event: SubagentEventPayload;
		subagent_start: SubagentStartPayload;
	};
}

// ── Inlined from subagent-shared/types.ts ──

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown" | "builtin" | "plugin" | "flag" | "policy";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	sessionPath?: string;
}

type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

interface SubagentDetailsBase {
	agentScope: string;
	projectAgentsDir: string | null;
}

// ── Inlined from subagent-shared/utils.ts ──

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function writePromptToTempFile(
	agentName: string,
	prompt: string,
	tmpPrefix = "pi-subagent-",
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), tmpPrefix));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function cleanupTempFiles(filePath: string | null, dir: string | null, logPrefix = "subagent"): void {
	if (filePath)
		try {
			fs.unlinkSync(filePath);
		} catch (err) {
			console.debug(`[${logPrefix}] temp file cleanup failed:`, err instanceof Error ? err.message : err);
		}
	if (dir)
		try {
			fs.rmdirSync(dir);
		} catch (err) {
			console.debug(`[${logPrefix}] temp dir cleanup failed:`, err instanceof Error ? err.message : err);
		}
}

function makeUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function accumulateUsage(result: { usage: UsageStats; model?: string; stopReason?: string; errorMessage?: string }, msg: Message): void {
	if (msg.role !== "assistant") return;
	result.usage.turns++;
	const usage = msg.usage;
	if (usage) {
		result.usage.input += usage.input || 0;
		result.usage.output += usage.output || 0;
		result.usage.cacheRead += usage.cacheRead || 0;
		result.usage.cacheWrite += usage.cacheWrite || 0;
		result.usage.cost += usage.cost?.total || 0;
		result.usage.contextTokens = usage.totalTokens || 0;
	}
	if (!result.model && msg.model) result.model = msg.model;
	if (msg.stopReason) result.stopReason = msg.stopReason;
	if (msg.errorMessage) result.errorMessage = msg.errorMessage;
}

// ── Inlined from subagent-shared/render.ts ──

const COLLAPSED_ITEM_COUNT = 10;

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: ThemeColor, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

function renderDisplayItemsInner(
	items: DisplayItem[],
	expanded: boolean,
	theme: Theme,
	limit?: number,
): string {
	const fg = (c: string, t: string) => theme.fg(c as ThemeColor, t);
	const toShow = limit ? items.slice(-limit) : items;
	const skipped = limit && items.length > limit ? items.length - limit : 0;
	let text = "";
	if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
	for (const item of toShow) {
		if (item.type === "text") {
			const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
			text += `${theme.fg("toolOutput", preview)}\n`;
		} else {
			text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, fg)}\n`;
		}
	}
	return text.trimEnd();
}

function renderSingleResult(r: SingleResult, expanded: boolean, theme: Theme): Component {
	const mdTheme = getMarkdownTheme();
	const fg = (c: string, t: string) => theme.fg(c as ThemeColor, t);
	const isError =
		r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted" || r.stopReason === "timeout";
	const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
	const displayItems = getDisplayItems(r.messages);
	const finalOutput = getFinalOutput(r.messages);

	if (expanded) {
		const container = new Container();
		let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
		if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
		container.addChild(new Text(header, 0, 0));
		if (isError && r.errorMessage) container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
		container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
		if (displayItems.length === 0 && !finalOutput) {
			container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
		} else {
			for (const item of displayItems) {
				if (item.type === "toolCall")
					container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, fg), 0, 0));
			}
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
			}
		}
		const usageStr = formatUsageStats(r.usage, r.model);
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
		}
		return container;
	}

	let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
	if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
	if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
	else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
	else {
		text += `\n${renderDisplayItemsInner(displayItems, expanded, theme, COLLAPSED_ITEM_COUNT)}`;
		if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	}
	const usageStr = formatUsageStats(r.usage, r.model);
	if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
	return new Text(text, 0, 0);
}

// ── subagent-v2 logic ──

const STEER_GRACE_MS = 30_000;

interface SubagentDetails {
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	result: SingleResult | null;
}

interface BackgroundTask {
	taskId: string;
	client: RpcClient;
	sessionId: string;
	sessionPath: string;
	startedAt: number;
}

const backgroundTasks = new Map<string, BackgroundTask>();

function sessionDir(): string {
	const dir = path.join(os.tmpdir(), "pi-subagent-v2-sessions");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function subscribeToClient(
	client: RpcClient,
	result: SingleResult,
	onEventData: (event: unknown, meta: Record<string, unknown>) => void,
	meta: Record<string, unknown>,
	onMessage?: () => void,
): () => void {
	return client.onEvent((event) => {
		onEventData(event, meta);
		if (event.type === "message_end" && event.message) {
			const msg = event.message as Message;
			result.messages.push(msg);
			accumulateUsage(result, msg);
			onMessage?.();
		}
	});
}

async function runWithTimeout(
	client: RpcClient,
	prompt: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<"done" | "timeout" | "aborted"> {
	const promptTimeout = timeoutMs - STEER_GRACE_MS;

	const completionPromise = (async () => {
		await client.prompt(prompt);
		await client.waitForIdle(promptTimeout);
	})();

	const timeoutPromise = new Promise<"timeout">((resolve) => {
		setTimeout(() => resolve("timeout"), promptTimeout);
	});

	const promises: Promise<"done" | "timeout" | "aborted">[] = [
		completionPromise.then(() => "done" as const),
		timeoutPromise,
	];

	if (signal) {
		if (signal.aborted) return "aborted";
		promises.push(
			new Promise<"aborted">((resolve) => {
				signal.addEventListener("abort", () => resolve("aborted"), { once: true });
			}),
		);
	}

	return Promise.race(promises);
}

async function handleGracePeriod(client: RpcClient, result: SingleResult): Promise<void> {
	await client.steer("Please summarize your findings and wrap up now. You have 30 seconds remaining.");
	await Promise.race([
		new Promise<void>((resolve) => {
			const sub = client.onEvent((event) => {
				if (event.type === "agent_end") {
					sub();
					resolve();
				}
			});
		}),
		new Promise<void>((resolve) => setTimeout(resolve, STEER_GRACE_MS)),
	]);
	result.stopReason = "timeout";
	result.exitCode = 1;
}

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task instruction to delegate to the agent" }),
	background: Type.Optional(Type.Boolean({ description: "Run in background mode. Default: false.", default: false })),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Default: 300.", default: 300 })),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
});

const SubagentResumeParams = Type.Object({
	sessionId: Type.Optional(Type.String({ description: "Session ID from previous run" })),
	sessionPath: Type.Optional(Type.String({ description: "Path to the saved session file" })),
	instruction: Type.Optional(Type.String({ description: "Additional instruction for the resumed agent" })),
	background: Type.Optional(Type.Boolean({ description: "Run in background mode. Default: false.", default: false })),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Default: 300.", default: 300 })),
});

export default function (pi: ExtensionAPI) {
	const rawChannel = pi.registerChannel("subagent");
	const channel = createTypedChannel<SubagentChannelContract>(rawChannel).server;

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate a task to a specialized subagent with isolated context using RPC mode.",
			"Agents are discovered from ~/.pi/agent/agents/ (user) and .pi/agents/ (project).",
			'Use agentScope to control discovery: "user" (default), "project", or "both".',
			"Set background: true to run without blocking. The parent is notified on completion.",
			"Sessions are persisted for later resume via subagent_resume.",
		].join(" "),
		parameters: SubagentParams,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const timeoutMs = Math.max((params.timeout ?? 300) * 1000, STEER_GRACE_MS + 10_000);
			const background = params.background ?? false;

			// Extract parent todo list from session history (for read-only reference)
			const parentTodos = extractParentTodos(ctx.sessionManager.getBranch());

			const details: SubagentDetails = {
				agentScope,
				projectAgentsDir: discovery.projectAgentsDir,
				result: null,
			};

			if (
				(agentScope === "project" || agentScope === "both") &&
				(params.confirmProjectAgents ?? true) &&
				ctx.hasUI
			) {
				const agent = agents.find((a) => a.name === params.agent);
				if (agent?.source === "project") {
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agent?",
						`Agent: ${agent.name}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agent not approved." }],
							details,
						};
				}
			}

			const agent = agents.find((a) => a.name === params.agent);
			if (!agent) {
				const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
				return {
					content: [{ type: "text", text: `Unknown agent: "${params.agent}". Available agents: ${available}.` }],
					details,
				};
			}

			const sessionId = `subagent-v2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const sessionPath = path.join(sessionDir(), `${sessionId}.json`);
			const startedAt = Date.now();

			let tmpPromptDir: string | null = null;
			let tmpPromptPath: string | null = null;
			let compressDir: string | null = null;

			const extraArgs: string[] = ["--session", sessionPath];
			if (agent.systemPrompt.trim()) {
				const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt, "pi-subagent-v2-");
				tmpPromptDir = tmp.dir;
				tmpPromptPath = tmp.filePath;
				extraArgs.push("--append-system-prompt", tmpPromptPath);
			}

			// Append compression awareness guidance so the sub-agent knows how to
			// handle approaching context limits before lossy compaction occurs.
			const compressGuidance = [
				"---",
				"# Context Compression Awareness",
				"",
				"Your context window is limited. When it approaches capacity, automatic compaction",
				"(lossy compression) will occur. Compaction reduces detail — current findings may",
				"become unreliable after compression.",
				"",
				"Note: The parent is blocked waiting for you to finish. Your results are returned",
				"automatically only when you complete the task (end the conversation).",
				"You cannot send intermediate results back while the task is running.",
				"",
				"If you detect context warnings, complete early:",
				"1. Wrap up your current work and present your findings as the final answer.",
				"2. If the task is too large, return your current direction and partial findings",
				"   so the parent can re-dispatch more targeted sub-tasks with fresh context.",
				"3. Do NOT try to continue — automatic compaction will make current details",
				"   unreliable, and the parent is waiting for you to complete.",
			].join("\n");
			const compressTmp = await writePromptToTempFile("compression-awareness", compressGuidance, "pi-subagent-v2-");
			extraArgs.push("--append-system-prompt", compressTmp.filePath);
			compressDir = compressTmp.dir;

			if (agent.tools && agent.tools.length > 0) {
				extraArgs.push("--tools", agent.tools.join(","));
			}

			const currentResult: SingleResult = {
				agent: params.agent,
				agentSource: agent.source,
				task: params.task,
				exitCode: 0,
				messages: [],
				stderr: "",
				usage: makeUsage(),
				model: agent.model,
				sessionPath,
			};

			const emitUpdate = () => {
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
						details: { ...details, result: { ...currentResult } },
					});
				}
			};

			// Pass subagent role and parent todos to child process via env vars
		const env: Record<string, string> = { PI_SUBAGENT: "true" };
		if (parentTodos.length > 0) {
			env.PI_PARENT_TODOS = JSON.stringify(parentTodos);
		}

		const client = new RpcClient({
				cwd: params.cwd ?? ctx.cwd,
				provider: ctx.model?.provider || undefined,
				model: agent.model,
				env,
				args: extraArgs,
			});

			if (background) {
				const taskId = `bg-${sessionId}`;

				const startBg = async () => {
					try {
						await client.start();
						if (agent.tools && agent.tools.length > 0) await client.setActiveTools(agent.tools);

						const unsubscribe = subscribeToClient(
							client,
							currentResult,
							(event, meta) => channel.emit("event", { event, ...meta } as SubagentEventPayload),
							{ sessionId, taskId },
						);

						const raceResult = await runWithTimeout(client, params.task, timeoutMs);
						if (raceResult === "timeout") await handleGracePeriod(client, currentResult);
						unsubscribe();

						if (currentResult.exitCode === 0) {
							currentResult.exitCode = currentResult.stopReason === "error" ? 1 : 0;
						}
					} catch (err) {
						currentResult.exitCode = 1;
						currentResult.errorMessage = err instanceof Error ? err.message : String(err);
						currentResult.stderr = client.getStderr();
					} finally {
						await client.stop();
						cleanupTempFiles(tmpPromptPath, tmpPromptDir, "subagent-v2");
						cleanupTempFiles(null, compressDir, "subagent-v2");
						backgroundTasks.delete(taskId);

						try {
							const finalText = getFinalOutput(currentResult.messages) || "(no output)";
							pi.appendEntry("subagent", {
								toolCallId,
								sessionId,
								sessionPath,
								description: params.agent,
								instruction: params.task,
								startedAt,
								completedAt: Date.now(),
								exitCode: currentResult.exitCode,
								finalText,
							});

							const isCrash = currentResult.exitCode !== 0;
							const summary = finalText.slice(0, 200);
							const msg = isCrash
								? `子任务中断：${params.agent} — ${currentResult.errorMessage || summary}`
								: `子任务完成：${params.agent} — ${summary}`;
							try {
								pi.sendUserMessage(msg, { deliverAs: "followUp" });
							} catch (err) {
								const eMsg = err instanceof Error ? err.message : String(err);
								if (/stale/i.test(eMsg)) return;
								console.debug("[subagent-v2] followUp delivery failed:", eMsg);
								pi.sendUserMessage(msg);
							}
						} catch (err) {
							const eMsg = err instanceof Error ? err.message : String(err);
							if (/stale/i.test(eMsg)) return;
							throw err;
						}
					}
				};

				backgroundTasks.set(taskId, { taskId, client, sessionId, sessionPath, startedAt });
				startBg();

				return {
					content: [{ type: "text", text: `Started background task: ${taskId}` }],
					details: { agentScope, projectAgentsDir: discovery.projectAgentsDir, result: null },
				};
			}

			let wasAborted = false;

			try {
				await client.start();
				if (agent.tools && agent.tools.length > 0) await client.setActiveTools(agent.tools);

				const unsubscribe = subscribeToClient(
					client,
					currentResult,
					(event, meta) => channel.emit("event", { event, ...meta } as SubagentEventPayload),
					{ sessionId },
					emitUpdate,
				);

				const raceResult = await runWithTimeout(client, params.task, timeoutMs, signal);

				if (raceResult === "aborted") {
					wasAborted = true;
					await client.abort();
					currentResult.stopReason = "aborted";
					currentResult.exitCode = 1;
				} else if (raceResult === "timeout") {
					await handleGracePeriod(client, currentResult);
				}

				unsubscribe();
				if (currentResult.exitCode === 0 && !wasAborted) {
					currentResult.exitCode = currentResult.stopReason === "error" ? 1 : 0;
				}
			} catch (err) {
				currentResult.exitCode = 1;
				currentResult.errorMessage = err instanceof Error ? err.message : String(err);
				currentResult.stderr = client.getStderr();
			} finally {
				await client.stop();
				cleanupTempFiles(tmpPromptPath, tmpPromptDir, "subagent-v2");
				cleanupTempFiles(null, compressDir, "subagent-v2");
			}

			const finalText = getFinalOutput(currentResult.messages) || "(no output)";

			pi.appendEntry("subagent", {
				toolCallId,
				sessionId,
				sessionPath,
				description: params.agent,
				instruction: params.task,
				startedAt,
				completedAt: Date.now(),
				exitCode: currentResult.exitCode,
				finalText,
			});

			const isError =
				currentResult.exitCode !== 0 ||
				currentResult.stopReason === "error" ||
				currentResult.stopReason === "aborted" ||
				currentResult.stopReason === "timeout";
			if (isError) {
				let errorMsg = currentResult.errorMessage || currentResult.stderr || finalText || "(no output)";
				if (currentResult.sessionPath) {
					errorMsg += `\n\nSession saved: ${currentResult.sessionPath}\nTo resume: use subagent_resume with sessionPath="${currentResult.sessionPath}"`;
				}
				return {
					content: [{ type: "text", text: `Agent ${currentResult.stopReason || "failed"}: ${errorMsg}` }],
					details: { ...details, result: currentResult },
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: finalText }],
				details: { ...details, result: currentResult },
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			const bg = args.background ? theme.fg("warning", " [bg]") : "";
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`) +
				bg;
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details?.result) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}
			return renderSingleResult(details.result, expanded, theme);
		},
	});

	pi.registerTool({
		name: "subagent_resume",
		label: "Subagent Resume",
		description: "Resume a previously interrupted subagent session. The agent continues from where it left off.",
		parameters: SubagentResumeParams,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const sPath = params.sessionPath;
			if (!sPath) {
				return {
					content: [{ type: "text", text: "sessionPath is required." }],
					details: { agentScope: "user" as AgentScope, projectAgentsDir: null, result: null },
				};
			}

			if (!fs.existsSync(sPath)) {
				return {
					content: [{ type: "text", text: `Session file not found: ${sPath}` }],
					details: { agentScope: "user" as AgentScope, projectAgentsDir: null, result: null },
				};
			}

			const timeoutMs = Math.max((params.timeout ?? 300) * 1000, STEER_GRACE_MS + 10_000);
			const background = params.background ?? false;

			const currentResult: SingleResult = {
				agent: "(resumed)",
				agentSource: "unknown",
				task: params.instruction ?? "(resume)",
				exitCode: 0,
				messages: [],
				stderr: "",
				usage: makeUsage(),
				sessionPath: sPath,
			};

			const details: SubagentDetails = { agentScope: "user", projectAgentsDir: null, result: null };

			const emitUpdate = () => {
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(resuming...)" }],
						details: { ...details, result: { ...currentResult } },
					});
				}
			};

			const client = new RpcClient({
				cwd: ctx.cwd,
				provider: ctx.model?.provider || undefined,
				args: ["--session", sPath, "-c"],
			});

			const sessionId = params.sessionId ?? `resume-${Date.now()}`;
			const resumePrompt = params.instruction ?? "Please continue from where you left off.";

			if (background) {
				const taskId = `bg-resume-${sessionId}`;
				const startedAt = Date.now();

				const startBg = async () => {
					try {
						await client.start();
						const unsubscribe = subscribeToClient(
							client,
							currentResult,
							(event, meta) => channel.emit("event", { event, ...meta } as SubagentEventPayload),
							{ sessionId, taskId },
						);

						const raceResult = await runWithTimeout(client, resumePrompt, timeoutMs);
						if (raceResult === "timeout") await handleGracePeriod(client, currentResult);
						unsubscribe();

						if (currentResult.exitCode === 0) {
							currentResult.exitCode = currentResult.stopReason === "error" ? 1 : 0;
						}
					} catch (err) {
						currentResult.exitCode = 1;
						currentResult.errorMessage = err instanceof Error ? err.message : String(err);
						currentResult.stderr = client.getStderr();
					} finally {
						await client.stop();
						backgroundTasks.delete(taskId);

						try {
							const finalText = getFinalOutput(currentResult.messages) || "(no output)";
							pi.appendEntry("subagent", {
								toolCallId,
								sessionId,
								sessionPath: sPath,
								description: "(resumed)",
								instruction: params.instruction ?? "(resume)",
								startedAt,
								completedAt: Date.now(),
								exitCode: currentResult.exitCode,
								finalText,
							});

							const isCrash = currentResult.exitCode !== 0;
							const summary = finalText.slice(0, 200);
							const msg = isCrash
								? `子任务中断：(resumed) — ${currentResult.errorMessage || summary}`
								: `子任务完成：(resumed) — ${summary}`;
							try {
								pi.sendUserMessage(msg, { deliverAs: "followUp" });
							} catch (err) {
								const eMsg = err instanceof Error ? err.message : String(err);
								if (/stale/i.test(eMsg)) return;
								console.debug("[subagent-v2] resumed followUp delivery failed:", eMsg);
								pi.sendUserMessage(msg);
							}
						} catch (err) {
							const eMsg = err instanceof Error ? err.message : String(err);
							if (/stale/i.test(eMsg)) return;
							throw err;
						}
					}
				};

				backgroundTasks.set(taskId, { taskId, client, sessionId, sessionPath: sPath, startedAt });
				startBg();

				return {
					content: [{ type: "text", text: `Started background resume task: ${taskId}` }],
					details: { agentScope: "user", projectAgentsDir: null, result: null },
				};
			}

			let wasAborted = false;

			try {
				await client.start();
				const unsubscribe = subscribeToClient(
					client,
					currentResult,
					(event, meta) => channel.emit("event", { event, ...meta } as SubagentEventPayload),
					{ sessionId },
					emitUpdate,
				);

				const raceResult = await runWithTimeout(client, resumePrompt, timeoutMs, signal);

				if (raceResult === "aborted") {
					wasAborted = true;
					await client.abort();
					currentResult.stopReason = "aborted";
					currentResult.exitCode = 1;
				} else if (raceResult === "timeout") {
					await handleGracePeriod(client, currentResult);
				}

				unsubscribe();
				if (currentResult.exitCode === 0 && !wasAborted) {
					currentResult.exitCode = currentResult.stopReason === "error" ? 1 : 0;
				}
			} catch (err) {
				currentResult.exitCode = 1;
				currentResult.errorMessage = err instanceof Error ? err.message : String(err);
				currentResult.stderr = client.getStderr();
			} finally {
				await client.stop();
			}

			let finalText = getFinalOutput(currentResult.messages) || "(no output)";
			if (currentResult.exitCode !== 0 && currentResult.sessionPath) {
				finalText += `\n\nSession saved: ${currentResult.sessionPath}\nTo resume again: use subagent_resume with sessionPath="${currentResult.sessionPath}"`;
			}

			return {
				content: [{ type: "text", text: finalText }],
				details: { ...details, result: currentResult },
			};
		},

		renderCall(args, theme, _context) {
			const bg = args.background ? theme.fg("warning", " [bg]") : "";
			const sPath = args.sessionPath ?? args.sessionId ?? "...";
			return new Text(theme.fg("toolTitle", theme.bold("subagent_resume ")) + theme.fg("accent", sPath) + bg, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details?.result) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}
			return renderSingleResult(details.result, expanded, theme);
		},
	});
}

/**
 * Extract the parent session's todo list from session history entries.
 * Scans custom "todo" entries and tool result messages for the latest list.
 * Returns active (not deleted, not done) todos for read-only reference.
 */
export function extractParentTodos(branch: unknown[]): Array<{ id: number; text: string; priority?: string; done: boolean }> {
	let todos: Array<{ id: number; text: string; done: boolean; deleted?: boolean; priority?: string }> = [];
	let nextId = 1;

	for (const entry of branch) {
		const e = entry as Record<string, unknown>;
		if (e.type === "custom" && (e as Record<string, unknown>).customType === "todo") {
			const data = (e as Record<string, unknown>).data as Record<string, unknown> | undefined;
			if (data?.todos) {
				todos = data.todos as typeof todos;
				nextId = (data.nextId as number) ?? nextId;
			}
			continue;
		}
		if (e.type !== "message") continue;
		const msg = (e as Record<string, unknown>).message as Record<string, unknown> | undefined;
		if (!msg || msg.role !== "toolResult" || (msg as Record<string, unknown>).toolName !== "todo") continue;
		const details = (msg as Record<string, unknown>).details as Record<string, unknown> | undefined;
		if (details?.todos) {
			todos = details.todos as typeof todos;
			nextId = (details.nextId as number) ?? nextId;
		}
	}

	return todos
		.filter((t) => !t.deleted && !t.done)
		.map((t) => ({ id: t.id, text: t.text, priority: t.priority, done: t.done }));
}
