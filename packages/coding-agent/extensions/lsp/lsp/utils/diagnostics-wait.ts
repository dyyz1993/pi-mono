import type { LspRuntimeRegistry } from "../client/registry.js";

export interface DiagnosticsWaitOptions {
	initialDelayMs?: number;
	pollIntervalMs?: number;
	maxWaitMs?: number;
}

const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_POLL_INTERVAL_MS = 300;
const DEFAULT_MAX_WAIT_MS = 2500;

/**
 * Wait for the LSP server to push fresh diagnostics for a file after a didOpen
 * notification. The caller should clear stale diagnostics before calling this.
 *
 * We always wait at least one poll cycle after the initial delay so the LSP
 * server has time to re-analyze the file, even if diagnostics from a previous
 * analysis are still present.
 */
export async function waitForPushDiagnostics(
	runtime: LspRuntimeRegistry,
	filePath: string,
	options: DiagnosticsWaitOptions = {},
): Promise<void> {
	const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

	await sleep(initialDelayMs);

	const start = Date.now();

	while (Date.now() - start < maxWaitMs) {
		const currentCount = runtime.getPublishedDiagnostics(filePath).length;
		if (currentCount > 0) return;
		await sleep(pollIntervalMs);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
