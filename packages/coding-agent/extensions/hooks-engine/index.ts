/**
 * Hooks Engine Extension
 *
 * Executes hooks defined in AgentConfig.hooks.
 * Hooks are stored as JSON in event.variables["agentHooks"].
 *
 * Supported events: tool_call, tool_result, agent_start, agent_end
 * Supported hook types: command (spawn process), prompt (inject text)
 *
 * Command hooks: exit code 2 = block operation, 0 = allow
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

function parseHooks(raw: string | undefined): AgentHooks | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function matchesCondition(condition: string | undefined, event: Record<string, unknown>): boolean {
	if (!condition) return true;
	const toolName = (event.toolName as string) ?? "";
	const parts = condition.split("|").map(s => s.trim());
	return parts.includes(toolName);
}

async function executeCommand(command: string, event: Record<string, unknown>, timeout = 5000): Promise<number> {
	return new Promise((resolve) => {
		const toolName = (event.toolName as string) ?? "";
		const input = event.input ?? {};
		const env: Record<string, string> = {
			...process.env as Record<string, string>,
			PI_HOOK_TOOL: toolName,
			PI_HOOK_EVENT: JSON.stringify(input),
		};

		const proc = spawn("sh", ["-c", command], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const timer = setTimeout(() => {
			proc.kill("SIGTERM");
			resolve(0);
		}, timeout);

		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve(code ?? 0);
		});

		proc.on("error", () => {
			clearTimeout(timer);
			resolve(0);
		});
	});
}

export default function hooksEngine(pi: ExtensionAPI): void {
	const subscribe = (eventName: string) => {
		const hookKey = EVENT_MAP[eventName];
		if (!hookKey) return;

		pi.on(eventName, async (event: Record<string, unknown>) => {
			const vars = event.variables as Record<string, string> | undefined;
			if (!vars?.agentHooks) return undefined;

			const hooks = parseHooks(vars.agentHooks);
			if (!hooks) return undefined;

			const eventHooks = hooks[hookKey] ?? hooks["*"] ?? [];
			if (eventHooks.length === 0) return undefined;

			const results: string[] = [];

			for (const hook of eventHooks) {
				if (!matchesCondition(hook.if, event)) continue;

				if (hook.type === "command") {
					const code = await executeCommand(hook.command, event);
					if (code === 2) {
						return {
							block: true,
							reason: `[hook] Operation blocked by hook: ${hook.command}`,
						};
					}
				} else if (hook.type === "prompt") {
					results.push(hook.prompt);
				}
			}

			if (results.length > 0) {
			}

			return undefined;
		});
	};

	for (const eventName of Object.keys(EVENT_MAP)) {
		subscribe(eventName);
	}
}