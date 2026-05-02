import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../../src/core/extensions/index.js";
import { createFileTracker } from "./client/file-tracker.js";
import { createDiagnosticsMode, type DiagnosticsModeName } from "./hooks/diagnostics-mode.js";
import lspExtensionDefault, { type LspChannelEvent } from "./index.js";

function createMockPi() {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const registeredTools = new Map<string, any>();
	const channelSend = vi.fn();
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
		forkAgent: vi.fn(async () => ({ text: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } })),
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
		registerCommand: registerCommandFn,
	} as unknown as ExtensionAPI;

	return {
		pi,
		handlers,
		registeredTools,
		channelSend,
		registerCommandFn,
		getCurrentChannel: () => currentChannel,
	};
}

async function fireSessionStart(
	mock: ReturnType<typeof createMockPi>,
	ctxOverrides?: Record<string, unknown>,
): Promise<void> {
	for (const h of mock.handlers.session_start ?? []) {
		await h(
			{},
			{
				sessionManager: { getBranch: () => [] },
				hasUI: false,
				ui: { notify: vi.fn() },
				cwd: tmpdir(),
				isIdle: () => true,
				signal: undefined,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => undefined,
				compact: () => {},
				getSystemPrompt: () => "",
				model: undefined,
				...ctxOverrides,
			},
		);
	}
}

async function fireSessionShutdown(mock: ReturnType<typeof createMockPi>): Promise<void> {
	for (const h of mock.handlers.session_shutdown ?? []) {
		await h({}, {});
	}
}

async function fireAgentEnd(mock: ReturnType<typeof createMockPi>): Promise<void> {
	for (const h of mock.handlers.agent_end ?? []) {
		await h({}, { cwd: tmpdir(), ui: { notify: vi.fn() } });
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

		it("registers /lsp-status and /lsp commands", () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			expect(mock.registerCommandFn).toHaveBeenCalledWith("lsp-status", expect.objectContaining({}));
			expect(mock.registerCommandFn).toHaveBeenCalledWith("lsp", expect.objectContaining({}));
		});

		it("registers event handlers for session_start, session_shutdown, agent_end", () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			expect(mock.handlers.session_start?.length).toBeGreaterThanOrEqual(1);
			expect(mock.handlers.session_shutdown?.length).toBeGreaterThanOrEqual(1);
			expect(mock.handlers.agent_end?.length).toBeGreaterThanOrEqual(1);
		});

		it("lsp tool has correct parameter schema with action field", () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			const tool = mock.registeredTools.get("lsp")!;
			expect(tool.parameters.properties.action).toBeDefined();
		});
	});

	describe("session lifecycle", () => {
		it("registers channel on session_start", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			expect(mock.pi.registerChannel).toHaveBeenCalledWith("lsp");
		});

		it("pushes status_changed event on session_start", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "status_changed",
				}),
			);
		});

		it("clears channel on session_shutdown", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			expect(mock.getCurrentChannel()).not.toBeNull();
			await fireSessionShutdown(mock);
			expect(mock.getCurrentChannel()).not.toBeNull();
		});

		it("sets up idle cleanup timer on agent_end", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			await fireAgentEnd(mock);
		});
	});

	describe("channel push events", () => {
		it("pushes startup_begin event on session_start", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "startup_begin",
					totalServers: expect.any(Number),
				}),
			);
		});

		it("pushes per-server ready/error events on session_start", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			const serverEvents = mock.channelSend.mock.calls.filter((c: any) => c[0]?.event?.startsWith("server_"));
			expect(serverEvents.length).toBeGreaterThanOrEqual(1);
			for (const call of serverEvents) {
				const payload = call[0] as LspChannelEvent;
				expect(["server_starting", "server_ready", "server_error"]).toContain(payload.event);
				expect(payload.serverName).toBeDefined();
				expect(payload.timestamp).toBeGreaterThan(0);
			}
		});

		it("pushes startup_complete event after all servers", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			const completeCall = mock.channelSend.mock.calls.find((c: any) => c[0]?.event === "startup_complete");
			expect(completeCall).toBeDefined();
			const payload = completeCall![0] as LspChannelEvent;
			expect(payload.event).toBe("startup_complete");
			expect(payload.servers).toBeDefined();
		});

		it("status_changed event includes servers array", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			const call = mock.channelSend.mock.calls.find((c: any) => c[0]?.event === "status_changed");
			expect(call).toBeDefined();
			const payload = call![0] as LspChannelEvent;
			expect(payload.timestamp).toBeGreaterThan(0);
			expect(payload.servers).toBeDefined();
		});

		it("all channel events include timestamp", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			for (const call of mock.channelSend.mock.calls) {
				const payload = call[0] as LspChannelEvent;
				expect(payload.timestamp).toBeGreaterThan(0);
			}
		});
	});

	describe("lsp command", () => {
		async function getLspCommandHandler(): Promise<{
			handler: (args: string, ctx: any) => Promise<void>;
			notify: ReturnType<typeof vi.fn>;
		}> {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			const lspCommandCalls = mock.registerCommandFn.mock.calls.filter((call: any[]) => call[0] === "lsp");
			expect(lspCommandCalls.length).toBe(1);
			const handler = lspCommandCalls[0][1].handler;
			return { handler, notify: vi.fn() };
		}

		it("shows current mode when called without args", async () => {
			const { handler, notify } = await getLspCommandHandler();
			await handler("", { ui: { notify } });
			expect(notify).toHaveBeenCalledWith(expect.stringContaining("agent_end"), "info");
		});

		it("switches to valid mode", async () => {
			const { handler, notify } = await getLspCommandHandler();
			await handler("disabled", { ui: { notify } });
			expect(notify).toHaveBeenCalledWith(expect.stringContaining("disabled"), "info");
		});

		it("rejects invalid mode", async () => {
			const { handler, notify } = await getLspCommandHandler();
			await handler("invalid_mode", { ui: { notify } });
			expect(notify).toHaveBeenCalledWith(expect.stringContaining("Invalid"), "warning");
		});

		it("switches through all valid modes", async () => {
			const { handler, notify } = await getLspCommandHandler();
			const modes: DiagnosticsModeName[] = ["agent_end", "edit_write", "disabled"];
			for (const mode of modes) {
				await handler(mode, { ui: { notify } });
				expect(notify).toHaveBeenCalledWith(expect.stringContaining(mode), "info");
			}
		});
	});

	describe("lsp-status command", () => {
		it("shows registry status information", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			const statusCommandCalls = mock.registerCommandFn.mock.calls.filter((call: any[]) => call[0] === "lsp-status");
			expect(statusCommandCalls.length).toBe(1);
			const handler = statusCommandCalls[0][1].handler;
			const notify = vi.fn();
			await handler("", { ui: { notify } });
			expect(notify).toHaveBeenCalledTimes(1);
			const message = notify.mock.calls[0][0] as string;
			expect(message).toContain("LSP registry:");
		});
	});

	describe("lsp tool execution", () => {
		it("status action returns registry status", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			const tool = mock.registeredTools.get("lsp")!;
			const result = await tool.execute("tc_1", { action: "status" }, undefined, undefined, {} as any);
			expect(result.content[0].text).toContain("status");
			expect(result.details.action).toBe("status");
		});

		it("health shortcut returns status", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			const tool = mock.registeredTools.get("lsp_health")!;
			const result = await tool.execute("tc_1", {}, undefined, undefined, {} as any);
			expect(result.content[0].text).toContain("status");
			expect(result.details.action).toBe("status");
		});
	});
});

