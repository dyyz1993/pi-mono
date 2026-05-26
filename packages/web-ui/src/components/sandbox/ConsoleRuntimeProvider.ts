import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";
import { type ConsoleMessage, getSandboxWindow, type RuntimeMessage, type RuntimeResponse } from "./sandbox-types.js";

export interface ConsoleLog {
	type: "log" | "warn" | "error" | "info";
	text: string;
	args?: unknown[];
}

/**
 * Console Runtime Provider
 *
 * REQUIRED provider that should always be included first.
 * Provides console capture, error handling, and execution lifecycle management.
 * Collects console output for retrieval by caller.
 */
export class ConsoleRuntimeProvider implements SandboxRuntimeProvider {
	private logs: ConsoleLog[] = [];
	private completionError: { message: string; stack: string } | null = null;
	private completed = false;

	getData(): Record<string, unknown> {
		// No data needed
		return {};
	}

	getDescription(): string {
		return "";
	}

	getRuntime(): (sandboxId: string) => void {
		return (_sandboxId: string) => {
			const sw = getSandboxWindow();

			// Store truly original console methods on first wrap only
			// This prevents accumulation of wrapper functions across multiple executions
			if (!sw.__originalConsole) {
				sw.__originalConsole = {
					log: console.log.bind(console),
					error: console.error.bind(console),
					warn: console.warn.bind(console),
					info: console.info.bind(console),
				};
			}

			// Always use the truly original console, not the current (possibly wrapped) one
			const originalConsole = sw.__originalConsole;

			// Track pending send promises to wait for them in onCompleted
			const pendingSends: Promise<void>[] = [];

			const consoleMethods = ["log", "error", "warn", "info"] as const;
			for (const method of consoleMethods) {
				console[method] = (...args: unknown[]) => {
					const text = args
						.map((arg) => {
							try {
								return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
							} catch {
								return String(arg);
							}
						})
						.join(" ");

					// Always log locally too (using truly original console)
					originalConsole[method](...args);

					// Send immediately and track the promise (only in extension context)
					if (sw.sendRuntimeMessage) {
						const sendPromise = sw
							.sendRuntimeMessage({
								type: "console",
								method,
								text,
								args,
							})
							.catch(() => {});
						pendingSends.push(sendPromise as Promise<void>);
					}
				};
			}

			// Register completion callback to wait for all pending sends
			if (sw.onCompleted) {
				sw.onCompleted(async (_success: boolean) => {
					// Wait for all pending console sends to complete
					if (pendingSends.length > 0) {
						await Promise.all(pendingSends);
					}
				});
			}

			// Track errors for HTML artifacts
			let lastError: { message: string; stack: string } | null = null;

			// Error handlers - track errors but don't log them
			// (they'll be shown via execution-error message)
			window.addEventListener("error", (e) => {
				const text = `${e.error?.stack || e.message || String(e)} at line ${e.lineno || "?"}:${e.colno || "?"}`;

				lastError = {
					message: e.error?.message || e.message || String(e),
					stack: e.error?.stack || text,
				};
			});

			window.addEventListener("unhandledrejection", (e) => {
				const text = `Unhandled promise rejection: ${e.reason?.message || e.reason || "Unknown error"}`;

				lastError = {
					message: e.reason?.message || String(e.reason) || "Unhandled promise rejection",
					stack: e.reason?.stack || text,
				};
			});

			// Expose complete() method for user code to call
			let completionSent = false;
			sw.complete = async (error?: { message: string; stack: string }, returnValue?: unknown) => {
				if (completionSent) return;
				completionSent = true;

				const finalError = error || lastError;

				if (sw.sendRuntimeMessage) {
					if (finalError) {
						await sw.sendRuntimeMessage({
							type: "execution-error",
							error: finalError,
						});
					} else {
						await sw.sendRuntimeMessage({
							type: "execution-complete",
							returnValue,
						});
					}
				}
			};
		};
	}

	async handleMessage(message: RuntimeMessage, respond: (response: RuntimeResponse) => void): Promise<void> {
		if (message.type === "console") {
			const consoleMsg = message as ConsoleMessage;
			// Collect console output
			this.logs.push({
				type:
					consoleMsg.method === "error"
						? "error"
						: consoleMsg.method === "warn"
							? "warn"
							: consoleMsg.method === "info"
								? "info"
								: "log",
				text: consoleMsg.text,
				args: consoleMsg.args,
			});
			// Acknowledge receipt
			respond({ success: true });
		}
	}

	/**
	 * Get collected console logs
	 */
	getLogs(): ConsoleLog[] {
		return this.logs;
	}

	/**
	 * Get completion status
	 */
	isCompleted(): boolean {
		return this.completed;
	}

	/**
	 * Get completion error if any
	 */
	getCompletionError(): { message: string; stack: string } | null {
		return this.completionError;
	}

	/**
	 * Reset state for reuse
	 */
	reset(): void {
		this.logs = [];
		this.completionError = null;
		this.completed = false;
	}
}
