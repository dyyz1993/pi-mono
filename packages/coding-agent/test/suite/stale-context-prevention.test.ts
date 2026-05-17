/**
 * Tests for stale context prevention after session replacement.
 *
 * These tests verify that after reload/newSession/fork, captured `pi` and `ctx`
 * references from extensions continue to work instead of throwing
 * "This extension ctx is stale" errors.
 *
 * TDD: These should FAIL with the current architecture (stale errors),
 * then PASS after the RuntimeSlot proxy fix is complete.
 */
import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../src/index.js";
import { createHarness } from "./harness.js";

describe("stale context prevention", () => {
	it("pi.appendEntry should work after reload without stale error", async () => {
		let capturedPi: ExtensionAPI | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					capturedPi = pi;
					pi.on("session_start", async () => {
						// no-op
					});
				},
			],
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		// Before reload: pi works
		expect(() => capturedPi!.appendEntry("test", { before: true })).not.toThrow();

		// Reload — this used to invalidate the old runtime
		await harness.session.reload();

		// After reload: pi should still work (no stale error)
		expect(() => capturedPi!.appendEntry("test", { after: true })).not.toThrow();

		harness.cleanup();
	});

	it("pi.sendMessage should work after reload without stale error", async () => {
		let capturedPi: ExtensionAPI | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					capturedPi = pi;
				},
			],
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		expect(() => capturedPi!.sendMessage({ customType: "test", content: "before" })).not.toThrow();

		await harness.session.reload();

		// This is the critical test: old pi.sendMessage after reload
		expect(() => capturedPi!.sendMessage({ customType: "test", content: "after" })).not.toThrow();

		harness.cleanup();
	});

	it("pi.callLLM should not throw stale error after reload (provider error is OK)", async () => {
		let capturedPi: ExtensionAPI | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					capturedPi = pi;
				},
			],
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });
		await harness.session.reload();

		// callLLM should NOT throw stale error — provider errors are expected
		// after reload if providers were reset, but stale errors are the bug.
		try {
			await capturedPi!.callLLM({ messages: [] });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			// The key assertion: must NOT be a stale error
			expect(msg).not.toMatch(/stale/i);
		}

		harness.cleanup();
	});

	it("ctx fields should remain accessible after reload without stale error", async () => {
		let capturedCwd: string | undefined;
		let capturedSessionManagerPath: string | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.on("session_start", async (_event, ctx) => {
						// Capture ctx values that will be tested after reload
						capturedCwd = ctx.cwd;
						capturedSessionManagerPath = ctx.sessionManager.getSessionFile() ?? "in-memory";
					});
				},
			],
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		// session_start fires, capturing ctx values
		expect(capturedCwd).toBe(harness.tempDir);

		await harness.session.reload();

		// After reload, session_start fires again with new ctx
		// The key test: the new ctx should work (values updated)
		expect(capturedCwd).toBe(harness.tempDir);

		harness.cleanup();
	});

	it("extension that captures pi in a timeout should not throw after reload", async () => {
		let staleError: Error | undefined;
		let capturedPi: ExtensionAPI | undefined;

		const harness = await createHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					capturedPi = pi;
				},
			],
		});

		await harness.session.bindExtensions({ shutdownHandler: () => {} });

		await harness.session.reload();

		// Simulate what session-supervisor does: setTimeout → pi.sendMessage
		try {
			capturedPi!.sendMessage({
				customType: "supervisor_continue",
				content: "auto-continue",
				display: true,
			});
		} catch (err) {
			staleError = err instanceof Error ? err : new Error(String(err));
		}

		expect(staleError).toBeUndefined();

		harness.cleanup();
	});
});
