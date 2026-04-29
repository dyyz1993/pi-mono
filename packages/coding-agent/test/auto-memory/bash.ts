/**
 * Bash Channel Extension - Replaces built-in bash tool with PID-aware version.
 *
 * Registers a "bash" tool that overrides the built-in one. Internally uses
 * createLocalBashOperations for actual execution, but intercepts the child
 * process to capture PID and support background/detach/kill operations.
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
import { createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@dyyz1993/pi-agent-core";
import { spawn } from "child_process";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "../../src/core/extensions/index.js";
import { ServerChannel } from "../../src/core/extensions/server-channel.js";
import type { BashToolDetails as _BashToolDetails } from "../../src/core/tools/index.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../../src/core/tools/index.js";

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

import { truncateTail } from "../../src/core/tools/truncate.js";
import { waitForChildProcess } from "../../src/utils/child-process.js";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../src/utils/shell.js";

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export interface BashProcess {
	toolCallId: string;
	command: string;
	cwd: string;
	pid?: number;
	startedAt: number;
	endedAt?: number;
	exitCode?: number | null;
	output: string;
	status: "running" | "done" | "error" | "terminated" | "background";
	error?: string;
	logPath?: string;
}

export interface BashChannelEvent {
	type: "start" | "output" | "end" | "error" | "terminated" | "background" | "list";
	processes?: BashProcess[];
	toolCallId?: string;
	pid?: number;
	data?: string;
	timestamp: number;
}

interface ManagedBash {
	proc: BashProcess;
	resolve: (result: AgentToolResult<BashToolDetails>) => void;
	reject: (error: Error) => void;
	child: ReturnType<typeof spawn>;
	resolved: boolean;
	backgrounded: boolean;
	killedByUser?: boolean;
	logStream: ReturnType<typeof createWriteStream> | undefined;
	outputSubscribed: boolean;
	stdin: ReturnType<typeof spawn>["stdin"];
}

const managed = new Map<string, ManagedBash>();
const history: BashProcess[] = [];
const deletedIds = new Set<string>();

function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `pi-bash-${id}.log`);
}

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m${s % 60}s`;
}

export default function (pi: ExtensionAPI) {
	let channel: ServerChannel | null = null;

	function createLogStream(m: ManagedBash): void {
		if (m.logStream) return;
		const logPath = getTempFilePath();
		const logStream = createWriteStream(logPath);
		if (m.proc.output) logStream.write(m.proc.output);
		m.proc.logPath = logPath;
		m.logStream = logStream;
	}

	pi.on("session_start", async () => {
		const rawChannel = pi.registerChannel("bash");
		channel = new ServerChannel(rawChannel);
		managed.clear();
		history.length = 0;
		deletedIds.clear();
		channel.emit("list", { type: "list", processes: [], timestamp: Date.now() } satisfies BashChannelEvent);

		rawChannel.onReceive((data) => {
			const msg = data as { action?: string; toolCallId?: string };
			if (!msg?.action) return;

			if (msg.action === "list") {
				const activeBg = Array.from(managed.values())
					.filter((m) => m.backgrounded)
					.map((m) => m.proc);
				const hist = history.filter((p) => !deletedIds.has(p.toolCallId));
				channel?.emit("list", {
					type: "list",
					processes: [...activeBg, ...hist],
					timestamp: Date.now(),
				} satisfies BashChannelEvent);
			}

			if (msg.action === "kill" && msg.toolCallId) {
				const m = managed.get(msg.toolCallId);
				if (m?.proc.pid) {
					killProcessTree(m.proc.pid);
					m.proc.status = "terminated";
					m.proc.endedAt = Date.now();
					m.resolved = true;
					m.killedByUser = true;
					const durationMs = m.proc.endedAt - m.proc.startedAt;
					if (m.logStream) m.logStream.end();
					channel?.emit("terminated", {
						type: "terminated",
						toolCallId: msg.toolCallId,
						pid: m.proc.pid,
						processes: Array.from(managed.values()).map((x) => x.proc),
						timestamp: Date.now(),
					} satisfies BashChannelEvent);
					m.resolve({
						content: [
							{
								type: "text",
								text: `${m.proc.output || "(no output)"}\n\n[User cancelled after ${formatDuration(durationMs)}, PID: ${m.proc.pid}${m.proc.logPath ? `. Log: ${m.proc.logPath}` : ""}]`,
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
				}
			}

			if (msg.action === "background" && msg.toolCallId) {
				const m = managed.get(msg.toolCallId);
				if (m) {
					m.proc.status = "background";
					m.resolved = true;
					m.backgrounded = true;
					m.outputSubscribed = false;
					createLogStream(m);
					const durationMs = Date.now() - m.proc.startedAt;
					channel?.emit("background", {
						type: "background",
						toolCallId: msg.toolCallId,
						pid: m.proc.pid,
						data: m.proc.output.slice(-2000),
						processes: Array.from(managed.values()).map((x) => x.proc),
						timestamp: Date.now(),
					} satisfies BashChannelEvent);
					const outputText = m.proc.output || "(no output yet)";
					m.resolve({
						content: [
							{
								type: "text",
								text: `${outputText}\n\n[Moved to background after ${formatDuration(durationMs)}, PID: ${m.proc.pid ?? "unknown"}${m.proc.logPath ? `. Log: ${m.proc.logPath}` : ""}. Use the Shell panel in the sidebar to monitor or kill the process.]`,
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
				}
			}

			if (msg.action === "subscribe_output" && msg.toolCallId) {
				const m = managed.get(msg.toolCallId);
				if (m?.backgrounded) m.outputSubscribed = true;
			}

			if (msg.action === "unsubscribe_output" && msg.toolCallId) {
				const m = managed.get(msg.toolCallId);
				if (m) m.outputSubscribed = false;
			}

			if (msg.action === "remove" && msg.toolCallId) {
				deletedIds.add(msg.toolCallId);
				managed.delete(msg.toolCallId);
				const idx = history.findIndex((p) => p.toolCallId === msg.toolCallId);
				if (idx >= 0) history.splice(idx, 1);
			}

			if (msg.action === "write_stdin" && msg.toolCallId && msg.data) {
				const m = managed.get(msg.toolCallId);
				if (m?.stdin && !m.stdin.destroyed) {
					m.stdin.write(msg.data);
				}
			}
		});
	});

	pi.registerTool({
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
		promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
		parameters: bashSchema,
		async execute(
			toolCallId: string,
			{ command, timeout }: { command: string; timeout?: number },
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<BashToolDetails>,
			_ctx?: ExtensionContext,
		): Promise<AgentToolResult<BashToolDetails>> {
			return new Promise((resolve, reject) => {
				const cwd = _ctx?.cwd ?? process.cwd();
				const { shell, args } = getShellConfig();
				if (!existsSync(cwd)) {
					reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
					return;
				}

				const child = spawn(shell, [...args, command], {
					cwd,
					detached: true,
					env: getShellEnv(),
					stdio: ["pipe", "pipe", "pipe"],
				});

				const proc: BashProcess = {
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

				const logPath = getTempFilePath();
				const logStream = createWriteStream(logPath);
				proc.logPath = logPath;
				const m = managed.get(toolCallId)!;
				m.logStream = logStream;

				if (child.pid) trackDetachedChildPid(child.pid);

				channel?.emit("start", {
					type: "start",
					toolCallId,
					pid: child.pid ?? undefined,
					data: command,
					processes: Array.from(managed.values()).map((m) => m.proc),
					timestamp: proc.startedAt,
				} satisfies BashChannelEvent);

				let tempFilePath: string | undefined;
				let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
				let totalBytes = 0;
				const chunks: Buffer[] = [];
				let chunksBytes = 0;
				const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

				const ensureTempFile = () => {
					if (tempFilePath) return;
					tempFilePath = getTempFilePath();
					tempFileStream = createWriteStream(tempFilePath);
					for (const chunk of chunks) tempFileStream.write(chunk);
				};

				const handleData = (data: Buffer) => {
					const m = managed.get(toolCallId);
					if (m?.logStream) m.logStream.write(data);

					if (m?.backgrounded) {
						if (m.outputSubscribed) {
							const text = data.toString("utf-8");
							channel?.emit("output", {
								type: "output",
								toolCallId,
								data: text,
								processes: Array.from(managed.values()).map((x) => x.proc),
								timestamp: Date.now(),
							} satisfies BashChannelEvent);
						}
						return;
					}

					totalBytes += data.length;
					if (totalBytes > DEFAULT_MAX_BYTES) ensureTempFile();
					if (tempFileStream) tempFileStream.write(data);
					chunks.push(data);
					chunksBytes += data.length;
					while (chunksBytes > maxChunksBytes && chunks.length > 1) {
						const removed = chunks.shift()!;
						chunksBytes -= removed.length;
					}

					const text = data.toString("utf-8");
					proc.output += text;

					channel?.emit("output", {
						type: "output",
						toolCallId,
						data: text,
						processes: Array.from(managed.values()).map((x) => x.proc),
						timestamp: Date.now(),
					} satisfies BashChannelEvent);

					if (onUpdate) {
						const fullBuffer = Buffer.concat(chunks);
						const fullText = fullBuffer.toString("utf-8");
						const truncation = truncateTail(fullText);
						if (truncation.truncated) ensureTempFile();
						onUpdate({
							content: [{ type: "text", text: truncation.content || "" }],
							details: {
								truncation: truncation.truncated ? truncation : undefined,
								fullOutputPath: tempFilePath,
							},
						});
					}
				};

				child.stdout?.on("data", handleData);
				child.stderr?.on("data", handleData);

				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | undefined;
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeout * 1000);
				}

				const onAbort = () => {
					if (child.pid) killProcessTree(child.pid);
				};
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}

				waitForChildProcess(child)
					.then((code) => {
						if (child.pid) untrackDetachedChildPid(child.pid);
						if (timeoutHandle) clearTimeout(timeoutHandle);
						if (signal) signal.removeEventListener("abort", onAbort);
						if (tempFileStream) tempFileStream.end();

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
							} satisfies BashChannelEvent);
							if (!deletedIds.has(toolCallId)) history.push({ ...proc });
							managed.delete(toolCallId);
							try {
								pi.sendUserMessage(
									`[system] Background process "${proc.command}" (PID: ${proc.pid ?? "unknown"}) exited with code ${code ?? "unknown"} after ${formatDuration((proc.endedAt ?? Date.now()) - proc.startedAt)}.${proc.logPath ? ` Log: ${proc.logPath}` : ""}`,
								);
							} catch {}
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
							} satisfies BashChannelEvent);
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
										logPath: tempFilePath,
									},
								},
							});
							return;
						}
						if (timedOut) {
							proc.status = "error";
							proc.endedAt = Date.now();
							const durationMs = proc.endedAt - proc.startedAt;
							const outputText = proc.output || "(no output)";
							channel?.emit("error", {
								type: "error",
								toolCallId,
								data: `Timed out after ${timeout}s`,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							} satisfies BashChannelEvent);
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${outputText}\n\n[Timed out after ${timeout}s, PID: ${proc.pid ?? "unknown"}]`,
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
										timeoutSecs: timeout,
										logPath: tempFilePath,
									},
								},
							});
							return;
						}

						proc.exitCode = code;
						proc.endedAt = Date.now();

						const fullBuffer = Buffer.concat(chunks);
						const fullOutput = fullBuffer.toString("utf-8");
						const truncation = truncateTail(fullOutput);
						if (truncation.truncated) ensureTempFile();
						if (tempFileStream) tempFileStream.end();

						let outputText = truncation.content || "(no output)";
						let details: BashToolDetails | undefined;
						if (truncation.truncated) {
							details = { truncation, fullOutputPath: tempFilePath };
							const startLine = truncation.totalLines - truncation.outputLines + 1;
							const endLine = truncation.totalLines;
							outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
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
							} satisfies BashChannelEvent);
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
										logPath: tempFilePath,
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
							} satisfies BashChannelEvent);
							managed.delete(toolCallId);
							resolve({
								content: [{ type: "text", text: outputText }],
								details: details as BashToolDetails,
							} as AgentToolResult<BashToolDetails>);
						}
					})
					.catch((err: Error) => {
						if (child.pid) untrackDetachedChildPid(child.pid);
						if (timeoutHandle) clearTimeout(timeoutHandle);
						if (signal) signal.removeEventListener("abort", onAbort);
						if (tempFileStream) tempFileStream.end();

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
							} satisfies BashChannelEvent);
							if (!deletedIds.has(toolCallId)) history.push({ ...proc });
							managed.delete(toolCallId);
							try {
								pi.sendUserMessage(
									`[system] Background process "${proc.command}" (PID: ${proc.pid ?? "unknown"}) crashed: ${err.message}${proc.logPath ? `. Log: ${proc.logPath}` : ""}`,
								);
							} catch {}
							return;
						}

						const fullBuffer = Buffer.concat(chunks);
						const output = fullBuffer.toString("utf-8") || "(no output)";
						const durationMs = (proc.endedAt || Date.now()) - proc.startedAt;

						if (err.message === "aborted") {
							proc.status = "terminated";
							channel?.emit("terminated", {
								type: "terminated",
								toolCallId,
								data: output,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							} satisfies BashChannelEvent);
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${output}\n\n[Aborted after ${formatDuration(durationMs)}, PID: ${proc.pid ?? "unknown"}]`,
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
										logPath: tempFilePath,
									},
								},
							});
						} else if (err.message.startsWith("timeout:")) {
							const timeoutSecs = Number(err.message.split(":")[1]);
							channel?.emit("error", {
								type: "error",
								toolCallId,
								data: output,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							} satisfies BashChannelEvent);
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${output}\n\n[Timed out after ${timeoutSecs}s, PID: ${proc.pid ?? "unknown"}]`,
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
										logPath: tempFilePath,
									},
								},
							});
						} else {
							channel?.emit("error", {
								type: "error",
								toolCallId,
								data: output,
								processes: Array.from(managed.values()).map((m) => m.proc),
								timestamp: Date.now(),
							} satisfies BashChannelEvent);
							managed.delete(toolCallId);
							resolve({
								content: [
									{
										type: "text",
										text: `${output}\n\n[Command crashed after ${formatDuration(durationMs)}, PID: ${proc.pid ?? "unknown"}: ${err.message}]`,
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
										logPath: tempFilePath,
									},
								},
							});
						}
					});
			});
		},
	});
}
