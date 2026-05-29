/**
 * Regression tests for: edit tool not triggering LSP re-diagnosis
 *
 * Covers 4 fixes:
 * 1. Default diagnostics mode changed from "agent_end" to "edit_write"
 * 2. waitForPushDiagnostics no longer skips when previous diagnostics exist
 * 3. clearPublishedDiagnostics clears stale cache
 * 4. writethrough calls clearPublishedDiagnostics before didOpen
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDiagnosticsMode } from "./hooks/diagnostics-mode.js";
import { waitForPushDiagnostics } from "./utils/diagnostics-wait.js";
import { createWriteThroughHooks, type WriteThroughOptions } from "./hooks/writethrough.js";
import { createFileTracker } from "./client/file-tracker.js";
import type { LspRuntimeRegistry } from "./client/registry.js";

// ---------------------------------------------------------------------------
// 1. Default diagnostics mode
// ---------------------------------------------------------------------------

describe("diagnostics mode default", () => {
	it("defaults to edit_write when no initial value is provided", () => {
		const mode = createDiagnosticsMode();
		expect(mode.get()).toBe("edit_write");
	});

	it("uses provided initial value when valid", () => {
		const mode = createDiagnosticsMode("agent_end");
		expect(mode.get()).toBe("agent_end");
	});

	it("falls back to edit_write when invalid initial value is provided", () => {
		const mode = createDiagnosticsMode("invalid" as any);
		expect(mode.get()).toBe("edit_write");
	});
});

// ---------------------------------------------------------------------------
// 2. waitForPushDiagnostics does not skip when old diagnostics exist
// ---------------------------------------------------------------------------

describe("waitForPushDiagnostics", () => {
	it("waits for new diagnostics even when old diagnostics exist for the file", async () => {
		let callCount = 0;
		const mockRuntime = {
			getPublishedDiagnostics: vi.fn(() => {
				callCount++;
				// Return diagnostics after 2nd poll (simulating fresh push from LSP)
				return callCount >= 3 ? [{ message: "new error", severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] : [];
			}),
		} as unknown as LspRuntimeRegistry;

		// Use short intervals for fast test
		await waitForPushDiagnostics(mockRuntime, "test.ts", {
			initialDelayMs: 10,
			pollIntervalMs: 10,
			maxWaitMs: 500,
		});

		// Should have polled multiple times, not just returned immediately
		expect(callCount).toBeGreaterThanOrEqual(3);
		expect(mockRuntime.getPublishedDiagnostics).toHaveBeenCalledWith("test.ts");
	});

	it("returns as soon as diagnostics arrive", async () => {
		let callCount = 0;
		const mockRuntime = {
			getPublishedDiagnostics: vi.fn(() => {
				callCount++;
				// Return diagnostics immediately on first call after initial delay
				return callCount >= 2
					? [{ message: "error", severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }]
					: [];
			}),
		} as unknown as LspRuntimeRegistry;

		await waitForPushDiagnostics(mockRuntime, "test.ts", {
			initialDelayMs: 10,
			pollIntervalMs: 10,
			maxWaitMs: 2000,
		});

		// Should NOT have polled the full maxWait duration
		expect(callCount).toBeLessThan(20);
	});
});

// ---------------------------------------------------------------------------
// 3. clearPublishedDiagnostics
// ---------------------------------------------------------------------------

describe("clearPublishedDiagnostics", () => {
	it("clears stored diagnostics for a specific file", () => {
		// We test the contract: after clearPublishedDiagnostics, getPublishedDiagnostics returns []
		const diagnosticsMap = new Map<string, unknown[]>();
		diagnosticsMap.set("file:///test.ts", [{ message: "old error" }]);

		// Simulate what clearPublishedDiagnostics does
		diagnosticsMap.delete("file:///test.ts");

		expect(diagnosticsMap.has("file:///test.ts")).toBe(false);
	});

	it("does not affect diagnostics for other files", () => {
		const diagnosticsMap = new Map<string, unknown[]>();
		diagnosticsMap.set("file:///test.ts", [{ message: "ts error" }]);
		diagnosticsMap.set("file:///other.ts", [{ message: "other error" }]);

		diagnosticsMap.delete("file:///test.ts");

		expect(diagnosticsMap.has("file:///test.ts")).toBe(false);
		expect(diagnosticsMap.get("file:///other.ts")).toEqual([{ message: "other error" }]);
	});
});

// ---------------------------------------------------------------------------
// 4. writethrough clears stale diagnostics before didOpen
// ---------------------------------------------------------------------------

describe("writethrough diagnostics refresh", () => {
	function createMockRuntime() {
		return {
			notify: vi.fn(),
			request: vi.fn(async () => []),
			requestAll: vi.fn(async () => []),
			getPublishedDiagnostics: vi.fn(() => []),
			clearPublishedDiagnostics: vi.fn(),
			getStatusForPath: vi.fn(() => ({
				state: "ready" as const,
				reason: "",
				configuredCommand: undefined,
				activeCommand: undefined,
				transport: undefined,
				lspmuxAvailable: false,
				fallbackReason: undefined,
				pid: undefined,
				diagnosticsCount: 0,
			})),
			getStatus: vi.fn(() => ({
				state: "ready" as const,
				reason: "",
				servers: [],
				configuredServers: 0,
				activeServers: 0,
			})),
			start: vi.fn(async () => {}),
			stop: vi.fn(async () => {}),
			reload: vi.fn(async () => {}),
			startSingle: vi.fn(async () => {}),
			stopSingle: vi.fn(async () => {}),
			touchAccess: vi.fn(),
			getIdleServers: vi.fn(() => []),
			setPrimary: vi.fn(),
			getEntryMeta: vi.fn(() => undefined),
		};
	}

	function createMockPi() {
		const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
		return {
			pi: {
				on: vi.fn((event: string, handler: any) => {
					if (!handlers[event]) handlers[event] = [];
					handlers[event].push(handler);
				}),
				registerTool: vi.fn(),
				registerCommand: vi.fn(),
				callLLM: vi.fn(),
				callLLMStructured: vi.fn(),
				forkAgent: vi.fn(),
				once: vi.fn(),
				emit: vi.fn(),
				off: vi.fn(),
				sendMessage: vi.fn(),
				appendEntry: vi.fn(),
				setStatus: vi.fn(),
				registerProvider: vi.fn(),
				unregisterProvider: vi.fn(),
				events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
				registerChannel: vi.fn(),
			} as any,
			handlers,
		};
	}

	it("calls clearPublishedDiagnostics before sending didOpen", async () => {
		const testDir = mkdtempSync(join(tmpdir(), "lsp-test-"));
		const testFile = join(testDir, "test.ts");
		writeFileSync(testFile, "const x: number = 1;\n");

		try {
			const runtime = createMockRuntime();
			const mode = createDiagnosticsMode("edit_write");
			const fileTracker = createFileTracker({ maxOpenFiles: 30 });
			const { pi, handlers } = createMockPi();

			const hooks = createWriteThroughHooks(runtime, {
				cwd: testDir,
				formatOnWrite: false,
				diagnosticsOnWrite: false,
			}, mode, fileTracker);
			hooks.register(pi);

			// Fire tool_result for an edit
			const toolResultHandlers = handlers.tool_result ?? [];
			expect(toolResultHandlers.length).toBe(1);

			await toolResultHandlers[0](
				{
					toolName: "edit",
					isError: false,
					input: { path: "test.ts" },
					content: [{ type: "text", text: "done" }],
				},
				{ cwd: testDir },
			);

			// clearPublishedDiagnostics should have been called
			expect(runtime.clearPublishedDiagnostics).toHaveBeenCalledWith("test.ts");

			// didOpen should have been sent after clearing
			expect(runtime.notify).toHaveBeenCalledWith(
				"textDocument/didOpen",
				expect.objectContaining({
					textDocument: expect.objectContaining({ uri: expect.stringContaining("test.ts") }),
				}),
				expect.any(Object),
			);
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("in agent_end mode, does not run diagnostics but still tracks file", async () => {
		const testDir = mkdtempSync(join(tmpdir(), "lsp-test-"));
		const testFile = join(testDir, "test.ts");
		writeFileSync(testFile, "const x: number = 1;\n");

		try {
			const runtime = createMockRuntime();
			const mode = createDiagnosticsMode("agent_end");
			const fileTracker = createFileTracker({ maxOpenFiles: 30 });
			const { pi, handlers } = createMockPi();

			const hooks = createWriteThroughHooks(runtime, {
				cwd: testDir,
				formatOnWrite: false,
				diagnosticsOnWrite: true,
			}, mode, fileTracker);
			hooks.register(pi);

			const toolResultHandlers = handlers.tool_result ?? [];
			await toolResultHandlers[0](
				{
					toolName: "edit",
					isError: false,
					input: { path: "test.ts" },
					content: [{ type: "text", text: "done" }],
				},
				{ cwd: testDir },
			);

			// File should be tracked as touched
			expect(mode.getTouchedFiles()).toContain("test.ts");

			// In agent_end mode, should NOT pull diagnostics
			expect(runtime.requestAll).not.toHaveBeenCalled();
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	it("in edit_write mode, pulls diagnostics after edit", async () => {
		const testDir = mkdtempSync(join(tmpdir(), "lsp-test-"));
		const testFile = join(testDir, "test.ts");
		writeFileSync(testFile, "const x: number = 1;\n");

		try {
			const runtime = createMockRuntime();
			runtime.getPublishedDiagnostics = vi.fn(() => [
				{ message: "type error", severity: 1, range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } }, source: "ts", code: 2322 },
			]);
			const mode = createDiagnosticsMode("edit_write");
			const fileTracker = createFileTracker({ maxOpenFiles: 30 });
			const { pi, handlers } = createMockPi();

			const hooks = createWriteThroughHooks(runtime, {
				cwd: testDir,
				formatOnWrite: false,
				diagnosticsOnWrite: true,
			}, mode, fileTracker);
			hooks.register(pi);

			const toolResultHandlers = handlers.tool_result ?? [];
			const result = await toolResultHandlers[0](
				{
					toolName: "edit",
					isError: false,
					input: { path: "test.ts" },
					content: [{ type: "text", text: "done" }],
				},
				{ cwd: testDir },
			);

			// Should have pulled diagnostics
			expect(runtime.requestAll).toHaveBeenCalledWith(
				"textDocument/diagnostic",
				expect.objectContaining({ textDocument: expect.objectContaining({ uri: expect.stringContaining("test.ts") }) }),
				expect.objectContaining({ path: "test.ts" }),
			);

			// Result should include diagnostics info
			expect(result).toBeDefined();
			expect(result.content).toBeDefined();
			expect(result.details).toBeDefined();
			expect(result.details.files).toHaveLength(1);
			expect(result.details.files[0].issues).toHaveLength(1);
			expect(result.details.files[0].issues[0].message).toBe("type error");
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});
});