describe("diagnostics-mode", () => {
	it("defaults to agent_end", () => {
		const mode = createDiagnosticsMode();
		expect(mode.get()).toBe("agent_end");
	});

	it("set changes the mode", () => {
		const mode = createDiagnosticsMode();
		mode.set("disabled");
		expect(mode.get()).toBe("disabled");
		mode.set("edit_write");
		expect(mode.get()).toBe("edit_write");
	});

	it("ignores invalid mode", () => {
		const mode = createDiagnosticsMode();
		mode.set("agent_end");
		mode.set("bogus" as DiagnosticsModeName);
		expect(mode.get()).toBe("agent_end");
	});

	it("tracks touched files without duplicates", () => {
		const mode = createDiagnosticsMode();
		mode.addTouchedFile("foo.ts");
		mode.addTouchedFile("bar.ts");
		mode.addTouchedFile("foo.ts");
		expect(mode.getTouchedFiles()).toEqual(["foo.ts", "bar.ts"]);
	});

	it("clearTouchedFiles resets", () => {
		const mode = createDiagnosticsMode();
		mode.addTouchedFile("a.ts");
		mode.clearTouchedFiles();
		expect(mode.getTouchedFiles()).toEqual([]);
	});

	it("accepts initial mode", () => {
		const mode = createDiagnosticsMode("disabled");
		expect(mode.get()).toBe("disabled");
	});

	it("ignores invalid initial mode", () => {
		const mode = createDiagnosticsMode("bogus" as DiagnosticsModeName);
		expect(mode.get()).toBe("agent_end");
	});
});

describe("file-tracker", () => {
	it("tracks open files", () => {
		const tracker = createFileTracker({ maxOpenFiles: 3 });
		tracker.open("a.ts", () => {});
		tracker.open("b.ts", () => {});
		expect(tracker.getOpenFiles()).toEqual(["a.ts", "b.ts"]);
	});

	it("evicts oldest file when exceeding maxOpenFiles", () => {
		const evicted: string[] = [];
		const tracker = createFileTracker({ maxOpenFiles: 2 });
		tracker.open("a.ts", (f) => evicted.push(f));
		tracker.open("b.ts", (f) => evicted.push(f));
		tracker.open("c.ts", (f) => evicted.push(f));
		expect(evicted).toEqual(["a.ts"]);
		expect(tracker.getOpenFiles()).toEqual(["b.ts", "c.ts"]);
	});

	it("re-access moves file to end", () => {
		const evicted: string[] = [];
		const tracker = createFileTracker({ maxOpenFiles: 2 });
		tracker.open("a.ts", (f) => evicted.push(f));
		tracker.open("b.ts", (f) => evicted.push(f));
		tracker.open("a.ts", (f) => evicted.push(f));
		tracker.open("c.ts", (f) => evicted.push(f));
		expect(evicted).toEqual(["b.ts"]);
		expect(tracker.getOpenFiles()).toEqual(["a.ts", "c.ts"]);
	});

	it("getIdleFiles returns files not accessed recently", () => {
		let now = 1000;
		const tracker = createFileTracker({
			maxOpenFiles: 10,
			now: () => now,
		});
		tracker.open("a.ts", () => {});
		now = 4000;
		tracker.open("b.ts", () => {});
		now = 5000;
		const idle = tracker.getIdleFiles(2500);
		expect(idle).toEqual(["a.ts"]);
	});

	it("closeAll invokes callback for every file", () => {
		const closed: string[] = [];
		const tracker = createFileTracker({ maxOpenFiles: 10 });
		tracker.open("x.ts", () => {});
		tracker.open("y.ts", () => {});
		tracker.closeAll((f) => closed.push(f));
		expect(closed).toEqual(["x.ts", "y.ts"]);
		expect(tracker.getOpenFiles()).toEqual([]);
	});
});
