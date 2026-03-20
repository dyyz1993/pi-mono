/**
 * Bash Manager Extension - Track and manage bash processes
 *
 * Features:
 * - Tracks all bash executions with agent association
 * - Provides commands to list, kill bash processes
 * - Shows real-time status via /bash command
 * - Provides bash_manager tool for LLM
 *
 * Usage:
 * - /bash list - Show all bash processes
 * - /bash kill <id> - Kill a bash process
 * - /bash clear - Clear stopped processes
 * - /bash active - Show only active processes
 */

import type {
	ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import type { BashInfo } from "@mariozechner/pi-coding-agent";
import { getGlobalBashManager } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, type Component } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";

function getRuntimeStr(bash: BashInfo): string {
	const now = Date.now();
	const end = bash.endTime || now;
	const seconds = Math.floor((end - bash.startTime) / 1000);

	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default function bashManagerExtension(pi: ExtensionAPI) {
	// Get or create global bash manager
	const manager = getGlobalBashManager();

	// Subscribe to bash events
	manager.subscribe((event) => {
		console.log(`[bash-manager] ${event.type}:`, event.bash?.id);
	});

	// Register /bash command
	pi.registerCommand("bash", {
		description: "Manage bash processes",
		getArgumentCompletions: (prefix) => {
			const commands = ["list", "kill", "clear", "active"];
			const filtered = commands.filter((c) => c.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "list";
			
			// 使用 console.log 输出到终端
			const bashes = manager.getAll();
			const active = manager.getActive();
			
			console.log("");
			console.log("=== Bash Processes ===");
			console.log(`Total: ${bashes.length}, Active: ${active.length}`);
			for (const bash of bashes) {
				console.log(`  ${bash.id}: ${bash.status} (${bash.agentId}) - ${bash.command.slice(0, 40)}`);
			}
			console.log("======================");
		},
	});

	// Register a tool to interact with bash manager
	pi.registerTool({
		name: "bash_manager",
		label: "Bash Manager",
		description: "Manage bash processes - list, kill, get info",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "kill", "info", "active"],
					description: "Action to perform",
				},
				bashId: {
					type: "string",
					description: "Bash ID (for kill/info actions)",
				},
			},
			required: ["action"],
		} as any,

		async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
			const { action, bashId } = params as { action: string; bashId?: string };

			switch (action) {
				case "list": {
					const all = manager.getAll();
					return {
						content: [{ type: "text", text: `Total bash processes: ${all.length}\n${all.map((b) => `${b.id}: ${b.status} (${b.agentId})`).join("\n")}` }],
						details: { count: all.length, bashes: all },
					};
				}

				case "active": {
					const active = manager.getActive();
					return {
						content: [{ type: "text", text: `Active bash processes: ${active.length}\n${active.map((b) => `${b.id}: ${b.command.slice(0, 50)}`).join("\n")}` }],
						details: { count: active.length, bashes: active },
					};
				}

				case "info": {
					if (!bashId) {
						return {
							content: [{ type: "text", text: "bashId required for info action" }],
							details: { error: "bashId required" },
						};
					}
					const info = manager.get(bashId);
					if (!info) {
						return {
							content: [{ type: "text", text: `Bash process not found: ${bashId}` }],
							details: { error: "not found" },
						};
					}
					return {
						content: [{
							type: "text",
							text: `ID: ${info.id}\nAgent: ${info.agentId}\nCommand: ${info.command}\nCWD: ${info.cwd}\nStatus: ${info.status}\nRuntime: ${getRuntimeStr(info)}\nExit Code: ${info.exitCode ?? "running"}`,
						}],
						details: info,
					};
				}

				case "kill": {
					if (!bashId) {
						return {
							content: [{ type: "text", text: "bashId required for kill action" }],
							details: { error: "bashId required" },
						};
					}
					const success = manager.kill(bashId);
					return {
						content: [{ type: "text", text: success ? `Killed: ${bashId}` : `Failed to kill: ${bashId}` }],
						details: { success, bashId },
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${action}` }],
						details: { error: "unknown action" },
					};
			}
		},
	});

	console.log("[bash-manager] Extension loaded");
}
