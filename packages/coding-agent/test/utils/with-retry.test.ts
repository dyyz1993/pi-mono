import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryableError, withRetry } from "../../src/utils/with-retry.js";

describe("isRetryableError", () => {
	it("returns true for rate limit errors", () => {
		expect(isRetryableError(new Error("429 Too Many Requests"))).toBe(true);
		expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
		expect(isRetryableError(new Error("Too many requests"))).toBe(true);
	});

	it("returns true for server errors", () => {
		expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true);
		expect(isRetryableError(new Error("502 Bad Gateway"))).toBe(true);
		expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
		expect(isRetryableError(new Error("504 Gateway Timeout"))).toBe(true);
		expect(isRetryableError("service unavailable")).toBe(true);
		expect(isRetryableError("server error")).toBe(true);
	});

	it("returns true for network errors", () => {
		expect(isRetryableError(new Error("network error"))).toBe(true);
		expect(isRetryableError(new Error("connection refused"))).toBe(true);
		expect(isRetryableError("connection lost")).toBe(true);
		expect(isRetryableError("fetch failed")).toBe(true);
	});

	it("returns true for timeout errors", () => {
		expect(isRetryableError(new Error("timed out"))).toBe(true);
		expect(isRetryableError("timeout")).toBe(true);
		expect(isRetryableError("request timed out")).toBe(true);
	});

	it("returns true for provider errors", () => {
		expect(isRetryableError(new Error("overloaded"))).toBe(true);
		expect(isRetryableError("provider returned error")).toBe(true);
	});

	it("returns false for non-retryable errors", () => {
		expect(isRetryableError(new Error("context_length_exceeded"))).toBe(false);
		expect(isRetryableError(new Error("invalid api key"))).toBe(false);
		expect(isRetryableError(new Error("not found"))).toBe(false);
		expect(isRetryableError(new Error("permission denied"))).toBe(false);
		expect(isRetryableError(new Error("bad request"))).toBe(false);
	});

	it("returns false for unknown/empty errors", () => {
		expect(isRetryableError(new Error(""))).toBe(false);
		expect(isRetryableError("")).toBe(false);
		expect(isRetryableError(null)).toBe(false);
		expect(isRetryableError(undefined)).toBe(false);
	});

	it("works with plain string errors", () => {
		expect(isRetryableError("429")).toBe(true);
		expect(isRetryableError("connection_error")).toBe(true);
	});
});

describe("withRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns result on first successful call", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await withRetry(fn, { maxRetries: 3 });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on retryable error and succeeds on second attempt", async () => {
		const fn = vi.fn().mockRejectedValueOnce(new Error("503 service unavailable")).mockResolvedValueOnce("recovered");

		const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });
		await vi.advanceTimersByTimeAsync(100);
		const result = await promise;

		expect(result).toBe("recovered");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("applies exponential backoff delays", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("rate limit"))
			.mockRejectedValueOnce(new Error("rate limit"))
			.mockResolvedValueOnce("ok");

		const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(200);
		const result = await promise;

		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("throws after exhausting maxRetries", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("503"));

		const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 50 });
		promise.catch(() => {});
		await vi.advanceTimersByTimeAsync(50);
		await vi.advanceTimersByTimeAsync(100);
		await expect(promise).rejects.toThrow("503");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("does not retry non-retryable errors", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("invalid api key"));

		await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow("invalid api key");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("calls onRetry with correct info", async () => {
		const onRetry = vi.fn();
		const error = new Error("503");
		const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("ok");

		const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 200, onRetry });
		await vi.advanceTimersByTimeAsync(200);
		await promise;

		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith({
			attempt: 1,
			maxAttempts: 3,
			delayMs: 200,
			error,
		});
	});

	it("throws immediately if signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const fn = vi.fn().mockResolvedValue("ok");

		await expect(withRetry(fn, { maxRetries: 3, signal: controller.signal })).rejects.toThrow("Aborted");
		expect(fn).not.toHaveBeenCalled();
	});

	it("throws when signal is aborted during sleep", async () => {
		const controller = new AbortController();
		const fn = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce("ok");

		const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 5000, signal: controller.signal });
		controller.abort();
		await expect(promise).rejects.toThrow("Aborted");
	});

	it("uses default baseDelayMs of 5000", async () => {
		const onRetry = vi.fn();
		const fn = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce("ok");

		const promise = withRetry(fn, { maxRetries: 2, onRetry });
		await vi.advanceTimersByTimeAsync(5000);
		await promise;

		expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 5000 }));
	});

	it("uses custom baseDelayMs", async () => {
		const onRetry = vi.fn();
		const fn = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce("ok");

		const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 250, onRetry });
		await vi.advanceTimersByTimeAsync(250);
		await promise;

		expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 250 }));
	});
});
