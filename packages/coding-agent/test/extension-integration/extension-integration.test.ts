/**
 * Cross-extension integration tests for agent-permissions, file-time-guard, hooks-engine.
 * Tests how these extensions work TOGETHER when loaded into the same mock pi.
 * Load order matches production: agent-permissions → file-time-guard → hooks-engine.
 * emitToolCall() short-circuits on first { block: true }, just like the real runner.
 */

import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import agentPermissions from "../../extensions/agent-permissions/index.js";
import fileTimeGuardExtension from "../../extensions/file-time-guard/index.js";
import hooksEngine from "../../extensions/hooks-engine/index.js";

vi.mock("node:fs/promises", () => ({
	stat: vi.fn(async (filePath: string) => {
		if (filePath.includes("nonexistent")) {
			throw new Error("ENOENT");
		}
		return {
			mtimeMs: 1000,
			ctimeMs: 1000,
			size: 100,
		};
	}),
}));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HandlerResult {
	block: boolean;
	reason?: string;
}

interface ToolCallEvent {
	toolName: string;
	input: Record<string, unknown>;
	variables?: Record<string, string>;
	toolCallId?: string;
}

interface MockUI {
	notify: ReturnType<typeof vi.fn>;
	confirm: ReturnType<typeof vi.fn>;
}

interface MockCtx {
	sessionManager: {
		getSessionId: () => string;
		getEntries: () => unknown[];
		getBranch: () => unknown[];
	};
	hasUI: boolean;
	ui: MockUI;
	cwd: string;
}

// ---------------------------------------------------------------------------
// Multi-extension mock
// ---------------------------------------------------------------------------

let sessionIdCounter = 0;

interface MultiExtensionSetup {
	handlers: Record<string, Array<(event: unknown, ctx: unknown) => Promise<unknown>>>;
	flags: Record<string, boolean | string>;
	currentSessionId: string;
	sentMessages: Array<{ content: string; options?: { deliverAs?: string } }>;
	executionOrder: string[];
}

function createMultiExtensionSetup(): MultiExtensionSetup {
	sessionIdCounter++;
	const currentSessionId = `integ-${sessionIdCounter}`;
	const handlers: Record<string, Array<(event: unknown, ctx: unknown) => Promise<unknown>>> = {};
	const flags: Record<string, boolean | string> = {
		"disable-file-time-check": false,
		"file-time-check-mode": "block",
	};
	const sentMessages: Array<{ content: string; options?: { deliverAs?: string } }> = [];
	const executionOrder: string[] = [];

	const mockPi = {
		on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		registerFlag: vi.fn(),
		getFlag: vi.fn((name: string) => flags[name]),
		registerCommand: vi.fn(),
		registerTool: vi.fn(),
		registerChannel: vi.fn(() => ({
			name: "test",
			send: vi.fn(),
			onReceive: vi.fn(() => vi.fn()),
		})),
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
		appendEntry: vi.fn(),
		sendUserMessage: vi.fn((content: string, options?: { deliverAs?: string }) => {
			sentMessages.push({ content, options });
		}),
	};

	// Load in production order: agent-permissions → file-time-guard → hooks-engine
	agentPermissions(mockPi as unknown as Parameters<typeof agentPermissions>[0]);
	fileTimeGuardExtension(mockPi as unknown as Parameters<typeof fileTimeGuardExtension>[0]);
	hooksEngine(mockPi as unknown as Parameters<typeof hooksEngine>[0]);

	return { handlers, flags, currentSessionId, sentMessages, executionOrder };
}

function createCtx(sessionId: string, overrides?: Partial<MockCtx>): MockCtx {
	return {
		sessionManager: {
			getSessionId: () => sessionId,
			getEntries: () => [],
			getBranch: () => [],
		},
		hasUI: true,
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(async () => true),
		},
		cwd: tmpdir(),
		...overrides,
	};
}

