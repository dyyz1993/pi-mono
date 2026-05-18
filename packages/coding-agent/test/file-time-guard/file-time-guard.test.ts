import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fileTimeGuardExtension from "../../extensions/file-time-guard/index.js";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";

vi.mock("node:fs/promises", () => ({
	stat: vi.fn(async (filePath: string) => {
		if (filePath.includes("nonexistent")) {
			const err = new Error("ENOENT");
			throw err;
		}
		return {
			mtimeMs: 1000,
			ctimeMs: 1000,
			size: 100,
		};
	}),
}));

let sessionIdCounter = 0;

function createMockPi() {
	sessionIdCounter++;
	const currentSessionId = `test-session-ftg-${sessionIdCounter}`;
	const handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown>> = {};
	const registeredCommands = new Map<string, unknown>();
	const flags: Record<string, boolean | string> = {
		"disable-file-time-check": false,
		"file-time-check-mode": "block",
	};

	const pi = {
		on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		callLLM: vi.fn(async () => "mock"),
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
		registerChannel: vi.fn(() => ({
			name: "file-time-guard",
			send: vi.fn(),
			onReceive: vi.fn(() => () => {}),
			invoke: vi.fn(),
		})),
		registerTool: vi.fn(),
		appendEntry: vi.fn(),
		sendUserMessage: vi.fn(),
		registerCommand: vi.fn((name: string, cmd: unknown) => {
			registeredCommands.set(name, cmd);
		}),
		registerFlag: vi.fn(),
		getFlag: vi.fn((name: string) => flags[name]),
	} as unknown as ExtensionAPI;

	return {
		pi,
		handlers,
		registeredCommands,
		flags,
		currentSessionId,
	};
}

function testCtx(sessionId: string, overrides?: Record<string, unknown>) {
	return {
		sessionManager: {
			getBranch: () => [],
			getSessionId: () => sessionId,
			getEntries: () => [],
		},
		hasUI: true,
		ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
		cwd: tmpdir(),
		...overrides,
	};
}

async function fireEvent(
	mock: ReturnType<typeof createMockPi>,
	event: string,
	data: unknown,
	ctxOverrides?: Partial<Omit<ReturnType<typeof testCtx>, "sessionManager">> & {
		sessionManager?: Record<string, unknown>;
	},
): Promise<unknown> {
	const baseCtx = testCtx(mock.currentSessionId);
	const mergedCtx = ctxOverrides ? { ...baseCtx, ...ctxOverrides } : baseCtx;
	let result: unknown;
	for (const h of mock.handlers[event] ?? []) {
		result = await h(data, mergedCtx);
	}
	return result;
}

