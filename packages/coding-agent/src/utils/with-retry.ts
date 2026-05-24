/**
 * Generic retry utility with exponential backoff.
 * Extracted from agent-session's _handleRetryableError for reuse in callLLM().
 */

import { sleep } from "./sleep.js";

/**
 * Error pattern matching — identical to agent-session's _isRetryableError regex.
 * Matches: overloaded, provider errors, rate limits (429), server errors (500-504),
 * network/connection errors, WebSocket transport errors, fetch failures, timeouts, etc.
 */
const RETRYABLE_ERROR_PATTERN =
	/overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

/**
 * Check if an error is retryable (same logic as agent-session's _isRetryableError).
 */
export function isRetryableError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error);
	return RETRYABLE_ERROR_PATTERN.test(msg);
}

export interface RetryOptions {
	/** Maximum number of retry attempts */
	maxRetries: number;
	/** Base delay in ms for exponential backoff (delay = baseDelayMs * 2^attempt) */
	baseDelayMs?: number;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Called when a retry is about to happen (for UI events, logging, etc.) */
	onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
}

/**
 * Execute a function with exponential backoff retry.
 * Reuses the same retry pattern as agent-session's _handleRetryableError:
 * - Same error pattern matching (isRetryableError)
 * - Same exponential backoff (baseDelayMs * 2^attempt)
 * - Same abort support via sleep()
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
	const { maxRetries, baseDelayMs = 5000, signal, onRetry } = options;

	for (let attempt = 0; ; attempt++) {
		try {
			if (signal?.aborted) throw new Error("Aborted");
			return await fn();
		} catch (err) {
			if (!isRetryableError(err)) throw err;
			if (attempt >= maxRetries) throw err;

			const delayMs = baseDelayMs * 2 ** attempt;

			onRetry?.({ attempt: attempt + 1, maxAttempts: maxRetries, delayMs, error: err });

			await sleep(delayMs, signal);
		}
	}
}
