import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createFileTracker } from "../../extensions/lsp/lsp/client/file-tracker.js";
import { createDiagnosticsMode, type DiagnosticsModeName } from "../../extensions/lsp/lsp/hooks/diagnostics-mode.js";
import lspExtensionDefault, { type LspChannelEvent } from "../../extensions/lsp/lsp/index.js";
import {
	extractPullDiagnostics,
	languageIdFromPath,
	normalizePosition,
	normalizeRange,
} from "../../extensions/lsp/lsp/utils/lsp-helpers.js";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";

function createMockPi() {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const registeredTools = new Map<string, any>();
	const channelSend = vi.fn();
	const appendEntries: Array<{ type: string; data: unknown }> = [];
	const registerCommandFn = vi.fn();
	let currentChannel: {
		name: string;
		send: (data: unknown) => void;
		onReceive: (handler: (data: unknown) => void) => () => void;
		invoke: (data: unknown, timeoutMs?: number) => Promise<unknown>;
	} | null = null;

	const pi = {
		on: vi.fn((event: string, handler: any) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		callLLM: vi.fn(async () => "{}"),
		callLLMStructured: vi.fn(async () => ({})),
		forkAgent: vi.fn(async () => ({
			text: "",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		})),
		off: vi.fn(),
		once: vi.fn(),
		emit: vi.fn(),
		setStatus: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
		registerChannel: vi.fn(() => {
			currentChannel = {
				name: "lsp",
				send: channelSend,
				onReceive: vi.fn(() => () => {}),
				invoke: vi.fn(),
			};
			return currentChannel;
		}),
		registerTool: vi.fn((tool: any) => {
			registeredTools.set(tool.name, tool);
		}),
		appendEntry: vi.fn((type: string, data?: unknown) => {
			appendEntries.push({ type, data });
		}),
		registerCommand: registerCommandFn,
	} as unknown as ExtensionAPI;

	return {
		pi,
		handlers,
		registeredTools,
		channelSend,
		appendEntries,
		registerCommandFn,
		getCurrentChannel: () => currentChannel,
	};
}

async function fireSessionStart(mock: ReturnType<typeof createMockPi>) {
	for (const h of mock.handlers.session_start ?? []) {
		await h(
			{},
			{
				sessionManager: { getBranch: () => [] },
				hasUI: true,
				ui: { notify: vi.fn() },
				cwd: tmpdir(),
			},
		);
	}
}

describe("lsp extension", () => {
	describe("registration", () => {
		it("registers lsp and lsp_health tools", () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			expect(mock.registeredTools.has("lsp")).toBe(true);
			expect(mock.registeredTools.has("lsp_health")).toBe(true);
		});

		it("registers lsp-status and lsp commands", () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			expect(mock.registerCommandFn).toHaveBeenCalledWith("lsp-status", expect.any(Object));
			expect(mock.registerCommandFn).toHaveBeenCalledWith("lsp", expect.any(Object));
		});

		it("registers channel on session_start", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			expect(mock.pi.registerChannel).toHaveBeenCalledWith("lsp");
		});
	});

	describe("channel push", () => {
		it("pushes status_changed on session_start", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "status_changed",
				}),
			);
		});

		it("pushes mode_changed when switching via command", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);

			const lspCmd = mock.registerCommandFn.mock.calls.find((call: any[]) => call[0] === "lsp");
			expect(lspCmd).toBeDefined();
			const handler = lspCmd![1].handler;
			handler("edit_write", { ui: { notify: vi.fn() } });

			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "mode_changed",
					mode: "edit_write",
				}),
			);
		});

		it("includes timestamp in every push", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);

			const sentData = mock.channelSend.mock.calls.find(
				(call: any[]) => call[0].event === "status_changed",
			)?.[0] as LspChannelEvent;
			expect(sentData.timestamp).toBeGreaterThan(0);
		});
	});

	describe("appendEntry persistence", () => {
		it("persists status_changed on session_start", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);

			const entry = mock.appendEntries.find((e) => e.type === "lsp");
			expect(entry).toBeDefined();
			expect((entry!.data as any).event).toBe("status_changed");
			expect((entry!.data as any).state).toBeDefined();
			expect((entry!.data as any).timestamp).toBeDefined();
		});

		it("persists mode_changed on mode switch", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			mock.appendEntries.length = 0;

			const lspCmd = mock.registerCommandFn.mock.calls.find((call: any[]) => call[0] === "lsp");
			const handler = lspCmd![1].handler;
			handler("disabled", { ui: { notify: vi.fn() } });

			const entry = mock.appendEntries.find((e) => e.type === "lsp" && (e.data as any).event === "mode_changed");
			expect(entry).toBeDefined();
			expect((entry!.data as any).mode).toBe("disabled");
		});
	});
});

