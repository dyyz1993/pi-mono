import type { LspRuntimeRegistry } from "../client/registry.js";

const BASE_TIMEOUT_MS = 2 * 60 * 1000;
const STEP_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

export interface IdleCleanerOptions {
	checkIntervalMs?: number;
	baseTimeoutMs?: number;
	stepTimeoutMs?: number;
	maxTimeoutMs?: number;
	onUnload?: (name: string) => void;
}

export function getIdleTimeoutMs(
	accessCount: number,
	options?: { base?: number; step?: number; max?: number },
): number {
	const base = options?.base ?? BASE_TIMEOUT_MS;
	const step = options?.step ?? STEP_TIMEOUT_MS;
	const max = options?.max ?? MAX_TIMEOUT_MS;
	return Math.min(base + accessCount * step, max);
}

export interface IdleCleaner {
	start(): void;
	stop(): void;
	tick(): Promise<void>;
}

export function createIdleCleaner(
	runtime: LspRuntimeRegistry,
	options: IdleCleanerOptions = {},
): IdleCleaner {
	const checkIntervalMs = options.checkIntervalMs ?? 60_000;
	const baseTimeoutMs = options.baseTimeoutMs ?? BASE_TIMEOUT_MS;
	const stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
	const maxTimeoutMs = options.maxTimeoutMs ?? MAX_TIMEOUT_MS;
	const onUnload = options.onUnload;

	let timer: ReturnType<typeof setInterval> | undefined;

	return {
		start(): void {
			this.stop();
			timer = setInterval(() => {
				this.tick();
			}, checkIntervalMs);
			if (timer && typeof timer === "object" && "unref" in timer) {
				timer.unref();
			}
		},

		stop(): void {
			if (timer !== undefined) {
				clearInterval(timer);
				timer = undefined;
			}
		},

		async tick(): Promise<void> {
			const status = runtime.getStatus();
			const toUnload: string[] = [];

			for (const server of status.servers) {
				if (server.status.state !== "ready") continue;

				const meta = runtime.getEntryMeta(server.name);
				if (!meta || meta.isPrimary) continue;

				const timeoutMs = Math.min(
					baseTimeoutMs + meta.accessCount * stepTimeoutMs,
					maxTimeoutMs,
				);
				const idleMs = Date.now() - meta.lastAccessTime;

				if (idleMs > timeoutMs) {
					toUnload.push(server.name);
				}
			}

			for (const name of toUnload) {
				try {
					await runtime.stopSingle(name);
					onUnload?.(name);
				} catch (err) {
					console.warn(`[lsp-idle] Failed to unload "${name}":`, err);
				}
			}
		},
	};
}
