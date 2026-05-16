import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@dyyz1993/pi-ai";
import { StringEnum } from "@dyyz1993/pi-ai";
import {
	type AgentScope,
	type ExtensionAPI,
	RpcClient,
	createTypedChannel,
	discoverAgents,
} from "@dyyz1993/pi-coding-agent";
import { Text } from "@dyyz1993/pi-tui";
import { Type } from "typebox";
import {
	accumulateUsage,
	cleanupTempFiles,
	type SingleResult,
	type SubagentEventPayload,
	type UsageStats,
	formatUsageStats,
	getFinalOutput,
	makeUsage,
	renderSingleResult,
	writePromptToTempFile,
} from "../subagent-shared/index.js";
import type { SubagentChannelContract } from "../subagent-shared/contract.js";

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

			const extraArgs: string[] = ["--session", sessionPath];
			if (agent.systemPrompt.trim()) {
				const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt, "pi-subagent-v2-");
				tmpPromptDir = tmp.dir;
				tmpPromptPath = tmp.filePath;
				extraArgs.push("--append-system-prompt", tmpPromptPath);
			}
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

			const client = new RpcClient({
				cwd: params.cwd ?? ctx.cwd,
				provider: ctx.model?.provider || undefined,
				model: agent.model,
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