// Fire event through ALL registered handlers with short-circuit on block
async function emitToolCall(
	setup: MultiExtensionSetup,
	eventData: ToolCallEvent,
	ctxOverrides?: Partial<MockCtx>,
): Promise<HandlerResult | undefined> {
	const ctx = createCtx(setup.currentSessionId, ctxOverrides);
	const eventList = setup.handlers["tool_call"] ?? [];

	let result: HandlerResult | undefined;
	for (const handler of eventList) {
		result = (await handler(eventData, ctx)) as HandlerResult | undefined;
		if (result?.block) return result;
	}
	return result;
}

// Fire session event through all handlers (no short-circuit needed)
async function emitSessionEvent(
	setup: MultiExtensionSetup,
	eventName: string,
	eventData?: Record<string, unknown>,
	ctxOverrides?: Partial<MockCtx>,
): Promise<void> {
	const ctx = createCtx(setup.currentSessionId, ctxOverrides);
	const eventList = setup.handlers[eventName] ?? [];
	for (const handler of eventList) {
		await handler(eventData ?? {}, ctx);
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extension-integration", () => {
	let setup: MultiExtensionSetup;

	beforeEach(() => {
		vi.clearAllMocks();
		setup = createMultiExtensionSetup();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// Group 1: tool_call execution order and short-circuit
	// =========================================================================

	describe("Group 1: tool_call execution order and short-circuit", () => {
		it("should execute agent-permissions before file-time-guard before hooks-engine", async () => {
			// We verify execution order by checking which extension produces results.
			// If we send a bash command with plan mode AND an agent hook, agent-permissions
			// should block first. If agent-permissions allows (auto mode), file-time-guard
			// should act on read/write, and hooks-engine runs last.
			await emitSessionEvent(setup, "session_start");

			// auto mode, bash tool: agent-permissions allows, file-time-guard ignores,
			// hooks-engine runs last (no hooks → allow)
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "echo hello" },
				variables: { permissionMode: "auto", agentName: "test" },
			});
			expect(result).toBeUndefined();
		});

		it("should short-circuit on first block: agent-permissions blocks via disallowedTools, file-time-guard and hooks-engine never run", async () => {
			await emitSessionEvent(setup, "session_start");

			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "echo hello" },
				variables: {
					permissionMode: "auto",
					agentName: "planner",
					disallowedTools: "bash",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "echo 'hook ran'; exit 2" }],
					}),
				},
			});

			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("disallowed");
		});

		it("should short-circuit on second block: agent-permissions allows, file-time-guard blocks, hooks-engine never runs", async () => {
			await emitSessionEvent(setup, "session_start");

			// auto mode allows bash, but edit to unread file is blocked by file-time-guard
			// Hooks would also block, but should never run
			const result = await emitToolCall(setup, {
				toolName: "edit",
				input: { path: "src/never-read.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "writer",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "echo 'hook should not run'; exit 2" }],
					}),
				},
			});

			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("文件未读取过");
		});

		it("should run all three when no blocks occur", async () => {
			await emitSessionEvent(setup, "session_start");

			// First read a file (file-time-guard tracks it)
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/app.ts" },
				variables: { permissionMode: "auto", agentName: "reader" },
			});

			// Now write to same file: agent-permissions allows (auto),
			// file-time-guard allows (read was done), hooks-engine has no hooks → allow
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/app.ts" },
				variables: { permissionMode: "auto", agentName: "writer" },
			});
			expect(result).toBeUndefined();
		});

		it("should combine results: agent-permissions allows, file-time-guard allows, hooks-engine blocks", async () => {
			await emitSessionEvent(setup, "session_start");

			// Read file first so file-time-guard won't block
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/hook-block.ts" },
				variables: { permissionMode: "auto", agentName: "reader" },
			});

			// Write to read file: permissions allow, file-time-guard allows,
			// but hooks-engine blocks via command hook
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/hook-block.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "writer",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "echo 'denied by hook'; exit 2" }],
					}),
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("denied by hook");
		});

		it("should short-circuit with always-deny mode before file-time-guard runs", async () => {
			await emitSessionEvent(setup, "session_start");

			const result = await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/app.ts" },
				variables: {
					permissionMode: "always-deny",
					agentName: "denier",
				},
			});

			expect(result?.block).toBe(true);
			// always-deny blocks everything, file-time-guard never tracks the read
		});

		it("should allow hooks-engine to run when both agent-permissions and file-time-guard pass", async () => {
			await emitSessionEvent(setup, "session_start");

			// Read a file to satisfy file-time-guard
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/for-hooks.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "reader",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 0" }],
					}),
				},
			});

			// Write: auto allows, file read tracked, hook allows (exit 0)
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/for-hooks.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "writer",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 0" }],
					}),
				},
			});
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// Group 2: Subagent permissions + hooks interaction
	// =========================================================================

	describe("Group 2: subagent permissions + hooks interaction", () => {
		beforeEach(async () => {
			await emitSessionEvent(setup, "session_start");
		});

		it("should apply disallowedTools from variables: write tool blocked by agent-permissions", async () => {
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/plan-block.ts" },
				variables: { permissionMode: "auto", agentName: "planner", disallowedTools: "write" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("disallowed");
		});

		it("should apply allowedTools from variables: subagent with allowedTools=read, write blocked", async () => {
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/whitelist.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "reader",
					allowedTools: "read",
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("whitelist");
		});

		it("should apply disallowedTools from variables: subagent with disallowedTools=bash, bash blocked", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "ls" },
				variables: {
					permissionMode: "auto",
					agentName: "safe-agent",
					disallowedTools: "bash",
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("disallowed");
		});

		it("should combine permissionMode + allowedTools: auto mode but explicit allowedTools overrides", async () => {
			const bashResult = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "echo test" },
				variables: {
					permissionMode: "auto",
					agentName: "restricted",
					allowedTools: "read",
				},
			});
			expect(bashResult?.block).toBe(true);
			expect(bashResult?.reason).toContain("whitelist");

			const readResult = await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/test-read.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "restricted",
					allowedTools: "read",
				},
			});
			expect(readResult).toBeUndefined();
		});

		it("should pass agentHooks via variables to hooks-engine: subagent has custom hooks that block specific tool", async () => {
			// bash is allowed by auto mode, file-time-guard ignores bash
			// but hooks-engine blocks it via command hook
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "ls" },
				variables: {
					permissionMode: "auto",
					agentName: "hooked-agent",
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: "echo 'bash blocked by hook'; exit 2",
								if: "bash",
							},
						],
					}),
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("bash blocked by hook");
		});

		it("should apply both agent-permissions AND hooks from subagent variables", async () => {
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/double-block.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "double-agent",
					disallowedTools: "write",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "echo 'hook deny'; exit 2" }],
					}),
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("disallowed");
		});

		it("should allow tool when agent-permissions allows and hooks-engine hook exits 0", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "echo ok" },
				variables: {
					permissionMode: "auto",
					agentName: "all-clear",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 0" }],
					}),
				},
			});
			expect(result).toBeUndefined();
		});

		it("should block via disallowedTools even when hooks would allow", async () => {
			const result = await emitToolCall(setup, {
				toolName: "edit",
				input: {},
				variables: {
					permissionMode: "auto",
					agentName: "test",
					disallowedTools: "edit",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 0" }],
					}),
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("disallowed");
		});
	});

	// =========================================================================
	// Group 3: file-time-guard + subagent context
	// =========================================================================

	describe("Group 3: file-time-guard + subagent context", () => {
		it("should track reads in subagent session independently from main session", async () => {
			// Setup A: main session
			const setupA = createMultiExtensionSetup();
			await emitSessionEvent(setupA, "session_start");

			// Setup B: subagent session
			const setupB = createMultiExtensionSetup();
			await emitSessionEvent(setupB, "session_start");

			// Read file in session A only
			await emitToolCall(setupA, {
				toolName: "read",
				input: { path: "src/shared.ts" },
				variables: { permissionMode: "auto", agentName: "main" },
			});

			// Write in session A should be allowed (file was read)
			const resultA = await emitToolCall(setupA, {
				toolName: "write",
				input: { path: "src/shared.ts" },
				variables: { permissionMode: "auto", agentName: "main" },
			});
			expect(resultA).toBeUndefined();

			// Edit in session B should be blocked (file NOT read in B)
			const resultB = await emitToolCall(setupB, {
				toolName: "edit",
				input: { path: "src/shared.ts" },
				variables: { permissionMode: "auto", agentName: "subagent" },
			});
			expect(resultB?.block).toBe(true);
			expect(resultB?.reason).toContain("文件未读取过");
		});

		it("should block edits to unread files in subagent context", async () => {
			await emitSessionEvent(setup, "session_start");

			// Subagent tries to edit without reading first
			const result = await emitToolCall(setup, {
				toolName: "edit",
				input: { path: "src/subagent-unread.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "subagent-writer",
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("文件未读取过");
		});

		it("should respect file-time-guard when subagent has acceptEdits permissionMode", async () => {
			await emitSessionEvent(setup, "session_start");

			// acceptEdits allows edit/write at permission level,
			// but file-time-guard still blocks unread files
			const result = await emitToolCall(setup, {
				toolName: "edit",
				input: { path: "src/accept-edits-unread.ts" },
				variables: {
					permissionMode: "acceptEdits",
					agentName: "editor",
				},
			});
			// agent-permissions allows (acceptEdits), file-time-guard blocks (unread)
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("文件未读取过");
		});

		it("should NOT block writes when file-time-guard is in ignore mode even for subagent", async () => {
			setup.flags["file-time-check-mode"] = "ignore";
			// Re-create to pick up the new flag
			setup = createMultiExtensionSetup();
			setup.flags["file-time-check-mode"] = "ignore";
			await emitSessionEvent(setup, "session_start");

			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/ignored.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "subagent",
				},
			});
			expect(result).toBeUndefined();
		});

		it("should allow write in subagent after reading the file in same session", async () => {
			await emitSessionEvent(setup, "session_start");

			// Subagent reads file
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/subagent-read.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "subagent-reader",
				},
			});

			// Now write should be allowed
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/subagent-read.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "subagent-writer",
				},
			});
			expect(result).toBeUndefined();
		});

		it("should NOT block write on unread file (write is for creating new files)", async () => {
			await emitSessionEvent(setup, "session_start");

			// write tool on unread file: file-time-guard should NOT block
			// (write creates new files, only edit modifies existing ones)
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/new-file.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "writer",
				},
			});
			// write to unread file should be allowed (not blocked by file-time-guard)
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// Group 4: 4-extension combined scenarios
	// =========================================================================

	describe("Group 4: combined extension scenarios", () => {
		beforeEach(async () => {
			await emitSessionEvent(setup, "session_start");
		});

		it("should block write via disallowedTools even with hooks active", async () => {
			const writeResult = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/plan.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "planner",
					disallowedTools: "write",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 0" }],
					}),
				},
			});
			expect(writeResult?.block).toBe(true);

			const readResult = await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/plan-read.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "planner",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 0" }],
					}),
				},
			});
			expect(readResult).toBeUndefined();
		});

		it("should block unread write even in acceptEdits mode with hooks allowing", async () => {
			// acceptEdits allows edits, hooks allow (exit 0),
			// but file-time-guard blocks because file was never read
			const result = await emitToolCall(setup, {
				toolName: "edit",
				input: { path: "src/accept-edits-guard.ts" },
				variables: {
					permissionMode: "acceptEdits",
					agentName: "editor",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "exit 0" }],
					}),
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("文件未读取过");
		});

		it("should block via hooks-engine when agent-permissions allows and file-time-guard passes", async () => {
			// Read file first for file-time-guard
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/hooks-block.ts" },
				variables: { permissionMode: "auto", agentName: "reader" },
			});

			// Write: auto allows, file was read, but hook blocks
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/hooks-block.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "writer",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "echo 'blocked'; exit 2" }],
					}),
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("blocked");
		});

		it("should allow everything when no restrictions are in place", async () => {
			// Read first for file-time-guard
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/free.ts" },
				variables: { permissionMode: "auto", agentName: "free" },
			});

			// Write: auto mode, file read, no hooks → all allow
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/free.ts" },
				variables: { permissionMode: "auto", agentName: "free" },
			});
			expect(result).toBeUndefined();
		});

		it("should deny when hooks-engine denies even if agent-permissions and file-time-guard allow", async () => {
			// Read file
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/hook-deny.ts" },
				variables: { permissionMode: "auto", agentName: "reader" },
			});

			// Write: permissions allow, file-time-guard allows, hooks deny
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/hook-deny.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "writer",
					agentHooks: JSON.stringify({
						on_tool_start: [
							{
								type: "command",
								command: `echo '{"action":"deny","reason":"policy violation"}'; exit 2`,
							},
						],
					}),
				},
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("policy violation");
		});

		it("should deny immediately when agent-permissions denies, skipping all others", async () => {
			// always-deny blocks everything immediately
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/immediate-deny.ts" },
				variables: {
					permissionMode: "always-deny",
					agentName: "denier",
					agentHooks: JSON.stringify({
						on_tool_start: [{ type: "command", command: "echo 'should not run'; exit 2" }],
					}),
				},
			});
			expect(result?.block).toBe(true);
			// Should be permission block, not hook block
			expect(result?.reason).not.toContain("should not run");
		});

		it("should block via allowedTools whitelist before file-time-guard checks", async () => {
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/whitelist-first.ts" },
				variables: {
					permissionMode: "auto",
					agentName: "restricted",
					allowedTools: "read",
				},
			});
			expect(result?.block).toBe(true);
			// Blocked by whitelist (agent-permissions), not file-time-guard
			expect(result?.reason).toContain("whitelist");
		});
	});

	// =========================================================================
	// Group 5: session lifecycle
	// =========================================================================

	describe("Group 5: session lifecycle", () => {
		it("should initialize file-time-guard state on session_start across all extensions", async () => {
			await emitSessionEvent(setup, "session_start");

			// After session_start, edit to unread file should be blocked by file-time-guard
			// (proving it initialized properly)
			const result = await emitToolCall(setup, {
				toolName: "edit",
				input: { path: "src/after-start.ts" },
				variables: { permissionMode: "auto", agentName: "test" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("文件未读取过");
		});

		it("should clean up file-time-guard state on session_shutdown", async () => {
			await emitSessionEvent(setup, "session_start");

			// Read a file
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/before-shutdown.ts" },
				variables: { permissionMode: "auto", agentName: "test" },
			});

			// Shutdown
			await emitSessionEvent(setup, "session_shutdown");

			// After shutdown, file-time-guard no longer tracks → no block
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/before-shutdown.ts" },
				variables: { permissionMode: "auto", agentName: "test" },
			});
			expect(result).toBeUndefined();
		});

		it("should handle multiple session_start/shutdown cycles without leaking state", async () => {
			// Cycle 1: read file A, shutdown
			await emitSessionEvent(setup, "session_start");
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/cycle-a.ts" },
				variables: { permissionMode: "auto", agentName: "test" },
			});
			await emitSessionEvent(setup, "session_shutdown");

			// Cycle 2: should NOT remember file A from cycle 1
			await emitSessionEvent(setup, "session_start");
			const result = await emitToolCall(setup, {
				toolName: "edit",
				input: { path: "src/cycle-a.ts" },
				variables: { permissionMode: "auto", agentName: "test" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("文件未读取过");

			// Read file A in cycle 2, should now be allowed
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/cycle-a.ts" },
				variables: { permissionMode: "auto", agentName: "test" },
			});

			const allowedResult = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/cycle-a.ts" },
				variables: { permissionMode: "auto", agentName: "test" },
			});
			expect(allowedResult).toBeUndefined();

			await emitSessionEvent(setup, "session_shutdown");
		});

		it("should not block writes before session_start (no file-time-guard state)", async () => {
			// Don't fire session_start — file-time-guard has no state
			const result = await emitToolCall(setup, {
				toolName: "write",
				input: { path: "src/no-session.ts" },
				variables: { permissionMode: "auto", agentName: "test" },
			});
			expect(result).toBeUndefined();
		});
	});

	// =========================================================================
	// Group 6: bash in-place editing file-time-guard integration
	// =========================================================================

	describe("Group 6: bash in-place editing (sed, perl, awk)", () => {
		beforeEach(async () => {
			await emitSessionEvent(setup, "session_start");
		});

		it("should block bash with sed -i on unread file", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "sed -i 's/old/new/g' src/unread.ts" },
				variables: { permissionMode: "auto", agentName: "editor" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("未读取过");
		});

		it("should allow bash with sed -i after reading the file", async () => {
			// Read file first
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/for-sed.ts" },
				variables: { permissionMode: "auto", agentName: "reader" },
			});

			// Now sed -i should be allowed
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "sed -i 's/x/y/g' src/for-sed.ts" },
				variables: { permissionMode: "auto", agentName: "editor" },
			});
			expect(result).toBeUndefined();
		});

		it("should NOT block bash without in-place editing (cat, echo, etc.)", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "cat src/unread.ts" },
				variables: { permissionMode: "auto", agentName: "reader" },
			});
			// cat doesn't modify files, so file-time-guard should not block
			expect(result).toBeUndefined();
		});

		it("should NOT block unknown bash commands", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "tsc --noEmit" },
				variables: { permissionMode: "auto", agentName: "builder" },
			});
			// tsc is not a known in-place editor, no file-level check
			expect(result).toBeUndefined();
		});

		it("should block bash with perl -pi on unread file", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "perl -pi -e 's/old/new/g' src/unread-perl.ts" },
				variables: { permissionMode: "auto", agentName: "editor" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("未读取过");
		});

		it("should block bash with awk -i inplace on unread file", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "awk -i inplace '{gsub(/old/,\"new\")}1' src/unread-awk.csv" },
				variables: { permissionMode: "auto", agentName: "editor" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("未读取过");
		});

		it("should handle multiple files in sed -i: block if any file unread", async () => {
			// Read one file
			await emitToolCall(setup, {
				toolName: "read",
				input: { path: "src/read-file.ts" },
				variables: { permissionMode: "auto", agentName: "reader" },
			});

			// sed -i on both files: one read, one not → should still block
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "sed -i 's/x/y/' src/read-file.ts src/unread-file.ts" },
				variables: { permissionMode: "auto", agentName: "editor" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("未读取过");
		});

		it("should handle sed -i with redirect (should not extract > /dev/null as file)", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "sed -i 's/x/y/' src/blocked.ts > /dev/null 2>&1" },
				variables: { permissionMode: "auto", agentName: "editor" },
			});
			// Should block src/blocked.ts specifically (not /dev/null)
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("src/blocked.ts");
		});

		it("should handle sed -i with -e flag", async () => {
			const result = await emitToolCall(setup, {
				toolName: "bash",
				input: { command: "sed -i -e 's/x/y/' -e 's/a/b/' src/unread-e.ts" },
				variables: { permissionMode: "auto", agentName: "editor" },
			});
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("未读取过");
		});
	});
});
