/**
 * Bash Manager Extension - Track and manage bash processes
 *
 * Features:
 * - Tracks all bash executions with agent association
 * - Provides commands to list, kill bash processes
 * - Shows real-time status in footer or via /bash command
 * - Event subscription for bash lifecycle
 *
 * Usage:
 * - /bash list - Show all bash processes
 * - /bash kill <id> - Kill a bash process
 * - /bash clear - Clear stopped processes
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	UserBashEvent,
	UserBashEventResult,
} from "../../src/core/extensions/index.js";
import type { BashInfo, BashManagerEvent } from "../../src/core/bash-manager.js";
import { BashManager, getGlobalBashManager } from "../../src/core/bash-manager.js";
import { matchesKey, Text, truncateToWidth, Box } from "@mariozechner/pi-tui";
import { Theme } from "../../src/modes/interactive/theme/theme.js";

/** Store bash processes in session for persistence across branches */
function getStoredBashes(ctx: ExtensionContext): Map<string, BashInfo> {
	let stored = ctx.session.getCustomData("bash-manager") as Map<string, BashInfo> | undefined;
	if (!stored) {
		stored = new Map();
		ctx.session.setCustomData("bash-manager", stored);
	}
	return stored;
}

/**
 * UI Component for displaying bash list
 */
class BashListComponent {
	private bashes: BashInfo[];
	private selectedIndex: number = 0;
	private theme: Theme;
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(bashes: BashInfo[], theme: Theme, onClose: () => void) {
		this.bashes = bashes;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		} else if (matchesKey(data, "up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.invalidate();
		} else if (matchesKey(data, "down")) {
			this.selectedIndex = Math.min(this.bashes.length - 1, this.selectedIndex + 1);
			this.invalidate();
		} else if (matchesKey(data, "enter")) {
			// Could open details or perform action
			this.onClose();
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines!;
		}

		const lines: string[] = [];
		const th = this.theme;

		// Header
		lines.push("");
		const title = th.fg("accent", " Bash Processes ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) +
			title +
			th.fg("borderMuted", "─".repeat(Math.max(0, width - 21)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.bashes.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No bash processes")}`, width));
		} else {
			// Table header
			const header = `  ${th.fg("muted", "ID".padEnd(12))} ${th.fg("muted", "Agent".padEnd(15))} ${th.fg("muted", "Status".padEnd(10))} ${th.fg("muted", "Runtime")}`;
			lines.push(truncateToWidth(header, width));
			lines.push("");

			// Rows
			this.bashes.forEach((bash, index) => {
				const isSelected = index === this.selectedIndex;
				const prefix = isSelected ? th.fg("accent", "▶ ") : "  ";
				const id = bash.id.slice(0, 10);
				const agentId = bash.agentId.slice(0, 13);
				const status = bash.status.padEnd(8);
				const runtime = getRuntimeStr(bash);

				let statusColor = "muted";
				if (bash.status === "running") statusColor = "green";
				else if (bash.status === "killed") statusColor = "red";
				else if (bash.status === "stopped") statusColor = "yellow";

				const line =
					prefix +
					th.fg("white", id.padEnd(12)) +
					" " +
					th.fg("white", agentId.padEnd(15)) +
					" " +
					th.fg(statusColor as any, status.padEnd(10)) +
					" " +
					th.fg("muted", runtime);

				lines.push(truncateToWidth(line, width));
			});
		}

		lines.push("");
		lines.push(truncateToWidth(th.fg("dim", "  ↑↓ navigate  enter details  esc close"), width));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

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

	// Subscribe to bash events and sync with session storage
	manager.subscribe((event: BashManagerEvent) => {
		// Could emit to extension system or update UI
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

			switch (subcommand) {
				case "list":
				case "active": {
					const bashes = subcommand === "active"
						? manager.getActive()
						: manager.getAll();

					if (bashes.length === 0) {
						ctx.ui.notify("No bash processes", "info");
						return;
					}

					// Show in overlay
					const component = new BashListComponent(bashes, ctx.theme, () => {
						ctx.ui.closeOverlay();
					});
					ctx.ui.showOverlay(component);
					break;
				}

				case "kill": {
					const bashId = parts[1];
					if (!bashId) {
						ctx.ui.notify("Usage: /bash kill <id>", "error");
						return;
					}

					const success = manager.kill(bashId);
					if (success) {
						ctx.ui.notify(`Killed bash process: ${bashId}`, "info");
					} else {
						ctx.ui.notify(`Bash process not found or already stopped: ${bashId}`, "error");
					}
					break;
				}

				case "clear": {
					const count = manager.getAll().filter((b) => b.status !== "running").length;
					manager.clearStopped();
					ctx.ui.notify(`Cleared ${count} stopped processes`, "info");
					break;
				}

				default:
					ctx.ui.notify(`Unknown subcommand: ${subcommand}`, "error");
			}
		},
	});

	// Subscribe to user_bash events to track bash executions
	pi.on("user_bash", async (event: UserBashEvent) => {
		// This event fires when user runs a bash command
		// We can track it here
		console.log("[bash-manager] user bash:", event.command);
	});

	// Subscribe to tool_execution for bash tool
	pi.on("tool_execution_start", async (event: ToolCallEvent) => {
		if (event.toolName === "Bash" || event.toolName === "bash") {
			// Could track bash tool executions
			console.log("[bash-manager] bash tool started:", event.toolCallId);
		}
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