describe("lsp internals", () => {
	describe("diagnostics-mode", () => {
		it("defaults to agent_end", () => {
			const mode = createDiagnosticsMode();
			expect(mode.get()).toBe("agent_end");
		});

		it("switches between valid modes", () => {
			const mode = createDiagnosticsMode();
			mode.set("edit_write");
			expect(mode.get()).toBe("edit_write");
			mode.set("disabled");
			expect(mode.get()).toBe("disabled");
			mode.set("agent_end");
			expect(mode.get()).toBe("agent_end");
		});

		it("ignores invalid mode", () => {
			const mode = createDiagnosticsMode();
			mode.set("invalid" as DiagnosticsModeName);
			expect(mode.get()).toBe("agent_end");
		});

		it("tracks touched files", () => {
			const mode = createDiagnosticsMode();
			mode.addTouchedFile("a.ts");
			mode.addTouchedFile("b.ts");
			mode.addTouchedFile("a.ts");
			expect(mode.getTouchedFiles()).toEqual(["a.ts", "b.ts"]);
		});

		it("clears touched files", () => {
			const mode = createDiagnosticsMode();
			mode.addTouchedFile("a.ts");
			mode.clearTouchedFiles();
			expect(mode.getTouchedFiles()).toEqual([]);
		});
	});

	describe("file-tracker", () => {
		it("tracks open files", () => {
			const tracker = createFileTracker({ maxOpenFiles: 3 });
			tracker.open("a.ts", () => {});
			tracker.open("b.ts", () => {});
			expect(tracker.getOpenFiles()).toEqual(["a.ts", "b.ts"]);
		});

		it("evicts oldest when over max", () => {
			const evicted: string[] = [];
			const tracker = createFileTracker({ maxOpenFiles: 2 });
			tracker.open("a.ts", (f) => evicted.push(f));
			tracker.open("b.ts", (f) => evicted.push(f));
			tracker.open("c.ts", (f) => evicted.push(f));
			expect(evicted).toEqual(["a.ts"]);
			expect(tracker.getOpenFiles()).toEqual(["b.ts", "c.ts"]);
		});

		it("re-access moves to end", () => {
			const evicted: string[] = [];
			const tracker = createFileTracker({ maxOpenFiles: 2 });
			tracker.open("a.ts", (f) => evicted.push(f));
			tracker.open("b.ts", (f) => evicted.push(f));
			tracker.open("a.ts", (f) => evicted.push(f));
			tracker.open("c.ts", (f) => evicted.push(f));
			expect(evicted).toEqual(["b.ts"]);
			expect(tracker.getOpenFiles()).toEqual(["a.ts", "c.ts"]);
		});

		it("getIdleFiles returns old files", () => {
			let now = 1000;
			const tracker = createFileTracker({ maxOpenFiles: 10, now: () => now });
			tracker.open("a.ts", () => {});
			now += 500;
			tracker.open("b.ts", () => {});
			now += 500;
			expect(tracker.getIdleFiles(600)).toEqual(["a.ts"]);
		});

		it("closeAll invokes callback for all", () => {
			const closed: string[] = [];
			const tracker = createFileTracker({ maxOpenFiles: 10 });
			tracker.open("a.ts", (f) => closed.push(f));
			tracker.open("b.ts", (f) => closed.push(f));
			tracker.closeAll((f) => closed.push(f));
			expect(closed).toEqual(["a.ts", "b.ts"]);
			expect(tracker.getOpenFiles()).toEqual([]);
		});
	});

	describe("lsp-helpers", () => {
		it("languageIdFromPath maps known extensions", () => {
			expect(languageIdFromPath("foo.ts")).toBe("typescript");
			expect(languageIdFromPath("foo.tsx")).toBe("typescriptreact");
			expect(languageIdFromPath("foo.js")).toBe("javascript");
			expect(languageIdFromPath("foo.py")).toBe("python");
		});

		it("languageIdFromPath returns extension for unknown", () => {
			expect(languageIdFromPath("foo.xyz")).toBe("xyz");
		});

		it("normalizePosition returns position for valid input", () => {
			expect(normalizePosition({ line: 1, character: 2 })).toEqual({ line: 1, character: 2 });
		});

		it("normalizePosition returns undefined for invalid", () => {
			expect(normalizePosition(null)).toBeUndefined();
			expect(normalizePosition({ line: "a" })).toBeUndefined();
		});

		it("normalizeRange returns range for valid input", () => {
			const range = normalizeRange({
				start: { line: 0, character: 0 },
				end: { line: 1, character: 5 },
			});
			expect(range).toEqual({
				start: { line: 0, character: 0 },
				end: { line: 1, character: 5 },
			});
		});

		it("normalizeRange returns undefined for invalid", () => {
			expect(normalizeRange(null)).toBeUndefined();
			expect(normalizeRange({ start: null, end: null })).toBeUndefined();
		});

		it("extractPullDiagnostics returns empty for invalid", () => {
			expect(extractPullDiagnostics(null)).toEqual([]);
			expect(extractPullDiagnostics({})).toEqual([]);
			expect(extractPullDiagnostics({ items: "not-array" })).toEqual([]);
		});

		it("extractPullDiagnostics extracts valid diagnostics", () => {
			const result = extractPullDiagnostics({
				items: [
					{
						message: "Error here",
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
						severity: 1,
					},
				],
			});
			expect(result).toHaveLength(1);
			expect(result[0].message).toBe("Error here");
			expect(result[0].severity).toBe(1);
		});

		it("extractPullDiagnostics skips items without message or range", () => {
			const result = extractPullDiagnostics({
				items: [
					{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } },
					{ message: "foo" },
				],
			});
			expect(result).toHaveLength(0);
		});
	});
});
