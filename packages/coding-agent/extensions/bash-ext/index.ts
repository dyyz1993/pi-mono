/**
 * Bash Channel Extension - Replaces built-in bash tool with PID-aware version.
 *
 * Registers a "bash" tool that overrides the built-in one. Spawns child processes
 * with full lifecycle management: timeout, background/detach/kill operations,
 * streaming output via channel events, truncation with temp-file overflow,
 * and a companion get_background_process tool for polling backgrounded processes.
 *
 * Channel events:
 *   - "start": new bash process started (toolCallId, command, pid, timestamp)
 *   - "output": streaming output chunk (toolCallId, data, timestamp) — foreground only
 *   - "end": process finished (toolCallId, exitCode, duration, output)
 *   - "error": process failed/aborted/timed out
 *   - "background": process moved to background (tool resolved, process keeps running)
 *   - "terminated": process killed by user
 *
 * Channel receive commands (from UI):
 *   - { action: "kill", toolCallId } → kill process tree, resolve tool with terminated details
 *   - { action: "background", toolCallId } → resolve tool early, switch to file-only logging
 *   - { action: "list" } → return current process list
 *   - { action: "subscribe_output", toolCallId } → start receiving output events for a background process
 *   - { action: "unsubscribe_output", toolCallId } → stop receiving output events for a background process
 */

import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@dyyz1993/pi-agent-core";
import stripAnsi from "strip-ansi";
import type { ChildProcess } from "child_process";
import { Type } from "typebox";
import type { BashToolDetails as _BashToolDetails, ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	OutputCollector,
	ServerChannel,
	createTypedChannel,
	killProcessTree,
	sanitizeBinaryOutput,
	spawnManagedProcess,
	waitForChildProcess,
} from "@dyyz1993/pi-coding-agent";
import { BASH_CHANNEL_NAME, type BashChannelContract, type BashProcess } from "./contract.js";
export type { BashProcess, BashChannelEvent } from "./contract.js";

interface TerminatedDetails {
	reason: string;
	pid?: number;
	command: string;
	startedAt: number;
	endedAt?: number;
	durationMs: number;
	logPath?: string;
	exitCode?: number | null;
	timeoutSecs?: number;
	error?: string;
}

interface BackgroundDetails {
	pid?: number;
	command: string;
	startedAt: number;
	durationMs: number;
	logPath?: string;
	detached: boolean;
}

type BashToolDetails = _BashToolDetails & {
	terminated?: TerminatedDetails;
	background?: BackgroundDetails;
};

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_BACKGROUND_AFTER_SECONDS = 120;

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	description: Type.String({ description: "Clear, concise description of what this command does in 5-10 words" }),
	timeout: Type.Optional(
		Type.Number({
			description: `Hard timeout in seconds. Process is killed if still running after this duration. Defaults to ${DEFAULT_TIMEOUT_SECONDS}s (5 minutes). Acts as a safety net to prevent zombie processes.`,
		}),
	),
	backgroundAfter: Type.Optional(
		Type.Number({
			description:
				"Soft limit in seconds. If the command runs longer than this, it is automatically moved to background instead of blocking the agent. The process continues running; the agent receives a background notification and can proceed with other work. Must be less than timeout if both are set. Use for long-running tasks like builds or installs where you want the agent to stay productive.",
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description:
				"Working directory for the command. Defaults to the agent's current working directory. Use this to run commands in a specific project or directory without cd.",
		}),
	),
});



interface ManagedBash {
	proc: BashProcess;
	resolve: (result: AgentToolResult<BashToolDetails>) => void;
	reject: (error: Error) => void;
	child: ChildProcess;
	resolved: boolean;
	backgrounded: boolean;
	killedByUser?: boolean;
	logStream: ReturnType<typeof createWriteStream> | undefined;
	outputSubscribed: boolean;
	stdin: ChildProcess["stdin"];
}

const managed = new Map<string, ManagedBash>();
const history: BashProcess[] = [];
const deletedIds = new Set<string>();

function generateBashId(): string {
	const id = randomBytes(3).toString("hex");
	return `bash-${id}`;
}

