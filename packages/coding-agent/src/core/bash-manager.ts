/**
 * Bash Manager Plugin - Process tracking and management for bash commands
 *
 * Features:
 * - Track all bash processes with their associated agents
 * - Monitor status (active/stopped), runtime, countdown
 * - Event subscription system
 * - Kill support
 */

import { randomBytes } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { getShellConfig, getShellEnv, killProcessTree } from "../utils/shell.js";

/** Unique identifier for a bash process */
export type BashId = string;

/** Bash process status */
export type BashStatus = "running" | "stopped" | "killed" | "timeout";

/** Bash process information */
export interface BashInfo {
	id: BashId;
	agentId: string;
	command: string;
	cwd: string;
	status: BashStatus;
	startTime: number;
	endTime?: number;
	exitCode?: number;
	/** Countdown in seconds (optional, for timed runs) */
	countdown?: number;
	/** AbortSignal for cancellation */
	abortSignal?: AbortSignal;
	/** Child process reference */
	child?: ChildProcess;
}

/** Events emitted by BashManager */
export type BashManagerEvent =
	| { type: "bash_start"; bash: BashInfo }
	| { type: "bash_update"; bash: BashInfo }
	| { type: "bash_end"; bash: BashInfo }
	| { type: "bash_killed"; bash: BashInfo }
	| { type: "bash_error"; bash: BashInfo; error: Error };

/** Options for executing a bash command */
export interface BashExecuteOptions {
	/** Agent ID this bash belongs to */
	agentId: string;
	/** Command to execute */
	command: string;
	/** Working directory */
	cwd?: string;
	/** Countdown timeout in seconds (optional) */
	countdown?: number;
	/** Callback for streaming output */
	onChunk?: (chunk: string) => void;
	/** Callback when process exits */
	onExit?: (exitCode: number | undefined) => void;
}

/** Result of bash execution */
export interface BashExecuteResult {
	id: BashId;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
}

/**
 * Bash Manager - tracks and manages all bash processes
 */
export class BashManager {
	private processes = new Map<BashId, BashInfo>();
	private listeners = new Set<(e: BashManagerEvent) => void>();
	private updateInterval?: NodeJS.Timeout;

	constructor() {
		// Start periodic updates for runtime tracking
		this.updateInterval = setInterval(() => {
			this.tick();
		}, 1000);
	}

	/**
	 * Subscribe to bash manager events
	 */
	subscribe(fn: (e: BashManagerEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(event: BashManagerEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	/**
	 * Generate a unique bash ID
	 */
	private generateId(): BashId {
		return randomBytes(8).toString("hex");
	}

	/**
	 * Execute a bash command and track it
	 */
	execute(options: BashExecuteOptions): BashId {
		const id = this.generateId();
		const { shell, args } = getShellConfig();
		const cwd = options.cwd || process.cwd();

		const abortController = new AbortController();
	const abortSignal = abortController.signal;

		const child: ChildProcess = spawn(shell, [...args, options.command], {
			detached: false,
			env: getShellEnv(),
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
			abortController,
			child,
		};

		this.processes.set(id, bashInfo);
		this.emit({ type: "bash_start", bash: bashInfo });

		// Handle stdout/stderr
		child.stdout?.on("data", (data) => {
			options.onChunk?.(data.toString());
		});

		child.stderr?.on("data", (data) => {
			options.onChunk?.(data.toString());
		});

		// Handle close
		child.on("close", (code) => {
			const info = this.processes.get(id);
			if (info) {
				info.status = code === 0 ? "stopped" : "stopped";
				info.endTime = Date.now();
				info.exitCode = code ?? undefined;
				info.child = undefined;
				info.abortController = undefined;
				this.emit({ type: "bash_end", bash: info });
			}
			options.onExit?.(code ?? undefined);
		});

		child.on("error", (err) => {
			const info = this.processes.get(id);
			if (info) {
				info.status = "killed";
				info.endTime = Date.now();
				this.emit({ type: "bash_error", bash: info, error: err });
			}
		});

		// Handle countdown timeout
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

	/**
	 * Kill a bash process by ID
	 */
	kill(id: BashId): boolean {
		const info = this.processes.get(id);
		if (!info || info.status !== "running") {
			return false;
		}

		if (info.child?.pid) {
			killProcessTree(info.child.pid);
		}

		info.status = "killed";
		info.endTime = Date.now();
		info.exitCode = undefined;
		this.emit({ type: "bash_killed", bash: info });
		return true;
	}

	/**
	 * Get a bash process by ID
	 */
	get(id: BashId): BashInfo | undefined {
		return this.processes.get(id);
	}

	/**
	 * Get all bash processes
	 */
	getAll(): BashInfo[] {
		return Array.from(this.processes.values());
	}

	/**
	 * Get bash processes for a specific agent
	 */
	getByAgent(agentId: string): BashInfo[] {
		return this.getAll().filter((b) => b.agentId === agentId);
	}

	/**
	 * Get only active (running) bash processes
	 */
	getActive(): BashInfo[] {
		return this.getAll().filter((b) => b.status === "running");
	}

	/**
	 * Get runtime in seconds for a bash process
	 */
	getRuntime(id: BashId): number {
		const info = this.processes.get(id);
		if (!info) return 0;
		const end = info.endTime || Date.now();
		return Math.floor((end - info.startTime) / 1000);
	}

	/**
	 * Get remaining countdown time in seconds
	 */
	getCountdownRemaining(id: BashId): number | undefined {
		const info = this.processes.get(id);
		if (!info || !info.countdown) return undefined;
		const elapsed = this.getRuntime(id);
		return Math.max(0, info.countdown - elapsed);
	}

	/**
	 * Remove a bash process from tracking
	 */
	remove(id: BashId): boolean {
		return this.processes.delete(id);
	}

	/**
	 * Clear all stopped processes
	 */
	clearStopped(): void {
		for (const [id, info] of this.processes) {
			if (info.status !== "running") {
				this.processes.delete(id);
			}
		}
	}

	/**
	 * Periodic tick for runtime updates
	 */
	private tick(): void {
		for (const bash of this.getActive()) {
			this.emit({ type: "bash_update", bash });
		}
	}

	/**
	 * Stop the manager and clean up
	 */
	destroy(): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = undefined;
		}
		// Kill all running processes
		for (const bash of this.getActive()) {
			this.kill(bash.id);
		}
		this.processes.clear();
		this.listeners.clear();
	}
}

// =============================================================================
// Global singleton instance
// =============================================================================

let globalManager: BashManager | undefined;

export function getGlobalBashManager(): BashManager {
	if (!globalManager) {
		globalManager = new BashManager();
	}
	return globalManager;
}

export function setGlobalBashManager(manager: BashManager): void {
	globalManager = manager;
}
