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
	ToolCallEvent,
} from "@mariozechner/pi-coding-agent";
import type { BashInfo } from "@mariozechner/pi-coding-agent";
import { BashManager, getGlobalBashManager } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";

/** UI Component for displaying bash list */
class BashListComponent implements Component {
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

		lines.push("");
		const title = th.fg("accent" as any, " Bash Processes ");
		const headerLine =
			th.fg("borderMuted" as any, "─".repeat(3)) +
			title +
			th.fg("borderMuted" as any, "─".repeat(Math.max(0, width - 21)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.bashes.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim" as any, "No bash processes")}`, width));
		} else {
			const header = `  ${th.fg("muted" as any, "ID".padEnd(12))} ${th.fg("muted" as any, "Agent".padEnd(15))} ${th.fg("muted" as any, "Status".padEnd(10))} ${th.fg("muted" as any, "Runtime")}`;
			lines.push(truncateToWidth(header, width));
			lines.push("");

			this.bashes.forEach((bash, index) => {
				const isSelected = index === this.selectedIndex;
				const prefix = isSelected ? th.fg("accent" as any, "▶ ") : "  ";
				const id = bash.id.slice(0, 10);
				const agentId = bash.agentId.slice(0, 13);
				const status = bash.status.padEnd(8);
				const runtime = getRuntimeStr(bash);

				let statusColor: any = "muted";
				if (bash.status === "running") statusColor = "green";
				else if (bash.status === "killed") statusColor = "red";
				else if (bash.status === "stopped") statusColor = "yellow";

				const line =
					prefix +
					th.fg("white" as any, id.padEnd(12)) +
					" " +
					th.fg("white" as any, agentId.padEnd(15)) +
					" " +
					th.fg(statusColor, status.padEnd(10)) +
					" " +
					th.fg("muted" as any, runtime);

				lines.push(truncateToWidth(line, width));
			});
		}

		lines.push("");
		lines.push(truncateToWidth(th.fg("dim" as any, "  ↑↓ navigate  enter details  esc close"), width));

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
			console.log(`[bash] /bash args="${args}", hasUI=${ctx.hasUI}`);
			
			// 强制使用 notify 模式便于调试
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "list";
			const bashCount = manager.getAll().length;
			
			ctx.ui.notify(`[debug] subcommand=${subcommand}, count=${bashCount}, hasUI=${ctx.hasUI}`, "info");
			return;
				switch (subcommand) {
					case "list":
					case "active": {
						const bashes = subcommand === "active"
							? manager.getActive()
							: manager.getAll();
						ctx.ui.notify(`Bash: ${bashes.length} processes`, "info");
						break;
					}
					case "clear": {
						const count = manager.getAll().filter((b) => b.status !== "running").length;
						manager.clearStopped();
						ctx.ui.notify(`Cleared ${count} processes`, "info");
						break;
					}
					default:
						ctx.ui.notify(`Unknown: ${subcommand}`, "error");
				}
				return;
			}

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

					// Get theme from session manager or use default
					const theme = (ctx as any).theme;
					if (!theme) {
						ctx.ui.notify("Theme not available", "error");
						return;
					}

					// Show in custom overlay
					try {
						await ctx.ui.custom(
							(tui, theme, _keybindings, done) => {
								const comp = new BashListComponent(bashes, theme, () => done(undefined));
								return comp;
							},
							{
								overlay: true,
								overlayOptions: {
									width: 60,
									maxHeight: 20,
								},
							},
						);
					} catch {
						// User closed or error
					}
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
						ctx.ui.notify(`Killed: ${bashId}`, "info");
					} else {
						ctx.ui.notify(`Not found or stopped: ${bashId}`, "error");
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
					ctx.ui.notify(`Unknown: ${subcommand}`, "error");
			}
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