describe("file-time-guard extension", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("registration", () => {
		it("registers flags", () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			expect(mock.pi.registerFlag).toHaveBeenCalledWith(
				"file-time-check-mode",
				expect.objectContaining({
					type: "string",
					default: "block",
				}),
			);
			expect(mock.pi.registerFlag).toHaveBeenCalledWith(
				"disable-file-time-check",
				expect.objectContaining({
					type: "boolean",
					default: false,
				}),
			);
		});

		it("registers file-time-status command", () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			expect(mock.registeredCommands.has("file-time-status")).toBe(true);
		});

		it("registers session_start handler", () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			expect(mock.handlers.session_start).toBeDefined();
			expect(mock.handlers.session_start!.length).toBeGreaterThan(0);
		});

		it("registers session_shutdown handler", () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			expect(mock.handlers.session_shutdown).toBeDefined();
			expect(mock.handlers.session_shutdown!.length).toBeGreaterThan(0);
		});

		it("registers tool_call handler", () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			expect(mock.handlers.tool_call).toBeDefined();
			expect(mock.handlers.tool_call!.length).toBeGreaterThan(0);
		});
	});

	describe("file modification time tracking", () => {
		it("records file stats on read tool call", async () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			await fireEvent(mock, "session_start", {});

			const result = await fireEvent(mock, "tool_call", {
				toolName: "read",
				input: { path: "src/index.ts" },
			});

			expect(result).toBeUndefined();
		});

		it("blocks write when file was not read first (block mode)", async () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			await fireEvent(mock, "session_start", {});

			const ctx = testCtx(mock.currentSessionId);
			const result = await fireEvent(
				mock,
				"tool_call",
				{
					toolName: "write",
					input: { path: "src/new-file.ts" },
				},
				{ ui: ctx.ui },
			);

			expect(result).toEqual({ block: true, reason: "文件未读取过" });
		});

		it("blocks edit when file was not read first (block mode)", async () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			await fireEvent(mock, "session_start", {});

			const ctx = testCtx(mock.currentSessionId);
			const result = await fireEvent(
				mock,
				"tool_call",
				{
					toolName: "edit",
					input: { path: "src/edit-file.ts" },
				},
				{ ui: ctx.ui },
			);

			expect(result).toEqual({ block: true, reason: "文件未读取过" });
		});
	});

	describe("warning when file modified externally", () => {
		it("blocks write when file was modified externally (block mode)", async () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			await fireEvent(mock, "session_start", {});

			await fireEvent(mock, "tool_call", {
				toolName: "read",
				input: { path: "src/index.ts" },
			});

			const { stat } = await import("node:fs/promises");
			(stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				mtimeMs: 9999,
				ctimeMs: 9999,
				size: 200,
			});

			const ctx = testCtx(mock.currentSessionId);
			const result = await fireEvent(
				mock,
				"tool_call",
				{
					toolName: "write",
					input: { path: "src/index.ts" },
				},
				{ ui: ctx.ui },
			);

			expect(result).toEqual({ block: true, reason: "文件已被外部修改" });
		});

		it("warns but does not block in warn mode", async () => {
			const mock = createMockPi();
			mock.flags["file-time-check-mode"] = "warn";
			fileTimeGuardExtension(mock.pi);
			await fireEvent(mock, "session_start", {});

			await fireEvent(mock, "tool_call", {
				toolName: "read",
				input: { path: "src/index.ts" },
			});

			const { stat } = await import("node:fs/promises");
			(stat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				mtimeMs: 9999,
				ctimeMs: 9999,
				size: 200,
			});

			const ctx = testCtx(mock.currentSessionId);
			const result = await fireEvent(
				mock,
				"tool_call",
				{
					toolName: "write",
					input: { path: "src/index.ts" },
				},
				{ ui: ctx.ui },
			);

			expect(result).toBeUndefined();
			expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("外部修改"), "warning");
		});

		it("allows write when file unchanged", async () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			await fireEvent(mock, "session_start", {});

			await fireEvent(mock, "tool_call", {
				toolName: "read",
				input: { path: "src/unchanged.ts" },
			});

			const ctx = testCtx(mock.currentSessionId);
			const result = await fireEvent(
				mock,
				"tool_call",
				{
					toolName: "write",
					input: { path: "src/unchanged.ts" },
				},
				{ ui: ctx.ui },
			);

			expect(result).toBeUndefined();
		});
	});

	describe("disabled state", () => {
		it("skips all checks when disabled flag is true", async () => {
			const mock = createMockPi();
			mock.flags["disable-file-time-check"] = true;
			fileTimeGuardExtension(mock.pi);
			await fireEvent(mock, "session_start", {});

			const ctx = testCtx(mock.currentSessionId);
			const result = await fireEvent(
				mock,
				"tool_call",
				{
					toolName: "write",
					input: { path: "src/skip-check.ts" },
				},
				{ ui: ctx.ui },
			);

			expect(result).toBeUndefined();
		});
	});

	describe("cleanup", () => {
		it("cleans up records on session_shutdown", async () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);

			await fireEvent(mock, "session_start", {});

			await fireEvent(mock, "tool_call", {
				toolName: "read",
				input: { path: "src/index.ts" },
			});

			await fireEvent(mock, "session_shutdown", {});

			const ctx = testCtx(mock.currentSessionId);
			const result = await fireEvent(
				mock,
				"tool_call",
				{
					toolName: "write",
					input: { path: "src/index.ts" },
				},
				{ ui: ctx.ui },
			);

			expect(result).toBeUndefined();
		});
	});

	describe("ignore patterns", () => {
		it("node_modules files are tracked since patterns use relative matching on absolute paths", async () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);
			await fireEvent(mock, "session_start", {});

			const ctx = testCtx(mock.currentSessionId);

			await fireEvent(mock, "tool_call", {
				toolName: "read",
				input: { path: "node_modules/package/index.js" },
			});

			const result = await fireEvent(
				mock,
				"tool_call",
				{
					toolName: "write",
					input: { path: "node_modules/package/index.js" },
				},
				{ ui: ctx.ui },
			);

			expect(result).toBeUndefined();
		});
	});

	describe("file-time-status command", () => {
		it("command handler exists and is callable", async () => {
			const mock = createMockPi();
			fileTimeGuardExtension(mock.pi);

			const cmd = mock.registeredCommands.get("file-time-status") as {
				description: string;
				handler: (args: unknown, ctx: unknown) => Promise<void>;
			};
			expect(cmd).toBeDefined();
			expect(cmd.description).toContain("文件时间戳检查状态");
			expect(typeof cmd.handler).toBe("function");
		});
	});
});
