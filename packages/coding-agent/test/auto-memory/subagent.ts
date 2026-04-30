/**
 * SubAgent Extension - IPC-based sub-agent via JSON mode.
 *
 * Spawns `pi --mode json -p` child processes.
 * - One-shot: child auto-exits after task completion
 * - Events streamed as JSONL on stdout, captured in real-time
 * - Forwarded through the "subagent" channel
 * - Session metadata persisted via appendEntry for history retrieval
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@dyyz1993/pi-agent-core";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "../../src/core/extensions/index.js";
import { ServerChannel } from "../../src/core/extensions/server-channel.js";
import { getSubagentDir } from "./utils.js";

export interface SubagentParams {
	systemPrompt?: string;
	description: string;
	instruction: string;
	cwd?: string;
	model?: string;
}

export interface SubagentSessionInfo {
	toolCallId: string;
	sessionId: string;
	sessionPath: string;
	description: string;
	instruction: string;
	systemPrompt?: string;
	startedAt: number;
	completedAt?: number;
	exitCode?: number;
	finalText?: string;
	error?: string;
}

export interface SubagentDetails {
	sessionId: string;
	sessionPath: string;
	description: string;
	instruction: string;
	events: unknown[];
	messageCount: number;
	startedAt: number;
	completedAt?: number;
	exitCode?: number;
}

const SubagentParamsSchema = Type.Object({
	systemPrompt: Type.Optional(
		Type.String({ description: "System prompt defining the sub-agent's role and behavior" }),
	),
	description: Type.String({ description: "Brief description of the sub-agent's purpose" }),
	instruction: Type.String({ description: "The task instruction to execute" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the sub-agent process" })),
	model: Type.Optional(Type.String({ description: "Model to use (e.g. 'sonnet', 'gpt-4o')" })),
});

export function parseJsonLine(line: string): unknown | null {
	if (!line.trim()) return null;
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

export function getFinalText(messages: Array<{ role?: string; content?: unknown }>): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role !== "assistant") continue;
		const parts = Array.isArray(msg.content) ? msg.content : [msg.content];
		for (const p of parts) {
			if (
				p &&
				typeof p === "object" &&
				"type" in p &&
				p.type === "text" &&
				"text" in p &&
				typeof p.text === "string" &&
				p.text
			) {
				return p.text;
			}
		}
	}
	return "";
}

export function extractTextFromEvent(event: Record<string, unknown>): string {
	const tryExtract = (content: unknown): string => {
		if (!Array.isArray(content)) return "";
		for (const c of content) {
			if (
				c &&
				typeof c === "object" &&
				"type" in c &&
				c.type === "text" &&
				"text" in c &&
				typeof c.text === "string" &&
				c.text
			) {
				return c.text;
			}
		}
		return "";
	};
	let text = tryExtract(event.content);
	if (text) return text;
	if (event.message && typeof event.message === "object" && event.message !== null) {
		text = tryExtract((event.message as Record<string, unknown>).content);
	}
	return text;
}

export interface SubagentResult {
	finalText: string;
	events: unknown[];
	exitCode: number;
}

export function runSubagent(
	args: string[],
	cwd: string,
	channel: { send: (data: unknown) => void },
	sessionId: string,
	signal?: AbortSignal,
	timeoutMs = 300_000,
): Promise<SubagentResult> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let stdoutBuffer = "";
		let finalText = "";
		const events: unknown[] = [];

		const child = spawn("pi", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const finish = (result: SubagentResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			cleanupAbort?.();
			resolve(result);
		};

		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			cleanupAbort?.();
			if (!child.killed) child.kill("SIGTERM");
			reject(err);
		};

		const timeout = setTimeout(() => {
			fail(new Error(`SubAgent timed out (${timeoutMs / 1000}s)`));
		}, timeoutMs);

		let cleanupAbort: (() => void) | undefined;

		child.stdout.on("data", (data: Buffer) => {
			stdoutBuffer += data.toString();
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() || "";

			for (const line of lines) {
				const obj = parseJsonLine(line);
				if (!obj) continue;
				events.push(obj);

				const text = extractTextFromEvent(obj as Record<string, unknown>);
				if (text) finalText = text;

				channel.send({ event: obj, sessionId });
			}
		});

		child.on("error", (err) => {
			fail(err);
		});

		child.on("exit", (code) => {
			finish({
				finalText: finalText || "(no output)",
				events,
				exitCode: code ?? 1,
			});
		});

		if (signal) {
			const killChild = () => {
				if (!child.killed) child.kill("SIGTERM");
			};
			if (signal.aborted) {
				killChild();
			} else {
				signal.addEventListener("abort", killChild, { once: true });
				cleanupAbort = () => signal.removeEventListener("abort", killChild);
			}
		}
	});
}

export default function subagentExtension(pi: ExtensionAPI): void {
	const rawChannel = pi.registerChannel("subagent");
	const channel = new ServerChannel(rawChannel);

	pi.registerTool({
		name: "subagent",
		label: "SubAgent",
		description: [
			"Spawn a sub-agent with isolated context via IPC (JSON mode).",
			"The sub-agent runs in a separate pi process with its own session file.",
			"Real-time events are forwarded through the 'subagent' channel.",
			"Session metadata is stored for later history retrieval.",
		].join(" "),
		promptSnippet: "subagent(description, instruction) — delegate a task to a sub-agent",
		parameters: SubagentParamsSchema,

		async execute(
			toolCallId: string,
			params: SubagentParams,
			signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<SubagentDetails> | undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<SubagentDetails>> {
			const { systemPrompt, description, instruction, cwd, model } = params;
			const sessionId = randomUUID().slice(0, 8);
			const effectiveCwd = cwd ?? ctx.cwd;
			const sessionDir = getSubagentDir(effectiveCwd);
			const sessionPath = path.join(sessionDir, `subagent-${sessionId}.jsonl`);
			const startedAt = Date.now();

			const details: SubagentDetails = {
				sessionId,
				sessionPath,
				description,
				instruction,
				events: [],
				messageCount: 0,
				startedAt,
			};

			const onUpdate = _onUpdate;
			let tmpPromptPath: string | null = null;

			const wrappedChannel = {
				send: (data: unknown) => {
					channel.emit("event", data);
					const payload = data as { event: Record<string, unknown> };
					if (payload.event) {
						details.events.push(payload.event);
						if (payload.event.type === "message_end") {
							details.messageCount++;
						}
						if (onUpdate) {
							const text = extractTextFromEvent(payload.event) || "(running...)";
							onUpdate({
								content: [{ type: "text", text }],
								details: { ...details },
							});
						}
					}
				},
			};

			try {
				channel.emit("subagent_start", {
					event: { type: "subagent_start", toolCallId, description, instruction },
					sessionId,
				});

				const effectiveModel = model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
				const args: string[] = ["--mode", "json", "-p", "--no-extensions", "--session", sessionPath];
				if (effectiveModel) args.push("--model", effectiveModel);
				if (systemPrompt?.trim()) {
					const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-prompt-"));
					tmpPromptPath = path.join(tmpDir, "system-prompt.md");
					await fs.promises.writeFile(tmpPromptPath, systemPrompt, { encoding: "utf-8", mode: 0o600 });
					args.push("--append-system-prompt", tmpPromptPath);
				}
				args.push(instruction);

				const result = await runSubagent(args, effectiveCwd, wrappedChannel, sessionId, signal);

				details.events = result.events;
				details.exitCode = result.exitCode;
				details.completedAt = Date.now();

				pi.appendEntry("subagent", {
					toolCallId,
					sessionId,
					sessionPath,
					description,
					instruction,
					systemPrompt: systemPrompt ? "(provided)" : undefined,
					startedAt,
					completedAt: details.completedAt,
					exitCode: result.exitCode,
					finalText: result.finalText,
				} satisfies SubagentSessionInfo);

				return {
					content: [{ type: "text", text: result.finalText }],
					details,
				};
			} catch (err) {
				details.completedAt = Date.now();
				details.exitCode = 1;
				const errorMessage = err instanceof Error ? err.message : String(err);

				pi.appendEntry("subagent", {
					toolCallId,
					sessionId,
					sessionPath,
					description,
					instruction,
					startedAt,
					completedAt: details.completedAt,
					exitCode: 1,
					error: errorMessage,
				} satisfies SubagentSessionInfo);

				return {
					content: [{ type: "text", text: `SubAgent failed: ${errorMessage}` }],
					details,
				};
			} finally {
				if (tmpPromptPath) {
					const tmpDir = path.dirname(tmpPromptPath);
					try {
						await fs.promises.unlink(tmpPromptPath);
					} catch {}
					try {
						await fs.promises.rmdir(tmpDir);
					} catch {}
				}
			}
		},
	});
}
