/**
 * Agent Permissions Extension
 *
 * Implements Claude Code-style permissionMode for sub-agents.
 * Works with AgentConfig.permissionMode to control tool access.
 *
 * Modes:
 *   auto         — default behavior, all tools allowed
 *   acceptEdits  — auto-allow edit/write, block dangerous bash
 *   plan         — read-only: block edit/write/bash
 *   dontAsk      — auto-allow everything (no blocking)
 *   always-allow — same as dontAsk
 *   always-deny  — block everything
 */

import type { ExtensionAPI, ExtensionContext } from "@dyyz1993/pi-coding-agent";
import type { AgentConfig } from "../subagent/agents.js";

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const DANGEROUS_BASH_PATTERNS = [
	/\brm\s+-rf\b/,
	/\bgit\s+push\s+.*--force\b/,
	/--no-verify/,
	/\bsudo\b/,
	/\bchmod\s+777\b/,
	/\.env/,
	/credentials/i,
];

interface PermissionRule {
	mode: string;
	allowedTools: Set<string> | null;
	blockedTools: Set<string> | null;
	blockBashPatterns: RegExp[] | null;
}

const RULES: Record<string, PermissionRule> = {
	auto: {
		mode: "auto",
		allowedTools: null,
		blockedTools: null,
		blockBashPatterns: DANGEROUS_BASH_PATTERNS,
	},
	acceptEdits: {
		mode: "acceptEdits",
		allowedTools: null,
		blockedTools: null,
		blockBashPatterns: DANGEROUS_BASH_PATTERNS,
	},
	plan: {
		mode: "plan",
		allowedTools: READ_TOOLS,
		blockedTools: EDIT_TOOLS,
		blockBashPatterns: null,
	},
	dontAsk: {
		mode: "dontAsk",
		allowedTools: null,
		blockedTools: null,
		blockBashPatterns: null,
	},
	"always-allow": {
		mode: "always-allow",
		allowedTools: null,
		blockedTools: null,
		blockBashPatterns: null,
	},
	"always-deny": {
		mode: "always-deny",
		allowedTools: new Set(),
		blockedTools: null,
		blockBashPatterns: null,
	},
};

function matchesToolPattern(toolName: string, pattern: string): boolean {
	const parenIdx = pattern.indexOf("(");
	if (parenIdx === -1) return pattern === toolName;
	const baseTool = pattern.substring(0, parenIdx).trim();
	if (baseTool !== toolName) return false;
	return true;
}

function matchesDisallowedTool(
	toolName: string,
	input: Record<string, unknown>,
	patterns: string[],
): boolean {
	for (const pattern of patterns) {
		const parenIdx = pattern.indexOf("(");
		if (parenIdx === -1) {
			if (pattern === toolName) return true;
			continue;
		}
		const baseTool = pattern.substring(0, parenIdx).trim();
		if (baseTool !== toolName) continue;
		const globPattern = pattern.substring(parenIdx + 1, pattern.lastIndexOf(")")).trim();
		if (!globPattern || globPattern === "*") {
			return true;
		}
		const parts = globPattern.split("|");
		const inputStr = JSON.stringify(input);
		for (const part of parts) {
			const trimmed = part.trim();
			if (!trimmed) continue;
			const regex = new RegExp(
				`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ".*" : ch === "?" ? "." : `\\${ch}`))}$`,
			);
			if (regex.test(inputStr) || (input.command && typeof input.command === "string" && regex.test(input.command))) {
				return true;
			}
		}
	}
	return false;
}

export function createPermissionHandler(agentConfig: AgentConfig) {
	const mode = agentConfig.permissionMode ?? "auto";
	const rule = RULES[mode];
	if (!rule) return null;

	const disallowedTools = agentConfig.disallowedTools ?? [];

	return (event: { toolName: string; input: Record<string, unknown> }): { block: boolean; reason?: string } | null => {
		if (rule.allowedTools !== null && !rule.allowedTools.has(event.toolName) && event.toolName !== "bash") {
			const allowed = Array.from(rule.allowedTools).join(", ");
			return {
				block: true,
				reason: `[${mode} mode] Tool "${event.toolName}" not allowed. Allowed: ${allowed}`,
			};
		}

		if (rule.blockedTools !== null && rule.blockedTools.has(event.toolName)) {
			return {
				block: true,
				reason: `[${mode} mode] Tool "${event.toolName}" is blocked (read-only mode).`,
			};
		}

		if (event.toolName === "bash" && rule.mode === "plan") {
			return {
				block: true,
				reason: `[plan mode] Bash is not allowed in plan mode.`,
			};
		}

		if (event.toolName === "bash" && rule.blockBashPatterns) {
			const command = event.input?.command;
			if (typeof command === "string") {
				for (const pat of rule.blockBashPatterns) {
					if (pat.test(command)) {
						return {
							block: true,
							reason: `[${mode} mode] Blocked dangerous bash command: ${command}`,
						};
					}
				}
			}
		}

		if (disallowedTools.length > 0 && matchesDisallowedTool(event.toolName, event.input, disallowedTools)) {
			return {
				block: true,
				reason: `[disallowedTools] Tool "${event.toolName}" is explicitly disallowed.`,
			};
		}

		return null;
	};
}

export default function agentPermissions(pi: ExtensionAPI, ctx: ExtensionContext): void {
	pi.on("tool_call", (event) => {
		const vars = (event as { variables?: Record<string, string> }).variables;
		const mode = vars?.["permissionMode"];
		if (!mode || mode === "auto" || mode === "dontAsk" || mode === "always-allow") return undefined;

		const handler = createPermissionHandler({
			name: vars["agentName"] ?? "unknown",
			description: "",
			permissionMode: mode as AgentConfig["permissionMode"],
			disallowedTools: vars["disallowedTools"]?.split(",").filter(Boolean),
		} as AgentConfig);

		if (!handler) return undefined;
		const result = handler({ toolName: event.toolName, input: event.input });
		if (result?.block) {
			return { block: true, reason: result.reason };
		}
		return undefined;
	});
}
