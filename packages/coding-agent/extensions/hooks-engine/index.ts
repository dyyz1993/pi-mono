/**
 * Hooks Engine Extension
 *
 * Executes hooks defined in AgentConfig.hooks.
 * Hooks are stored as JSON in event.variables["agentHooks"].
 *
 * Supported events: tool_call, tool_result, agent_start, agent_end
 * Supported hook types: command (spawn process), prompt (inject text)
 *
 * Command hooks: exit code 2 = block operation, 0 = allow, 3 = ask user
 * Prompt hooks: text injected into the conversation
 */

import type { ExtensionAPI, AgentHook, AgentHooks } from "@dyyz1993/pi-coding-agent";
import { spawn } from "node:child_process";

const EVENT_MAP: Record<string, string> = {
	tool_call: "on_tool_start",
	tool_result: "on_tool_complete",
	agent_start: "on_agent_start",
	agent_end: "on_agent_complete",
	session_start: "on_session_start",
	session_shutdown: "on_session_end",
};

// Export types for testing
export type { HookResult };

interface HookResult {
	action: "allow" | "deny" | "ask";
	reason?: string;
	question?: string;
	options?: string[];
	message?: string;
}

export function parseHooks(raw: string | undefined): AgentHooks | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function matchesCondition(condition: string | undefined, event: Record<string, unknown>): boolean {
	if (!condition) return true;
	const toolName = (event.toolName as string) ?? "";
	const parts = condition.split("|").map((s) => s.trim());
	return parts.includes(toolName);
}

export async function executeCommand(
	command: string,
	event: Record<string, unknown>,
	timeout = 5000,
): Promise<{ exitCode: number; stdout: string }> {
	return new Promise((resolve) => {
		const toolName = (event.toolName as string) ?? "";
		const toolCallId = (event.toolCallId as string) ?? "";
		const input = event.input ?? {};
		const vars = event.variables as Record<string, string> | undefined;

		const env: Record<string, string> = {
			...process.env as Record<string, string>,
			// Tool context
			PI_HOOK_TOOL: toolName,
			PI_HOOK_TOOL_CALL_ID: toolCallId,
			PI_HOOK_INPUT: JSON.stringify(input),
			// Agent context (from event.variables)
			PI_HOOK_AGENT_NAME: vars?.agentName ?? "",
			PI_HOOK_PERMISSION_MODE: vars?.permissionMode ?? "",
			PI_HOOK_ALLOWED_TOOLS: vars?.allowedTools ?? "",
			PI_HOOK_DISALLOWED_TOOLS: vars?.disallowedTools ?? "",
			// Session context (if available)
			PI_HOOK_SESSION_ID: (event as any).sessionId ?? "",
			PI_HOOK_CWD: (event as any).cwd ?? "",
		};

		const proc = spawn("sh", ["-c", command], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (data) => {
			stdout += String(data);
		});

		proc.stderr?.on("data", (data) => {
			stderr += String(data);
		});

		const timer = setTimeout(() => {
			proc.kill("SIGTERM");
			resolve({ exitCode: 0, stdout: "" });
		}, timeout);

		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ exitCode: code ?? 0, stdout });
		});

		proc.on("error", () => {
			clearTimeout(timer);
			resolve({ exitCode: 0, stdout: "" });
		});
	});
}

export function parseStdout(stdout: string): HookResult | null {
	if (!stdout.trim()) {
		return null;
	}

	try {
		return JSON.parse(stdout.trim()) as HookResult;
	} catch {
		return null;
	}
}

export default function hooksEngine(pi: ExtensionAPI): void {
	const subscribe = (eventName: string) => {
		const hookKey = EVENT_MAP[eventName];
		if (!hookKey) return;

		pi.on(eventName, async (event: Record<string, unknown>, ctx: any) => {
			const vars = event.variables as Record<string, string> | undefined;
			if (!vars?.agentHooks) return undefined;

			const hooks = parseHooks(vars.agentHooks);
			if (!hooks) return undefined;

			const eventHooks = hooks[hookKey] ?? hooks["*"] ?? [];
			if (eventHooks.length === 0) return undefined;

			const promptResults: string[] = [];

			for (const hook of eventHooks) {
				if (!matchesCondition(hook.if, event)) continue;

				if (hook.type === "command") {
					const { exitCode, stdout } = await executeCommand(hook.command, event);

					if (exitCode === 0 && stdout.trim()) {
						const parsed = parseStdout(stdout);
						if (parsed?.action === "allow" && parsed.message) {
							console.log("[hook] Context injection:", parsed.message);
						} else if (!parsed && stdout.trim()) {
							console.log("[hook] Message:", stdout.trim());
						}
						continue;
					}

					if (exitCode === 2) {
						const parsed = parseStdout(stdout);
						const reason = parsed?.reason ?? stdout.trim() ?? `[hook] Operation blocked by hook: ${hook.command}`;
						return {
							block: true,
							reason,
						};
					}

					if (exitCode === 3) {
						const parsed = parseStdout(stdout);
						const question = parsed?.question ?? stdout.trim() ?? "Confirm this operation?";
						
						if (ctx?.ui?.confirm) {
							const confirmed = await ctx.ui.confirm(question, "no");
							if (!confirmed) {
								return {
									block: true,
									reason: "[hook] User denied the operation",
								};
							}
							continue;
						} else {
							return {
								block: true,
								reason: "[hook] Ask confirmation not supported in this context",
							};
						}
					}

					continue;
				} else if (hook.type === "prompt") {
					promptResults.push(hook.prompt);
				}
			}

			if (promptResults.length > 0) {
				console.log("[hook] Prompts to inject:", promptResults);
				for (const prompt of promptResults) {
					pi.sendUserMessage(prompt, { deliverAs: "followUp" });
				}
			}

			return undefined;
		});
	};

	for (const eventName of Object.keys(EVENT_MAP)) {
		subscribe(eventName);
	}
}