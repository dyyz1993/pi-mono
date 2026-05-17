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

import type { ExtensionAPI, ExtensionContext, AgentHook, AgentHooks, AgentHookEntry } from "@dyyz1993/pi-coding-agent";
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

	// Fast path: simple alphanumeric with optional pipe separators and whitespace
	if (/^[a-zA-Z0-9_| ]+$/.test(condition)) {
		const parts = condition.split("|").map((s) => s.trim());
		return parts.includes(toolName);
	}

	// Regex path: for patterns containing regex metacharacters
	try {
		return new RegExp(condition).test(toolName);
	} catch {
		return false;
	}
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

		// Structured JSON input for stdin (for scripts that prefer stdin over env vars)
		const stdinPayload = JSON.stringify({
			toolName,
			toolCallId,
			input,
			sessionId: (event as any).sessionId ?? "",
			cwd: (event as any).cwd ?? "",
			variables: vars ?? {},
		});

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

		// Write JSON to stdin and close
		proc.stdin.write(stdinPayload);
		proc.stdin.end();

		const timer = setTimeout(() => {
			proc.kill("SIGTERM");
			// Default to deny on timeout (safer than allowing through)
			resolve({ exitCode: 2, stdout: "" });
		}, timeout);

		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ exitCode: code ?? 0, stdout });
		});

		proc.on("error", () => {
			clearTimeout(timer);
			// Default to deny if the hook command fails to start
			resolve({ exitCode: 2, stdout: "" });
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

async function executeHttp(
	url: string,
	event: Record<string, unknown>,
	options?: { headers?: Record<string, string>; timeout?: number },
): Promise<{ ok: boolean; status: number; body: string }> {
	const payload = {
		toolName: (event.toolName as string) ?? "",
		toolCallId: (event.toolCallId as string) ?? "",
		input: event.input ?? {},
		sessionId: (event as any).sessionId ?? "",
		cwd: (event as any).cwd ?? "",
	};

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(options?.headers ?? {}),
	};

	try {
		const ms = (options?.timeout ?? 60) * 1000;
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(ms),
		});
		const body = await res.text();
		return { ok: res.ok, status: res.status, body };
	} catch {
		return { ok: true, status: 200, body: "" };
	}
}

export function isHookGroup(entry: AgentHookEntry): entry is AgentHookGroup {
	return "hooks" in entry && Array.isArray((entry as AgentHookGroup).hooks);
}

export interface AgentHookGroup {
	matcher?: string;
	hooks: AgentHook[];
}

/** Check if a HookGroup's matcher matches the current event's tool name */
export function groupMatches(matcher: string | undefined, toolName: string): boolean {
	if (!matcher || matcher === "" || matcher === "*") return true;
	return matchesCondition(matcher, { toolName });
}

async function processHook(
	hook: AgentHook,
	event: Record<string, unknown>,
	ctx: ExtensionContext,
	onceSet: Set<string>,
	hookKey: string,
	promptResults: string[],
): Promise<{ block: true; reason: string } | undefined> {
	if (!matchesCondition(hook.if, event)) return undefined;

	// once dedup
	if (hook.once) {
		const onceKey = `${hookKey}:${"command" in hook ? hook.command : "url" in hook ? hook.url : hook.prompt}:${hook.if ?? ""}`;
		if (onceSet.has(onceKey)) return undefined;
		onceSet.add(onceKey);
	}

	if (hook.type === "command") {
		const timeout = hook.timeout;
		const { exitCode, stdout } = await executeCommand(hook.command, event, timeout);

		if (exitCode === 0 && stdout.trim()) {
			const parsed = parseStdout(stdout);
			if (parsed?.action === "allow" && parsed.message) {
				console.log("[hook] Context injection:", parsed.message);
			} else if (!parsed && stdout.trim()) {
				console.log("[hook] Message:", stdout.trim());
			}
			return undefined;
		}

		if (exitCode === 2) {
			const parsed = parseStdout(stdout);
			const reason = parsed?.reason || stdout.trim() || `[hook] Operation blocked by hook: ${hook.command}`;
			return { block: true, reason };
		}

		if (exitCode === 3) {
			const parsed = parseStdout(stdout);
			const question = parsed?.question || stdout.trim() || "Confirm this operation?";

			if (ctx?.ui?.confirm) {
				const confirmed = await ctx.ui.confirm("Hook Confirmation", question);
				if (!confirmed) {
					return { block: true, reason: "[hook] User denied the operation" };
				}
				return undefined;
			} else {
				return { block: true, reason: "[hook] Ask confirmation not supported in this context" };
			}
		}

		return undefined;
	} else if (hook.type === "http") {
		const { ok, status, body } = await executeHttp(hook.url, event, {
			headers: hook.headers,
			timeout: hook.timeout,
		});

		if (status === 403 || (!ok && status >= 400)) {
			const parsed = parseStdout(body);
			const reason = parsed?.reason || body || `[hook] HTTP hook denied: ${hook.url}`;
			return { block: true, reason };
		}

		if (ok && body.trim()) {
			const parsed = parseStdout(body);
			if (parsed?.action === "allow" && parsed.message) {
				console.log("[hook] Context injection:", parsed.message);
			} else if (!parsed && body.trim()) {
				console.log("[hook] Message:", body.trim());
			}
		}

		return undefined;
	} else if (hook.type === "prompt") {
		promptResults.push(hook.prompt);
	}

	return undefined;
}

export default function hooksEngine(pi: ExtensionAPI): void {
	const onceSet = new Set<string>();

	const subscribe = (eventName: string) => {
		const hookKey = EVENT_MAP[eventName];
		if (!hookKey) return;

		pi.on(eventName, async (event: Record<string, unknown>, ctx: ExtensionContext) => {
			const vars = event.variables as Record<string, string> | undefined;
			if (!vars?.agentHooks) return undefined;

			const hooks = parseHooks(vars.agentHooks);
			if (!hooks) return undefined;

			const eventHooks = hooks[hookKey] ?? hooks["*"] ?? [];
			if (eventHooks.length === 0) return undefined;

			const promptResults: string[] = [];
			const toolName = (event.toolName as string) ?? "";

			for (const entry of eventHooks) {
				// Handle HookGroup format
				if (isHookGroup(entry)) {
					if (!groupMatches(entry.matcher, toolName)) continue;

					for (const hook of entry.hooks) {
						const result = await processHook(hook, event, ctx, onceSet, hookKey, promptResults);
						if (result) return result;
					}
					continue;
				}

				// Handle flat hook
				const result = await processHook(entry as AgentHook, event, ctx, onceSet, hookKey, promptResults);
				if (result) return result;
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