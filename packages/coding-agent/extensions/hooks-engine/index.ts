/**
 * Hooks Engine Extension
 *
 * Unified multi-level hooks: Global → Project → Agent.
 *
 * Hook sources (executed in order):
 *   1. Global settings:    ~/.pi/agent/settings.json  → hooks field
 *   2. Project settings:   <project>/.pi/settings.json → hooks field
 *   3. Agent hooks:        agent markdown frontmatter  → hooks field (via event.variables["agentHooks"])
 *
 * All sources are concatenated per event key. Any hook returning deny (exit 2) short-circuits.
 * Claude-compatible hooks (.claude/settings.json) are handled by the separate claude-hooks-compat extension.
 *
 * Supported events: tool_call, tool_result, agent_start, agent_end, session_start, session_shutdown
 * Supported hook types: command (spawn process), prompt (inject text), http (POST request)
 *
 * Command hooks: exit code 2 = block operation, 0 = allow, 3 = ask user
 */

import type { ExtensionAPI, ExtensionContext, AgentHook, AgentHooks, AgentHookEntry } from "@dyyz1993/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

/** Hooks shape stored in settings.json (same as AgentHooks but looser typing for disk-loaded JSON). */
type SettingsHooks = Partial<Record<string, unknown[]>>;

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
	const toolName = ((event.toolName as string) ?? "").toLowerCase();

	// Fast path: simple alphanumeric with optional pipe separators and whitespace
	if (/^[a-zA-Z0-9_| ]+$/.test(condition)) {
		const parts = condition.split("|").map((s) => s.trim().toLowerCase());
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
			// Session context (passed via variables by the runner)
			PI_HOOK_SESSION_ID: vars?.sessionId ?? "",
			PI_HOOK_CWD: vars?.cwd ?? "",
		};

		// Structured JSON input for stdin (for scripts that prefer stdin over env vars)
		const stdinPayload = JSON.stringify({
			toolName,
			toolCallId,
			input,
			sessionId: vars?.sessionId ?? "",
			cwd: vars?.cwd ?? "",
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
	const vars = event.variables as Record<string, string> | undefined;
	const payload = {
		toolName: (event.toolName as string) ?? "",
		toolCallId: (event.toolCallId as string) ?? "",
		input: event.input ?? {},
		sessionId: vars?.sessionId ?? "",
		cwd: vars?.cwd ?? "",
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

// ---------------------------------------------------------------------------
// Settings hooks loading (global ~/.pi/agent/settings.json + project .pi/settings.json)
// ---------------------------------------------------------------------------

/** Read hooks from a single settings.json file. Returns null if file missing or no hooks. */
export function loadSettingsHooks(filePath: string): AgentHooks | null {
	if (!existsSync(filePath)) return null;
	try {
		const raw = readFileSync(filePath, "utf-8");
		const json = JSON.parse(raw) as { hooks?: SettingsHooks };
		if (!json.hooks || typeof json.hooks !== "object") return null;
		const hooks: AgentHooks = {};
		for (const [eventKey, entries] of Object.entries(json.hooks)) {
			if (Array.isArray(entries) && entries.length > 0) {
				hooks[eventKey] = entries as AgentHookEntry[];
			}
		}
		return Object.keys(hooks).length > 0 ? hooks : null;
	} catch {
		return null;
	}
}

/** Load and merge hooks from global + project settings files. */
export function loadMergedSettingsHooks(projectDir: string): AgentHooks {
	const globalPath = join(homedir(), ".pi", "agent", "settings.json");
	const projectPath = join(projectDir, ".pi", "settings.json");

	const globalHooks = loadSettingsHooks(globalPath);
	const projectHooks = loadSettingsHooks(projectPath);

	// Merge: project hooks APPEND to global hooks per event key
	const merged: AgentHooks = { ...(globalHooks ?? {}) };
	for (const [eventKey, entries] of Object.entries(projectHooks ?? {})) {
		const existing = merged[eventKey] ?? [];
		merged[eventKey] = [...existing, ...entries];
	}
	return merged;
}

// ---------------------------------------------------------------------------
// Hook execution
// ---------------------------------------------------------------------------

async function processHook(
	hook: AgentHook,
	event: Record<string, unknown>,
	ctx: ExtensionContext,
	onceSet: Set<string>,
	hookKey: string,
	promptResults: string[],
): Promise<{ block: true; reason: string } | undefined> {
	// once dedup: skip if this hook already fired
	if (hook.once) {
		const onceKey = `${hookKey}:${"command" in hook ? hook.command : "url" in hook ? hook.url : hook.prompt}:${hook.if ?? ""}`;
		if (onceSet.has(onceKey)) return undefined;
		onceSet.add(onceKey);
	}

	if (!matchesCondition(hook.if, event)) return undefined;

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
			const question = parsed?.question || parsed?.reason || stdout.trim() || "Confirm this operation?";

			if (ctx?.ui?.confirm) {
				const confirmed = await ctx.ui.confirm("Hook Confirmation", question);
				if (!confirmed) {
					return { block: true, reason: `[hook] User denied: ${question}` };
				}
				return undefined;
			} else {
				return { block: true, reason: `[hook] Confirmation required (no UI available): ${question}` };
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

/** Execute a list of hook entries (flat or HookGroup). Returns first block result or undefined. */
async function executeHookEntries(
	entries: AgentHookEntry[],
	event: Record<string, unknown>,
	ctx: ExtensionContext,
	onceSet: Set<string>,
	hookKey: string,
	promptResults: string[],
): Promise<{ block: true; reason: string } | undefined> {
	const toolName = (event.toolName as string) ?? "";

	for (const entry of entries) {
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

	return undefined;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function hooksEngine(pi: ExtensionAPI): void {
	const onceSet = new Set<string>();

	// Cached settings hooks, refreshed on session_start
	let cachedSettingsHooks: AgentHooks = {};

	const subscribe = (eventName: string) => {
		const hookKey = EVENT_MAP[eventName];
		if (!hookKey) return;

		pi.on(eventName, async (event: Record<string, unknown>, ctx: ExtensionContext) => {
			// For session_start: refresh settings hooks cache first
			if (eventName === "session_start") {
				const cwd = ctx?.cwd;
				if (cwd) {
					cachedSettingsHooks = loadMergedSettingsHooks(cwd);
					const hookCount = Object.values(cachedSettingsHooks).reduce((sum, arr) => sum + arr.length, 0);
					if (hookCount > 0) {
						console.log(`[hooks-engine] Loaded ${hookCount} settings hooks for ${Object.keys(cachedSettingsHooks).join(", ")}`);
					}
				}
			}

			// Collect hooks from all sources in priority order:
			// 1. Settings hooks (global → project, already merged in cachedSettingsHooks)
			// 2. Agent hooks (from agent markdown frontmatter, passed via event.variables)
			const settingsHooks = cachedSettingsHooks[hookKey] ?? cachedSettingsHooks["*"] ?? [];

			const vars = event.variables as Record<string, string> | undefined;
			const agentHooksRaw = vars?.agentHooks;
			const agentHooks = agentHooksRaw ? parseHooks(agentHooksRaw) : null;
			// Agent hooks use original event names (agent_start, tool_call, etc.)
			// while EVENT_MAP maps them to on_agent_start, on_tool_start, etc.
			// Try both the mapped key and the original event name for compatibility.
			const agentEventHooks = agentHooks?.[hookKey] ?? agentHooks?.[eventName] ?? agentHooks?.["*"] ?? [];

			// Merge: settings hooks first, then agent hooks
			const allHooks = [...settingsHooks, ...agentEventHooks];
			if (allHooks.length === 0) return undefined;

			const promptResults: string[] = [];

			const blockResult = await executeHookEntries(allHooks, event, ctx, onceSet, hookKey, promptResults);
			if (blockResult) return blockResult;

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