function getLogPath(bashId: string): string {
	return join(tmpdir(), `pi-${bashId}.log`);
}

const BG_PREVIEW_LINES = 20;

function takeLastLines(text: string, n: number): string {
	const lines = text.split("\n");
	if (lines.length <= n) return text;
	return `... (${lines.length - n} earlier lines)\n${lines.slice(-n).join("\n")}`;
}

function grepLines(text: string, pattern: string): string {
	const lines = text.split("\n");
	const matched = lines.filter((l) => l.toLowerCase().includes(pattern.toLowerCase()));
	if (matched.length === 0) return `(no lines matching "${pattern}")`;
	return matched.join("\n");
}

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m${s % 60}s`;
}

export default function (pi: ExtensionAPI) {
	let channel: ServerChannel<BashChannelContract> | null = null;

	function createLogStream(m: ManagedBash): void {
		if (m.logStream) return;
		const logPath = getLogPath(m.proc.bashId);
		const logStream = createWriteStream(logPath);
		if (m.proc.output) logStream.write(m.proc.output);
		m.proc.logPath = logPath;
		m.logStream = logStream;
	}

	pi.on("session_start", async () => {
		const rawChannel = pi.registerChannel(BASH_CHANNEL_NAME);
		channel = createTypedChannel<BashChannelContract>(rawChannel).server;
		managed.clear();
		history.length = 0;
		deletedIds.clear();
		channel.emit("list", { type: "list", processes: [], timestamp: Date.now() });

		channel.handle("list", () => {
			const activeBg = Array.from(managed.values())
				.filter((m) => m.backgrounded)
				.map((m) => m.proc);
			const hist = history.filter((p) => !deletedIds.has(p.toolCallId));
			return {
				type: "list" as const,
				processes: [...activeBg, ...hist],
				timestamp: Date.now(),
			};
		});

		channel.handle("kill", ({ toolCallId }) => {
			if (!toolCallId) return { ok: false, reason: "not_found" };
			const m = managed.get(toolCallId);
			if (!m) {
				// Process already exited — emit terminated event so frontend can sync state
				channel?.emit("terminated", {
					type: "terminated",
					toolCallId,
					pid: undefined,
					processes: Array.from(managed.values()).map((x) => x.proc),
					timestamp: Date.now(),
				});
				return { ok: true, alreadyExited: true };
			}
			if (m.proc.pid) {
				killProcessTree(m.proc.pid);
			}
			m.proc.status = "terminated";
			m.proc.endedAt = Date.now();
			m.resolved = true;
			m.killedByUser = true;
			const durationMs = m.proc.endedAt - m.proc.startedAt;
			if (m.logStream) m.logStream.end();
			channel?.emit("terminated", {
				type: "terminated",
				toolCallId,
				pid: m.proc.pid,
				processes: Array.from(managed.values()).map((x) => x.proc),
				timestamp: Date.now(),
			});
			m.resolve({
				content: [
					{
						type: "text",
						text: `${m.proc.output || "(no output)"}\n\n[User cancelled after ${formatDuration(durationMs)}, PID: ${m.proc.pid ?? "unknown"}${m.proc.logPath ? `. Log: ${m.proc.logPath}` : ""}]`,
					},
				],
				details: {
					terminated: {
						reason: "user_cancel",
						pid: m.proc.pid,
						command: m.proc.command,
						startedAt: m.proc.startedAt,
						endedAt: m.proc.endedAt,
						durationMs,
						logPath: m.proc.logPath,
					},
				},
			});
			return { ok: true };
		});

		channel.handle("background", ({ toolCallId }) => {
			if (!toolCallId) return { ok: false, reason: "not_found" };
			const m = managed.get(toolCallId);
			if (!m) {
				// Process already exited — emit terminated event so frontend can sync state
				channel?.emit("terminated", {
					type: "terminated",
					toolCallId,
					pid: undefined,
					processes: Array.from(managed.values()).map((x) => x.proc),
					timestamp: Date.now(),
				});
				return { ok: true, alreadyExited: true };
			}
			m.proc.status = "background";
			m.resolved = true;
			m.backgrounded = true;
			m.outputSubscribed = false;
			createLogStream(m);
			const durationMs = Date.now() - m.proc.startedAt;
			channel?.emit("background", {
				type: "background",
				toolCallId,
				pid: m.proc.pid,
				data: m.proc.output.slice(-2000),
				processes: Array.from(managed.values()).map((x) => x.proc),
				timestamp: Date.now(),
			});
			const outputPreview = m.proc.output ? takeLastLines(m.proc.output, BG_PREVIEW_LINES) : "(no output yet)";
			m.resolve({
				content: [
					{
						type: "text",
						text: `${outputPreview}\n\n[Moved to background after ${formatDuration(durationMs)}, PID: ${m.proc.pid ?? "unknown"}. <bashId>${m.proc.bashId}</bashId>. Log: ${m.proc.logPath}. Use get_background_process with <bashId>${m.proc.bashId}</bashId> to check progress.]`,
					},
				],
				details: {
					background: {
						pid: m.proc.pid,
						command: m.proc.command,
						startedAt: m.proc.startedAt,
						durationMs,
						logPath: m.proc.logPath,
						detached: false,
					},
				},
			});
			return { ok: true };
		});

		channel.handle("subscribe_output", ({ toolCallId }) => {
			if (!toolCallId) return;
			const m = managed.get(toolCallId);
			if (m?.backgrounded) m.outputSubscribed = true;
		});

		channel.handle("unsubscribe_output", ({ toolCallId }) => {
			if (!toolCallId) return;
			const m = managed.get(toolCallId);
			if (m) m.outputSubscribed = false;
		});

		channel.handle("remove", ({ toolCallId }) => {
			if (!toolCallId) return;
			deletedIds.add(toolCallId);
			managed.delete(toolCallId);
			const idx = history.findIndex((p) => p.toolCallId === toolCallId);
			if (idx >= 0) history.splice(idx, 1);
		});

		channel.handle("write_stdin", ({ toolCallId, data }) => {
			if (!toolCallId || !data) return;
			const m = managed.get(toolCallId);
			if (m?.stdin && !m.stdin.destroyed) {
				m.stdin.write(data);
			}
		});
	});

	pi.registerTool({
		name: "bash",
		label: "bash",
		description: [
			`Execute a bash command. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file.`,
			"",
			"Timeout and background behavior:",
			`- timeout: Hard limit in seconds. Process is killed after this duration. Default: ${DEFAULT_TIMEOUT_SECONDS}s (5 min). This is a safety net — always present.`,
			"- backgroundAfter: Soft limit in seconds. If the command runs longer, it is automatically moved to background. The process keeps running, the agent receives a notification and can continue other work.",
			"- If backgroundAfter < timeout: command goes to background first, then gets killed if it reaches timeout.",
			"- If backgroundAfter >= timeout (or not set): command runs until timeout, then gets killed.",
			"",
			"When to use backgroundAfter:",
			"- Long builds (npm install, cargo build, docker build): set backgroundAfter to a reasonable time so the agent stays productive.",
			"- Quick commands (ls, grep, echo): no need for backgroundAfter, they finish fast.",
			"",
			"Rules:",
			"- ALWAYS provide a description (5-10 words explaining what the command does).",
			"- Use cwd to run commands in a specific directory instead of cd.",
			"- When a command is moved to background, the result includes a <bashId>. Use get_background_process with that ID to poll progress before running dependent commands.",
		].join("\n"),
		promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
		parameters: bashSchema,
		async execute(
			toolCallId: string,
			{ command, description, timeout, backgroundAfter, cwd: cwdParam }: { command: string; description: string; timeout?: number; backgroundAfter?: number; cwd?: string },
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<BashToolDetails>,
			_ctx?: ExtensionContext,
		): Promise<AgentToolResult<BashToolDetails>> {
			return new Promise((resolve, reject) => {
			const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT_SECONDS;
			const rawBackgroundAfter = backgroundAfter ?? DEFAULT_BACKGROUND_AFTER_SECONDS;
			const effectiveBackgroundAfter = rawBackgroundAfter < effectiveTimeout ? rawBackgroundAfter : undefined;
				const cwd = cwdParam ?? _ctx?.cwd ?? process.cwd();
				const bashId = generateBashId();

				const spawnResult = spawnManagedProcess({
					command,
					cwd,
					timeout: effectiveTimeout,
					signal,
					stdin: "pipe",
				});

				if (spawnResult instanceof Error) {
					reject(spawnResult);
					return;
				}

				const { child, cleanup: spawnCleanup, isTimedOut } = spawnResult;

			// Immediately send EOF on stdin so CLI tools that read stdin (e.g. xbrowser readStdin())
			// don't hang forever waiting for input. Interactive stdin is handled via write_stdin channel.
			if (child.stdin && !child.stdin.destroyed) {
				child.stdin.end();
			}

				const proc: BashProcess = {
					bashId,
					toolCallId,
					command,
					cwd,
					pid: child.pid ?? undefined,
					startedAt: Date.now(),
					output: "",
					status: "running",
				};

				managed.set(toolCallId, {
					proc,
					resolve,
					reject,
					child,
					resolved: false,
					backgrounded: false,
					logStream: undefined,
					outputSubscribed: false,
					stdin: child.stdin,
				});

				const logPath = getLogPath(bashId);
				const logStream = createWriteStream(logPath);
				proc.logPath = logPath;
				const m = managed.get(toolCallId)!;
				m.logStream = logStream;

				channel?.emit("start", {
					type: "start",
					toolCallId,
					pid: child.pid ?? undefined,
					data: command,
					processes: Array.from(managed.values()).map((m) => m.proc),
					timestamp: proc.startedAt,
				});

				const collector = new OutputCollector();

				const handleData = (data: Buffer) => {
					const m = managed.get(toolCallId);
					if (m?.logStream) m.logStream.write(data);

					if (m?.backgrounded) {
						if (m.outputSubscribed) {
							const text = sanitizeBinaryOutput(stripAnsi(data.toString("utf-8"))).replace(/\r/g, "");
							channel?.emit("output", {
								type: "output",
								toolCallId,
								data: text,
								processes: Array.from(managed.values()).map((x) => x.proc),
								timestamp: Date.now(),
							});
						}
						return;
					}

					collector.push(data);

					const rawText = data.toString("utf-8");
					const text = sanitizeBinaryOutput(stripAnsi(rawText)).replace(/\r/g, "");
					proc.output += text;

					channel?.emit("output", {
						type: "output",
						toolCallId,
						data: text,
						processes: Array.from(managed.values()).map((x) => x.proc),
						timestamp: Date.now(),
					});

					if (onUpdate) {
						const truncation = collector.getTruncation();
						onUpdate({
							content: [{ type: "text", text: truncation.content || "" }],
							details: {
								truncation: truncation.truncated ? truncation : undefined,
								fullOutputPath: collector.fullOutputPath,
							},
						});
					}
				};

				child.stdout?.on("data", handleData);
				child.stderr?.on("data", handleData);

				let backgroundAfterHandle: NodeJS.Timeout | undefined;
				if (effectiveBackgroundAfter !== undefined) {
					backgroundAfterHandle = setTimeout(() => {
						const m = managed.get(toolCallId);
						if (!m || m.resolved || m.backgrounded) return;
						m.proc.status = "background";
						m.resolved = true;
						m.backgrounded = true;
						m.outputSubscribed = false;
						createLogStream(m);
						const durationMs = Date.now() - m.proc.startedAt;
						channel?.emit("background", {
							type: "background",
							toolCallId,
							pid: m.proc.pid,
							data: m.proc.output.slice(-2000),
							processes: Array.from(managed.values()).map((x) => x.proc),
							timestamp: Date.now(),
						});
							const outputPreview = m.proc.output ? takeLastLines(m.proc.output, BG_PREVIEW_LINES) : "(no output yet)";
						m.resolve({
							content: [
								{
									type: "text",
									text: `${outputPreview}\n\n[Automatically moved to background after ${formatDuration(durationMs)} (backgroundAfter=${effectiveBackgroundAfter}s), PID: ${m.proc.pid ?? "unknown"}. <bashId>${m.proc.bashId}</bashId>. Log: ${m.proc.logPath}. Use get_background_process with <bashId>${m.proc.bashId}</bashId> to check progress.]`,
								},
							],
							details: {
								background: {
									pid: m.proc.pid,
									command: m.proc.command,
									startedAt: m.proc.startedAt,
									durationMs,
									logPath: m.proc.logPath,
									detached: false,
								},
							},
						});
					}, effectiveBackgroundAfter * 1000);
				}

				waitForChildProcess(child)
					.then((code) => {
						spawnCleanup();
						if (backgroundAfterHandle) clearTimeout(backgroundAfterHandle);
						collector.close();

						const m = managed.get(toolCallId);
						if (m?.resolved) {
							if (m.logStream) m.logStream.end();
							proc.exitCode = code;
							proc.endedAt = Date.now();
							proc.status = code === 0 ? "done" : "error";
							if (m.killedByUser) {
								if (!deletedIds.has(toolCallId)) history.push({ ...proc });
								managed.delete(toolCallId);
								return;
							}
							channel?.emit(proc.status === "done" ? "end" : "error", {
								type: proc.status === "done" ? "end" : "error",
								toolCallId,
								data: proc.output.slice(-2000),
								processes: Array.from(managed.values()).map((x) => x.proc),
								timestamp: Date.now(),
							});
							if (!deletedIds.has(toolCallId)) history.push({ ...proc });
							managed.delete(toolCallId);
							try {
								pi.sendUserMessage(
									`[system] Background process "${proc.command}" (PID: ${proc.pid ?? "unknown"}) exited with code ${code ?? "unknown"} after ${formatDuration((proc.endedAt ?? Date.now()) - proc.startedAt)}.${proc.logPath ? ` Log: ${proc.logPath}` : ""}`,
								);
							} catch (err) {
								console.debug("[bash-ext] background exit notification failed:", err instanceof Error ? err.message : err);
							}
							return;
						}

						if (signal?.aborted) {
							proc.status = "terminated";
							proc.endedAt = Date.now();
							const durationMs = proc.endedAt - proc.startedAt;
							const outputText = proc.output || "(no output)";
							channel?.emit("terminated", {
								type: "terminated",
								toolCallId,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							});
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${outputText}\n\n[Aborted after ${formatDuration(durationMs)}, PID: ${proc.pid ?? "unknown"}]`,
									},
								],
								details: {
									terminated: {
										reason: "signal",
										pid: proc.pid,
										command: proc.command,
										startedAt: proc.startedAt,
										endedAt: proc.endedAt,
										durationMs,
										logPath: collector.fullOutputPath,
									},
								},
							});
							return;
						}
						if (isTimedOut()) {
							proc.status = "error";
							proc.endedAt = Date.now();
							const durationMs = proc.endedAt - proc.startedAt;
							const outputText = proc.output || "(no output)";
							channel?.emit("error", {
								type: "error",
								toolCallId,
								data: `Timed out after ${effectiveTimeout}s`,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							});
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${outputText}\n\n[Timed out after ${effectiveTimeout}s, PID: ${proc.pid ?? "unknown"}]`,
									},
								],
								details: {
									terminated: {
										reason: "timeout",
										pid: proc.pid,
										command: proc.command,
										startedAt: proc.startedAt,
										endedAt: proc.endedAt,
										durationMs,
										timeoutSecs: effectiveTimeout,
										logPath: collector.fullOutputPath,
									},
								},
							});
							return;
						}

						proc.exitCode = code;
						proc.endedAt = Date.now();

						const truncation = collector.finalize();

						let outputText = truncation.content || "(no output)";
						let details: BashToolDetails | undefined;
						if (truncation.truncated) {
							details = { truncation, fullOutputPath: collector.fullOutputPath };
							const startLine = truncation.totalLines - truncation.outputLines + 1;
							const endLine = truncation.totalLines;
							outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${collector.fullOutputPath}]`;
						}

						if (code !== 0 && code !== null) {
							proc.status = "error";
							const durationMs = proc.endedAt - proc.startedAt;
							outputText += `\n\n[Command failed with exit code ${code} after ${formatDuration(durationMs)}, PID: ${proc.pid ?? "unknown"}]`;
							channel?.emit("error", {
								type: "error",
								toolCallId,
								data: outputText,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							});
							managed.delete(toolCallId);
							resolve({
								content: [{ type: "text", text: outputText }],
								details: {
									terminated: {
										reason: "error",
										pid: proc.pid,
										command: proc.command,
										startedAt: proc.startedAt,
										endedAt: proc.endedAt,
										durationMs,
										exitCode: code,
										logPath: collector.fullOutputPath,
									},
								},
							});
						} else {
							proc.status = "done";
							channel?.emit("end", {
								type: "end",
								toolCallId,
								data: outputText,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							});
							managed.delete(toolCallId);
							resolve({
								content: [{ type: "text", text: outputText }],
								details: details as BashToolDetails,
							} as AgentToolResult<BashToolDetails>);
						}
					})
					.catch((err: Error) => {
						spawnCleanup();
						if (backgroundAfterHandle) clearTimeout(backgroundAfterHandle);
						collector.close();

						const m = managed.get(toolCallId);
						if (m?.resolved) {
							if (m.logStream) m.logStream.end();
							proc.status = "error";
							proc.endedAt = Date.now();
							proc.exitCode = null;
							proc.error = err.message;
							if (m.killedByUser) {
								if (!deletedIds.has(toolCallId)) history.push({ ...proc });
								managed.delete(toolCallId);
								return;
							}
							channel?.emit("error", {
								type: "error",
								toolCallId,
								data: proc.output.slice(-2000),
								processes: Array.from(managed.values()).map((x) => x.proc),
								timestamp: Date.now(),
							});
							if (!deletedIds.has(toolCallId)) history.push({ ...proc });
							managed.delete(toolCallId);
							try {
								pi.sendUserMessage(
									`[system] Background process "${proc.command}" (PID: ${proc.pid ?? "unknown"}) crashed: ${err.message}${proc.logPath ? `. Log: ${proc.logPath}` : ""}`,
								);
							} catch (err) {
								console.debug("[bash-ext] background crash notification failed:", err instanceof Error ? err.message : err);
							}
							return;
						}

						const durationMs = (proc.endedAt || Date.now()) - proc.startedAt;
						const outputText = proc.output || "(no output)";

						if (err.message === "aborted") {
							proc.status = "terminated";
							channel?.emit("terminated", {
								type: "terminated",
								toolCallId,
								data: outputText,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							});
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${outputText}\n\n[Aborted after ${formatDuration(durationMs)}, PID: ${proc.pid ?? "unknown"}]`,
									},
								],
								details: {
									terminated: {
										reason: "signal",
										pid: proc.pid,
										command: proc.command,
										startedAt: proc.startedAt,
										endedAt: proc.endedAt,
										durationMs,
										logPath: collector.fullOutputPath,
									},
								},
							});
						} else if (err.message.startsWith("timeout:")) {
							const timeoutSecs = Number(err.message.split(":")[1]);
							channel?.emit("error", {
								type: "error",
								toolCallId,
								data: outputText,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							});
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${outputText}\n\n[Timed out after ${timeoutSecs}s, PID: ${proc.pid ?? "unknown"}]`,
									},
								],
								details: {
									terminated: {
										reason: "timeout",
										pid: proc.pid,
										command: proc.command,
										startedAt: proc.startedAt,
										endedAt: proc.endedAt,
										durationMs,
										timeoutSecs,
										logPath: collector.fullOutputPath,
									},
								},
							});
						} else {
							channel?.emit("error", {
								type: "error",
								toolCallId,
								data: outputText,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							});
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${outputText}\n\n[Command crashed after ${formatDuration(durationMs)}, PID: ${proc.pid ?? "unknown"}: ${err.message}]`,
									},
								],
								details: {
									terminated: {
										reason: "error",
										pid: proc.pid,
										command: proc.command,
										startedAt: proc.startedAt,
										endedAt: proc.endedAt,
										durationMs,
										error: err.message,
										logPath: collector.fullOutputPath,
									},
								},
							});
						}
					});
			});
		},
	});

	const bashStatusSchema = Type.Object({
		bashId: Type.String({ description: "The bashId returned when a command was moved to background. Example: bash-abc123" }),
		lastLines: Type.Optional(Type.Number({ description: "Only show the last N lines of output. Useful for checking tail of long-running builds. Default: show last 2000 chars." })),
		grep: Type.Optional(Type.String({ description: "Filter output to only lines containing this keyword (case-insensitive). Useful for finding errors, warnings, or specific patterns in build output." })),
	});

	function findProcess(bashId: string): { proc: BashProcess; isLive: boolean } | null {
		for (const m of managed.values()) {
			if (m.proc.bashId === bashId) return { proc: m.proc, isLive: !m.proc.endedAt };
		}
		const histProc = history.find((p) => p.bashId === bashId);
		if (histProc) return { proc: histProc, isLive: false };
		return null;
	}

	pi.registerTool({
		name: "get_background_process",
		label: "get_background_process",
		description: [
			"Query the status and output of a backgrounded bash process by its bashId.",
			"",
			"When a bash command is moved to background (manually or via backgroundAfter), it returns a <bashId>. Use this tool to:",
			"- Check if the process is still running, finished, or errored",
			"- Get the accumulated output (filtered if needed)",
			"- Get the exit code (if finished)",
			"",
			"Filtering options:",
			"- lastLines: show only the last N lines (e.g. lastLines=5 for quick status check)",
			"- grep: filter output to lines containing a keyword (e.g. grep='error' to find failures)",
			"- Both can be combined: lastLines=10 + grep='warning'",
			"",
			"Typical flow:",
			"1. Start long command: bash({ command: 'npm install', backgroundAfter: 60 })",
			"2. Do other work while it runs",
			"3. Poll: get_background_process({ bashId: 'bash-abc123' })",
			"4. If status='done', proceed. If status='running', poll again later.",
		].join("\n"),
		promptSnippet: "Check status of a backgrounded bash command",
		parameters: bashStatusSchema,
		async execute(
			_toolCallId: string,
			{ bashId, lastLines, grep: grepPattern }: { bashId: string; lastLines?: number; grep?: string },
		): Promise<AgentToolResult<BashToolDetails>> {
			const result = findProcess(bashId);

			if (!result) {
				return {
					content: [
						{
							type: "text",
							text: `No process found with <bashId>${bashId}</bashId>. It may have never existed, been removed, or the session has been reset.`,
						},
					],
					details: undefined as unknown as BashToolDetails,
				};
			}

			const { proc, isLive } = result;
			const durationMs = (proc.endedAt ?? Date.now()) - proc.startedAt;

			let output = proc.output || "(no output yet)";

			if (grepPattern) {
				output = grepLines(output, grepPattern);
			}

			if (lastLines !== undefined && lastLines > 0) {
				output = takeLastLines(output, lastLines);
			} else if (!grepPattern) {
				output = takeLastLines(output, 50);
			}

			const header = [
				`Process: ${proc.command}`,
				`<bashId>${proc.bashId}</bashId>`,
				`Status: ${proc.status}${isLive ? " (still running)" : ""}`,
				`PID: ${proc.pid ?? "unknown"}`,
				`Duration: ${formatDuration(durationMs)}`,
				proc.exitCode !== undefined ? `Exit code: ${proc.exitCode}` : null,
				proc.logPath ? `Log: ${proc.logPath}` : null,
				proc.error ? `Error: ${proc.error}` : null,
				grepPattern ? `Filtered by: "${grepPattern}"` : null,
				"",
				isLive ? "Output so far:" : "Output:",
			]
				.filter(Boolean)
				.join("\n");

			return {
				content: [{ type: "text", text: `${header}\n${output}` }],
				details: undefined as unknown as BashToolDetails,
			};
		},
	});
}
