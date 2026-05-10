import type { LspRuntimeRegistry } from "../client/registry.js";

export interface DiagnosticsWaitOptions {
	initialDelayMs?: number;
	pollIntervalMs?: number;
	maxWaitMs?: number;
}

const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_POLL_INTERVAL_MS = 300;
const DEFAULT_MAX_WAIT_MS = 2500;

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
	let previousCount = runtime.getPublishedDiagnostics(filePath).length;

	if (previousCount > 0) return;

	while (Date.now() - start < maxWaitMs) {
		await sleep(pollIntervalMs);
		const currentCount = runtime.getPublishedDiagnostics(filePath).length;
		if (currentCount > 0) return;
		if (currentCount !== previousCount) {
			previousCount = currentCount;
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
