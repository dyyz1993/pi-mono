import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcExtensionUIContext, DEFAULT_EXTENSION_UI_TIMEOUT_MS } from "../src/modes/rpc/rpc-ui.ts";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "../src/modes/rpc/rpc-types.ts";

describe("RPC extension UI timeout", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("times out confirm requests by default", async () => {
		vi.useFakeTimers();
		const output: unknown[] = [];
		const pending = new Map<
			string,
			{ request: RpcExtensionUIRequest; resolve: (value: RpcExtensionUIResponse) => void; reject: (error: Error) => void }
		>();
		const ui = createRpcExtensionUIContext({
			output: (event) => output.push(event),
			pendingExtensionRequests: pending,
		});

		const result = ui.confirm("Approve?", "Continue?");
		const request = output.find(
			(event): event is RpcExtensionUIRequest =>
				typeof event === "object" &&
				event !== null &&
				"type" in event &&
				event.type === "extension_ui_request",
		);
		expect(request).toMatchObject({
			method: "confirm",
			timeout: DEFAULT_EXTENSION_UI_TIMEOUT_MS,
		});
		expect(pending.size).toBe(1);

		await vi.advanceTimersByTimeAsync(DEFAULT_EXTENSION_UI_TIMEOUT_MS);

		await expect(result).resolves.toBe(false);
		expect(pending.size).toBe(0);
		expect(output).toContainEqual({
			type: "extension_ui_resolved",
			id: request?.id,
			reason: "timeout",
		});
	});

	it("times out editor requests by default", async () => {
		vi.useFakeTimers();
		const output: unknown[] = [];
		const pending = new Map<
			string,
			{ request: RpcExtensionUIRequest; resolve: (value: RpcExtensionUIResponse) => void; reject: (error: Error) => void }
		>();
		const ui = createRpcExtensionUIContext({
			output: (event) => output.push(event),
			pendingExtensionRequests: pending,
		});

		const result = ui.editor("Edit this", "prefill");
		const request = output.find(
			(event): event is RpcExtensionUIRequest =>
				typeof event === "object" &&
				event !== null &&
				"type" in event &&
				event.type === "extension_ui_request",
		);
		expect(request).toMatchObject({
			method: "editor",
			timeout: DEFAULT_EXTENSION_UI_TIMEOUT_MS,
		});
		expect(pending.size).toBe(1);

		await vi.advanceTimersByTimeAsync(DEFAULT_EXTENSION_UI_TIMEOUT_MS);

		await expect(result).resolves.toBeUndefined();
		expect(pending.size).toBe(0);
		expect(output).toContainEqual({
			type: "extension_ui_resolved",
			id: request?.id,
			reason: "timeout",
		});
	});
});
