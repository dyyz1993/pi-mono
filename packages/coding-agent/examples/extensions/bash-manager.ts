/**
 * Bash Manager Extension - Track and manage bash processes
 *
 * Features:
 * - Tracks all bash executions with agent association
 * - Provides commands to list, kill bash processes
 * - Provides bash_manager tool for LLM
 *
 * Usage:
 * - /bash list - Show all bash processes
 * - /bash kill <id> - Kill a bash process
 * - /bash clear - Clear stopped processes
 * - /bash active - Show only active processes
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ============================================================================
// Types
// ============================================================================

type BashId = string;
type BashStatus = "running" | "stopped" | "killed" | "timeout";

interface BashInfo {
	id: BashId;
	agentId: string;
	command: string;
	cwd: string;
	status: BashStatus;
	startTime: number;
	endTime?: number;
	exitCode?: number;
	countdown?: number;
	child?: ChildProcess;
}

type BashExecuteOptions = {
	agentId: string;
	command: string;
	cwd?: string;
	countdown?: number;
	onChunk?: (chunk: string) => void;
	onExit?: (exitCode: number | undefined) => void;
};

// ============================================================================
// Bash Manager (Inline Implementation)
// ============================================================================

class BashManager {
	private processes = new Map<BashId, BashInfo>();
	private listeners = new Set<(e: any) => void>();
	private updateInterval?: NodeJS.Timeout;

	constructor() {
		this.updateInterval = setInterval(() => {
			this.tick();
		}, 1000);
	}

	subscribe(fn: (e: any) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(event: any): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private generateId(): BashId {
		return randomBytes(8).toString("hex");
	}

	execute(options: BashExecuteOptions): BashId {
		const id = this.generateId();
		const shell = "/bin/zsh";
		const args = ["-c", options.command];
		const cwd = options.cwd || process.cwd();

		const child: ChildProcess = spawn(shell, args, {
			detached: false,
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const bashInfo: BashInfo = {
			id,
			agentId: options.agentId,
			command: options.command,
			cwd,
			status: "running",
			startTime: Date.now(),
			countdown: options.countdown,
			child,
		};

		this.processes.set(id, bashInfo);
		this.emit({ type: "bash_start", bash: bashInfo });

		child.stdout?.on("data", (data: Buffer) => {
			options.onChunk?.(data.toString());
		});

		child.stderr?.on("data", (data: Buffer) => {
			options.onChunk?.(data.toString());
		});

		child.on("close", (code) => {
			const info = this.processes.get(id);
			if (info) {
				info.status = code === 0 ? "stopped" : "stopped";
				info.endTime = Date.now();
				info.exitCode = code ?? undefined;
				info.child = undefined;
				this.emit({ type: "bash_end", bash: info });
			}
			options.onExit?.(code ?? undefined);
		});

		child.on("error", (err: Error) => {
			const info = this.processes.get(id);
			if (info) {
				info.status = "killed";
				info.endTime = Date.now();
				this.emit({ type: "bash_error", bash: info, error: err });
			}
		});

		// Countdown timeout
		if (options.countdown && options.countdown > 0) {
			setTimeout(() => {
				const info = this.processes.get(id);
				if (info && info.status === "running") {
					this.kill(id);
				}
			}, options.countdown * 1000);
		}

		return id;
	}

	kill(id: BashId): boolean {
		const info = this.processes.get(id);
		if (!info || info.status !== "running") {
			return false;
		}

		if (info.child?.pid) {
			process.kill(info.child.pid, "SIGTERM");
		}

		info.status = "killed";
		info.endTime = Date.now();
		this.emit({ type: "bash_killed", bash: info });
		return true;
	}

	get(id: BashId): BashInfo | undefined {
		return this.processes.get(id);
	}

	getAll(): BashInfo[] {
		return Array.from(this.processes.values());
	}

	getByAgent(agentId: string): BashInfo[] {
		return this.getAll().filter((b) => b.agentId === agentId);
	}

	getActive(): BashInfo[] {
		return this.getAll().filter((b) => b.status === "running");
	}

	getRuntime(id: BashId): number {
		const info = this.processes.get(id);
		if (!info) return 0;
		const end = info.endTime || Date.now();
		return Math.floor((end - info.startTime) / 1000);
	}

	getCountdownRemaining(id: BashId): number | undefined {
		const info = this.processes.get(id);
		if (!info || !info.countdown) return undefined;
		const elapsed = this.getRuntime(id);
		return Math.max(0, info.countdown - elapsed);
	}

	remove(id: BashId): boolean {
		return this.processes.delete(id);
	}

	clearStopped(): void {
		for (const [id, info] of this.processes) {
			if (info.status !== "running") {
				this.processes.delete(id);
			}
		}
	}

	private tick(): void {
		for (const bash of this.getActive()) {
			this.emit({ type: "bash_update", bash });
		}
	}

	destroy(): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = undefined;
		}
		for (const bash of this.getActive()) {
			this.kill(bash.id);
		}
		this.processes.clear();
		this.listeners.clear();
	}
}

// ============================================================================
// Global Manager
// ============================================================================

let globalManager: BashManager | undefined;

function getGlobalBashManager(): BashManager {
	if (!globalManager) {
		globalManager = new BashManager();
	}
	return globalManager;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getRuntimeStr(bash: BashInfo): string {
	const now = Date.now();
	const end = bash.endTime || now;
	const seconds = Math.floor((end - bash.startTime) / 1000);

	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ============================================================================
// Extension Entry Point
// ============================================================================

export default function bashManagerExtension(pi: ExtensionAPI) {
	const manager = getGlobalBashManager();

	manager.subscribe((event: any) => {
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
		handler: async (args) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "list";

			const bashes = manager.getAll();
			const active = manager.getActive();

			console.log("");
			console.log("=== Bash Processes ===");
			console.log(`Total: ${bashes.length}, Active: ${active.length}`);

			if (bashes.length === 0) {
				console.log("  (no processes)");
			} else {
				for (const bash of bashes) {
					const runtime = getRuntimeStr(bash);
					console.log(
						`  ${bash.id.slice(0, 8)}: ${bash.status.padEnd(8)} [${runtime}] ${bash.command.slice(0, 35)}`,
					);
				}
			}
			console.log("======================");

			// Handle kill command
			if (subcommand === "kill" && parts[1]) {
				const bashId = parts[1];
				const success = manager.kill(bashId);
				console.log(success ? `Killed: ${bashId}` : `Not found or stopped: ${bashId}`);
			}

			// Handle clear command
			if (subcommand === "clear") {
				const count = bashes.filter((b) => b.status !== "running").length;
				manager.clearStopped();
				console.log(`Cleared ${count} stopped processes`);
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

		async execute(toolCallId, params) {
			const { action, bashId } = params as { action: string; bashId?: string };

			switch (action) {
				case "list": {
					const all = manager.getAll();
					return {
						content: [
							{
								type: "text",
								text: `Total bash processes: ${all.length}\n${all.map((b) => `${b.id}: ${b.status} (${b.agentId})`).join("\n")}`,
							},
						],
						details: { count: all.length, bashes: all },
					};
				}

				case "active": {
					const active = manager.getActive();
					return {
						content: [
							{
								type: "text",
								text: `Active bash processes: ${active.length}\n${active.map((b) => `${b.id}: ${b.command.slice(0, 50)}`).join("\n")}`,
							},
						],
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
						content: [
							{
								type: "text",
								text: `ID: ${info.id}\nAgent: ${info.agentId}\nCommand: ${info.command}\nCWD: ${info.cwd}\nStatus: ${info.status}\nRuntime: ${getRuntimeStr(info)}\nExit Code: ${info.exitCode ?? "running"}`,
							},
						],
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
