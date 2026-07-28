import { tmpdir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import { createFileTracker } from "./client/file-tracker.ts";
import { createDiagnosticsMode, type DiagnosticsModeName } from "./hooks/diagnostics-mode.ts";
import { createDependencyResolver } from "./utils/dependency-resolver.ts";
import lspExtensionDefault, { type LspChannelEvent } from "./index.ts";

function encodeLspFrame(message: unknown): Uint8Array {
	const json = JSON.stringify(message);
	return new TextEncoder().encode(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

function parseLspFrames(buffer: { value: string }, data: string | Uint8Array): Array<Record<string, unknown>> {
	buffer.value += typeof data === "string" ? data : Buffer.from(data).toString("utf8");
	const frames: Array<Record<string, unknown>> = [];

	while (true) {
		const headerEnd = buffer.value.indexOf("\r\n\r\n");
		if (headerEnd === -1) {
			return frames;
		}
		const lengthMatch = /Content-Length:\s*(\d+)/i.exec(buffer.value.slice(0, headerEnd));
		if (!lengthMatch) {
			buffer.value = buffer.value.slice(headerEnd + 4);
			continue;
		}
		const contentLength = Number.parseInt(lengthMatch[1], 10);
		const frameEnd = headerEnd + 4 + contentLength;
		if (buffer.value.length < frameEnd) {
			return frames;
		}
		const payload = buffer.value.slice(headerEnd + 4, frameEnd);
		buffer.value = buffer.value.slice(frameEnd);
		frames.push(JSON.parse(payload) as Record<string, unknown>);
	}
}

async function waitForValue<T>(read: () => T | undefined, description: string): Promise<T> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const value = read();
		if (value !== undefined) {
			return value;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

	function createMockPi() {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const registeredTools = new Map<string, any>();
	const channelSendFn = vi.fn();
	const registerCommandFn = vi.fn();
	let channelOnReceiveHandler: ((data: unknown) => void) | null = null;
	let currentChannel: {
		name: string;
		send: (data: unknown) => void;
		onReceive: (handler: (data: unknown) => void) => () => void;
		invoke: (data: unknown, timeoutMs?: number) => Promise<unknown>;
		call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
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
				send: channelSendFn,
				onReceive: vi.fn((handler: (data: unknown) => void) => {
					channelOnReceiveHandler = handler;
					return () => { channelOnReceiveHandler = null; };
				}),
				invoke: vi.fn(async (data: unknown) => {
					if (!channelOnReceiveHandler) return {};
					const msg = data as Record<string, unknown>;
					const invokeId = msg.__invokeId as string;
					return new Promise((resolve) => {
						const orig = channelSendFn.getMockImplementation() ?? channelSendFn;
						channelSendFn.mockImplementation((response: unknown) => {
							const resp = response as Record<string, unknown>;
							if (resp?.invokeId === invokeId) {
								channelSendFn.mockImplementation(orig as any);
								resolve(response);
							}
						});
						channelOnReceiveHandler!(data);
					});
				}),
				call: vi.fn(async (method: string, params: Record<string, unknown>, _timeoutMs?: number) => {
					if (!channelOnReceiveHandler) return {};
					const invokeId = `invoke_${method}_${Date.now()}`;
					return new Promise((resolve) => {
						const orig = channelSendFn.getMockImplementation() ?? channelSendFn;
						channelSendFn.mockImplementation((response: unknown) => {
							const resp = response as Record<string, unknown>;
							if (resp?.invokeId === invokeId) {
								channelSendFn.mockImplementation(orig as any);
								resolve(response);
							}
						});
						channelOnReceiveHandler!({ __call: method, invokeId, ...params });
					});
				}),
			};
			return currentChannel;
		}),
		registerTool: vi.fn((tool: any) => {
			registeredTools.set(tool.name, tool);
		}),
		registerCommand: registerCommandFn,
		appendEntry: vi.fn(),
		sendMessage: vi.fn(),
		off: vi.fn(),
	} as unknown as ExtensionAPI;

	return {
		pi,
		handlers,
		registeredTools,
		channelSend: channelSendFn,
		registerCommandFn,
		getCurrentChannel: () => currentChannel,
	};
}

async function fireSessionStart(
	mock: ReturnType<typeof createMockPi>,
	ctxOverrides?: Record<string, unknown>,
): Promise<void> {
	const defaultCwd = join(tmpdir(), `lsp-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	await mkdir(defaultCwd, { recursive: true });
	for (const h of mock.handlers.session_start ?? []) {
		await h(
			{},
			{
				sessionManager: { getBranch: () => [] },
				hasUI: false,
				ui: { notify: vi.fn() },
				cwd: defaultCwd,
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
	await new Promise((resolve) => setTimeout(resolve, 100));
}

async function waitForChannelEvent(
	mock: ReturnType<typeof createMockPi>,
	event: string,
): Promise<LspChannelEvent | undefined> {
	for (let i = 0; i < 100; i++) {
		const call = mock.channelSend.mock.calls.find((c: any) => c[0]?.event === event);
		if (call) return call[0] as LspChannelEvent;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return undefined;
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
			expect(await waitForChannelEvent(mock, "status_changed")).toBeDefined();
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
			const event = await waitForChannelEvent(mock, "startup_begin");
			expect(event).toBeDefined();
			expect((event as { totalServers?: unknown } | undefined)?.totalServers).toEqual(expect.any(Number));
		});

		it("pushes well-formed per-server ready/error events when servers start on session_start", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			const serverEvents = mock.channelSend.mock.calls.filter((c: any) => c[0]?.event?.startsWith("server_"));
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
			const payload = await waitForChannelEvent(mock, "startup_complete");
			expect(payload).toBeDefined();
			expect(payload!.event).toBe("startup_complete");
			expect(payload!.servers).toBeDefined();
		});

		it("status_changed event includes servers array", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			const payload = await waitForChannelEvent(mock, "status_changed");
			expect(payload).toBeDefined();
			expect(payload!.timestamp).toBeGreaterThan(0);
			expect(payload!.servers).toBeDefined();
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

		it("pushes language_activated event for ready servers with fileTypes", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);
			const languageEvents = mock.channelSend.mock.calls.filter(
				(c: any) => c[0]?.event === "language_activated",
			);
			if (languageEvents.length > 0) {
				for (const call of languageEvents) {
					const payload = call[0] as LspChannelEvent;
					expect(payload.event).toBe("language_activated");
					expect(payload.timestamp).toBeGreaterThan(0);
					expect(payload.languages).toBeDefined();
					expect(payload.languages!.length).toBeGreaterThan(0);
				}
			}
		});
	});

	describe("getActiveLanguages method", () => {
		it("responds to getActiveLanguages channel call", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);

			const channel = mock.getCurrentChannel();
			expect(channel).not.toBeNull();

			const result = await channel!.call("getActiveLanguages", {});
			expect(result).toHaveProperty("languages");
			expect(Array.isArray((result as any).languages)).toBe(true);
		});

		it("returns languages array from channel call", async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);
			await fireSessionStart(mock);

			const channel = mock.getCurrentChannel();
			expect(channel).not.toBeNull();

			const result = await channel!.call("getActiveLanguages", {});
			expect(result).toHaveProperty("languages");
			expect(Array.isArray((result as any).languages)).toBe(true);
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
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("edit_write"), "info");
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
	it("defaults to edit_write", () => {
		const mode = createDiagnosticsMode();
		expect(mode.get()).toBe("edit_write");
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
		mode.set("edit_write");
		mode.set("bogus" as DiagnosticsModeName);
		expect(mode.get()).toBe("edit_write");
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
		expect(mode.get()).toBe("edit_write");
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

describe("dependency-resolver", () => {
	it("finds files that import a touched file", async () => {
		const tmpDir = join(tmpdir(), `lsp-dep-test-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		await writeFile(
			join(tmpDir, "types.ts"),
			"export interface User { name: string }",
		);
		await writeFile(
			join(tmpDir, "user.ts"),
			`import { User } from "./types";\nconst u: User = { name: "test" };`,
		);
		await writeFile(
			join(tmpDir, "other.ts"),
			`export const x = 1;`,
		);

		const resolver = createDependencyResolver({ cwd: tmpDir });
		const dependents = await resolver.resolveDependents(["types.ts"]);

		expect(dependents).toContain("user.ts");
		expect(dependents).not.toContain("other.ts");
		expect(dependents).not.toContain("types.ts");
	});

	it("returns empty for files with no dependents", async () => {
		const tmpDir = join(tmpdir(), `lsp-dep-empty-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		await writeFile(join(tmpDir, "isolated.ts"), "export const x = 1;");

		const resolver = createDependencyResolver({ cwd: tmpDir });
		const dependents = await resolver.resolveDependents(["isolated.ts"]);

		expect(dependents).toEqual([]);
	});

	it("handles require-style imports", async () => {
		const tmpDir = join(tmpdir(), `lsp-dep-require-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		await writeFile(join(tmpDir, "config.js"), "module.exports = {};");
		await writeFile(join(tmpDir, "app.js"), `const config = require("./config");`);

		const resolver = createDependencyResolver({ cwd: tmpDir });
		const dependents = await resolver.resolveDependents(["config.js"]);

		expect(dependents).toContain("app.js");
	});

	it("respects maxDependents limit", async () => {
		const tmpDir = join(tmpdir(), `lsp-dep-max-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		await writeFile(join(tmpDir, "shared.ts"), "export const shared = 1;");
		for (let i = 0; i < 10; i++) {
			await writeFile(join(tmpDir, `file${i}.ts`), `import { shared } from "./shared";`);
		}

		const resolver = createDependencyResolver({ cwd: tmpDir, maxDependents: 3 });
		const dependents = await resolver.resolveDependents(["shared.ts"]);

		expect(dependents.length).toBeLessThanOrEqual(3);
	});

	it("returns empty for empty input", async () => {
		const resolver = createDependencyResolver();
		const dependents = await resolver.resolveDependents([]);
		expect(dependents).toEqual([]);
	});

	it("handles subdirectory imports", async () => {
		const tmpDir = join(tmpdir(), `lsp-dep-subdir-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });
		await mkdir(join(tmpDir, "utils"), { recursive: true });

		await writeFile(join(tmpDir, "utils", "helpers.ts"), "export const add = (a: number, b: number) => a + b;");
		await writeFile(join(tmpDir, "main.ts"), `import { add } from "./utils/helpers";\nconsole.log(add(1, 2));`);

		const resolver = createDependencyResolver({ cwd: tmpDir });
		const dependents = await resolver.resolveDependents(["utils/helpers.ts"]);

		expect(dependents).toContain("main.ts");
	});

	it("skips node_modules and dot directories", async () => {
		const tmpDir = join(tmpdir(), `lsp-dep-skip-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });
		await mkdir(join(tmpDir, "node_modules", "pkg"), { recursive: true });
		await mkdir(join(tmpDir, ".hidden"), { recursive: true });

		await writeFile(join(tmpDir, "core.ts"), "export const x = 1;");
		await writeFile(join(tmpDir, "node_modules", "pkg", "index.ts"), `import { x } from "../../core";`);
		await writeFile(join(tmpDir, ".hidden", "secret.ts"), `import { x } from "../core";`);

		const resolver = createDependencyResolver({ cwd: tmpDir });
		const dependents = await resolver.resolveDependents(["core.ts"]);

		expect(dependents).toEqual([]);
	});
});

describe("diagnostics-wait", () => {
	it("returns immediately when diagnostics are already published", async () => {
		const mockRuntime = {
			getPublishedDiagnostics: vi.fn().mockReturnValue([{ message: "err" }]),
		} as any;

		const { waitForPushDiagnostics } = await import("./utils/diagnostics-wait.ts");
		const start = Date.now();
		await waitForPushDiagnostics(mockRuntime, "test.ts", {
			initialDelayMs: 10,
			pollIntervalMs: 10,
			maxWaitMs: 2000,
		});
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(200);
	});

	it("waits and finds diagnostics after polling", async () => {
		let callCount = 0;
		const mockRuntime = {
			getPublishedDiagnostics: vi.fn(() => {
				callCount++;
				return callCount >= 3 ? [{ message: "late error" }] : [];
			}),
		} as any;

		const { waitForPushDiagnostics } = await import("./utils/diagnostics-wait.ts");
		await waitForPushDiagnostics(mockRuntime, "test.ts", {
			initialDelayMs: 10,
			pollIntervalMs: 10,
			maxWaitMs: 5000,
		});
		expect(callCount).toBeGreaterThanOrEqual(3);
	});

	it("gives up after maxWaitMs with no diagnostics", async () => {
		const mockRuntime = {
			getPublishedDiagnostics: vi.fn().mockReturnValue([]),
		} as any;

		const { waitForPushDiagnostics } = await import("./utils/diagnostics-wait.ts");
		const start = Date.now();
		await waitForPushDiagnostics(mockRuntime, "test.ts", {
			initialDelayMs: 10,
			pollIntervalMs: 10,
			maxWaitMs: 100,
		});
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(80);
		expect(elapsed).toBeLessThan(500);
	});
});

describe("config maxOpenFiles", () => {
	it("defaults to 30 when not configured", async () => {
		const tmpDir = join(tmpdir(), `lsp-cfg-default-${Date.now()}`);
		await mkdir(join(tmpDir, ".pi"), { recursive: true });

		const { createLspConfigResolver } = await import("./config/resolver.ts");
		const resolver = createLspConfigResolver({ cwd: tmpDir, homeDir: tmpDir });
		const config = resolver.resolve();

		expect(config.maxOpenFiles).toBe(30);
	});

	it("reads maxOpenFiles from lsp.json", async () => {
		const tmpDir = join(tmpdir(), `lsp-cfg-max-${Date.now()}`);
		await mkdir(join(tmpDir, ".pi"), { recursive: true });
		await writeFile(join(tmpDir, ".pi", "lsp.json"), JSON.stringify({ maxOpenFiles: 50 }));

		const { createLspConfigResolver } = await import("./config/resolver.ts");
		const resolver = createLspConfigResolver({ cwd: tmpDir, homeDir: tmpDir });
		const config = resolver.resolve();

		expect(config.maxOpenFiles).toBe(50);
	});

	it("ignores invalid maxOpenFiles and uses default", async () => {
		const tmpDir = join(tmpdir(), `lsp-cfg-invalid-${Date.now()}`);
		await mkdir(join(tmpDir, ".pi"), { recursive: true });
		await writeFile(join(tmpDir, ".pi", "lsp.json"), JSON.stringify({ maxOpenFiles: -5 }));

		const { createLspConfigResolver } = await import("./config/resolver.ts");
		const resolver = createLspConfigResolver({ cwd: tmpDir, homeDir: tmpDir });
		const config = resolver.resolve();

		expect(config.maxOpenFiles).toBe(30);
	});

	it("resolves per-server initializationOptions and configuration from lsp.json", async () => {
		const tmpDir = join(tmpdir(), `lsp-cfg-server-options-${Date.now()}`);
		const initializationOptions = { cargo: { features: "all" }, check: { command: "clippy" } };
		const configuration = { "rust-analyzer": { diagnostics: { enable: true } } };
		await mkdir(join(tmpDir, ".pi"), { recursive: true });
		await writeFile(
			join(tmpDir, ".pi", "lsp.json"),
			JSON.stringify({
				servers: {
					rust: {
						server: process.execPath,
						args: ["--version"],
						fileTypes: [".rs"],
						initializationOptions,
						configuration,
					},
				},
			}),
		);

		const { createLspConfigResolver } = await import("./config/resolver.ts");
		const resolver = createLspConfigResolver({ cwd: tmpDir, homeDir: tmpDir });
		const config = resolver.resolve();

		expect(config.servers).toHaveLength(1);
		expect(config.servers[0].name).toBe("rust");
		expect(config.servers[0].command).toEqual([process.execPath, "--version"]);
		expect(config.servers[0].fileTypes).toEqual([".rs"]);
		expect(config.servers[0].initializationOptions).toEqual(initializationOptions);
		expect(config.servers[0].configuration).toEqual(configuration);
	});
});

describe("LSP per-server runtime options", () => {
	it("passes initializationOptions and configuration when starting registry servers", async () => {
		const initializationOptions = { gofumpt: true };
		const configuration = { gopls: { analyses: { unusedparams: true } } };
		const runtimeStart = vi.fn(async () => undefined);
		const createRuntime = vi.fn(() => ({
			start: runtimeStart,
			stop: vi.fn(async () => undefined),
			reload: vi.fn(async () => undefined),
			request: vi.fn(async () => ({})),
			notify: vi.fn(),
			getPublishedDiagnostics: vi.fn(() => []),
			clearPublishedDiagnostics: vi.fn(),
			getStatus: vi.fn(() => ({
				state: "ready",
				reason: "ready",
				configuredCommand: ["gopls"],
				activeCommand: ["gopls"],
				transport: "direct",
				lspmuxAvailable: false,
				fallbackReason: undefined,
				pid: 1,
				diagnosticsCount: 0,
			})),
		}));

		const { createLspRuntimeRegistry } = await import("./client/registry.ts");
		const registry = createLspRuntimeRegistry({ createRuntime });
		await registry.start({
			serverCommand: undefined,
			maxOpenFiles: 30,
			servers: [
				{
					name: "go",
					command: ["gopls"],
					fileTypes: [".go"],
					initializationOptions,
					configuration,
				},
			],
		});

		expect(createRuntime).toHaveBeenCalledWith({ initializationOptions, configuration });
		expect(runtimeStart).toHaveBeenCalledWith(["gopls"]);
	});

	it("passes initializationOptions and configuration through lazy activation", async () => {
		const initializationOptions = { cargo: { allTargets: true } };
		const configuration = { "rust-analyzer": { checkOnSave: true } };
		const runtime = {
			startSingle: vi.fn(async () => undefined),
			setPrimary: vi.fn(),
			getEntryMeta: vi.fn(() => undefined),
			touchAccess: vi.fn(),
		};

		const { createLazyActivator } = await import("./utils/lazy-activator.ts");
		const activator = createLazyActivator(runtime as any);
		activator.buildIndex([
			{
				name: "rust",
				command: ["rust-analyzer"],
				fileTypes: [".rs"],
				initializationOptions,
				configuration,
			},
		]);

		const result = await activator.ensureServerForFile("src/main.rs");

		expect(result).toEqual([{ name: "rust", started: true }]);
		expect(runtime.startSingle).toHaveBeenCalledWith("rust", ["rust-analyzer"], [".rs"], {
			initializationOptions,
			configuration,
		});
	});

	it("sends initializationOptions in initialize and answers workspace/configuration", async () => {
		const tmpDir = join(tmpdir(), `lsp-runtime-config-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });
		const initializationOptions = { cargo: { features: "all" } };
		const configuration = {
			"rust-analyzer": { diagnostics: { disabled: ["inactive-code"] } },
			unrelated: true,
		};
		const clientMessages: Array<Record<string, unknown>> = [];
		const stdinBuffer = { value: "" };
		let stdoutController!: ReadableStreamDefaultController<Uint8Array>;
		const stdout = new ReadableStream<Uint8Array>({
			start(controller) {
				stdoutController = controller;
			},
		});
		const stderr = new ReadableStream<Uint8Array>();

		const sendServerMessage = (message: unknown) => {
			stdoutController.enqueue(encodeLspFrame(message));
		};
		const spawn = vi.fn(() => ({
			pid: 456,
			stdout,
			stderr,
			exited: new Promise<number | null>(() => undefined),
			kill: vi.fn(),
			stdin: {
				write(data: string | Uint8Array) {
					for (const message of parseLspFrames(stdinBuffer, data)) {
						clientMessages.push(message);
						if (message.method === "initialize") {
							sendServerMessage({
								jsonrpc: "2.0",
								id: message.id,
								result: { capabilities: {} },
							});
						}
					}
				},
				end: vi.fn(),
			},
		}));

		const { createLspClientRuntime } = await import("./client/runtime.ts");
		const runtime = createLspClientRuntime({
			cwd: tmpDir,
			env: { PATH: "" },
			spawn,
			initializationOptions,
			configuration,
		});
		await runtime.start(["mock-lsp"]);

		const initializeRequest = clientMessages.find((message) => message.method === "initialize");
		expect(initializeRequest?.params).toMatchObject({
			initializationOptions,
			capabilities: {
				workspace: { configuration: true },
			},
		});

		sendServerMessage({
			jsonrpc: "2.0",
			id: 99,
			method: "workspace/configuration",
			params: {
				items: [{ section: "rust-analyzer" }, { section: "unknown" }],
			},
		});
		const configurationResponse = await waitForValue(
			() => clientMessages.find((message) => message.id === 99 && "result" in message),
			"workspace/configuration response",
		);

		expect(configurationResponse.result).toEqual([configuration["rust-analyzer"], configuration]);
	});
});
