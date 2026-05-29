import { afterEach, describe, expect, it, vi } from "vitest";

describe("executeHttp network failure", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should deny (ok: false) when fetch throws a network error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("ECONNREFUSED");
			}),
		);

		const { executeHttp } = await import("../../extensions/hooks-engine/index.js");
		const result = await executeHttp("http://unreachable-security-hook.local/validate", {
			toolName: "bash",
			toolCallId: "tc_1",
			input: { command: "rm -rf /" },
			variables: {},
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBeGreaterThanOrEqual(500);
	});

	it("should deny (ok: false) when fetch throws a DNS error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("getaddrinfo ENOTFOUND fake.hook.local");
			}),
		);

		const { executeHttp } = await import("../../extensions/hooks-engine/index.js");
		const result = await executeHttp("http://fake.hook.local/check", {
			toolName: "write",
			toolCallId: "tc_2",
			input: {},
			variables: {},
		});

		expect(result.ok).toBe(false);
	});

	it("should deny (ok: false) when fetch throws a timeout error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("AbortError: The operation was aborted due to timeout");
			}),
		);

		const { executeHttp } = await import("../../extensions/hooks-engine/index.js");
		const result = await executeHttp("http://slow-hook.local/check", {
			toolName: "bash",
			toolCallId: "tc_3",
			input: { command: "ls" },
			variables: {},
		});

		expect(result.ok).toBe(false);
		expect(result.body).toBeTruthy();
	});

	it("should return ok: true for successful HTTP responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				text: async () => '{"action":"allow"}',
			})),
		);

		const { executeHttp } = await import("../../extensions/hooks-engine/index.js");
		const result = await executeHttp("http://working-hook.local/check", {
			toolName: "read",
			toolCallId: "tc_4",
			input: {},
			variables: {},
		});

		expect(result.ok).toBe(true);
		expect(result.status).toBe(200);
	});
});
