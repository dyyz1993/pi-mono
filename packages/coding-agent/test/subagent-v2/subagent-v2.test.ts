import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import subagentV2Extension, { extractParentTodos } from "../../extensions/subagent-v2/index.js";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";

const mockRpcClientInstances: Array<{
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	prompt: ReturnType<typeof vi.fn>;
	waitForIdle: ReturnType<typeof vi.fn>;
	abort: ReturnType<typeof vi.fn>;
	steer: ReturnType<typeof vi.fn>;
	setActiveTools: ReturnType<typeof vi.fn>;
	onEvent: ReturnType<typeof vi.fn>;
	getStderr: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@dyyz1993/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dyyz1993/pi-coding-agent")>();
	return {
		...actual,
		RpcClient: class MockRpcClient {
			start = vi.fn(async () => {});
			stop = vi.fn(async () => {});
			prompt = vi.fn(async () => {});
			waitForIdle = vi.fn(async () => {});
			abort = vi.fn(async () => {});
			steer = vi.fn(async () => {});
			setActiveTools = vi.fn(async () => {});
			onEvent = vi.fn(() => () => {});
			getStderr = vi.fn(() => "");
		},
		discoverAgents: vi.fn((_cwd: string, _scope: string) => ({
			agents: [
				{
					name: "code",
					description: "Code agent",
					systemPrompt: "You are a coding assistant.",
					tools: ["read", "write", "bash"],
					source: "builtin",
					model: "claude-sonnet-4",
					filePath: "",
					mode: "subagent",
				},
				{
					name: "plan",
					description: "Plan agent",
					systemPrompt: "You plan things.",
					tools: ["read"],
					source: "builtin",
					model: "claude-sonnet-4",
					filePath: "",
					mode: "subagent",
				},
			],
			projectAgentsDir: null,
		})),
	};
});

function createMockPi() {
	const handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown>> = {};
	const registeredTools = new Map<string, unknown>();
	const channelSend = vi.fn();
	const appendEntries: Array<{ type: string; data: unknown }> = [];
	let sessionName: string | undefined;

	const pi = {
		on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		callLLM: vi.fn(async () => "mock title"),
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
			name: "subagent",
			send: channelSend,
			onReceive: vi.fn(() => () => {}),
			invoke: vi.fn(),
			emit: vi.fn(),
		})),
		registerTool: vi.fn((tool: { name: string }) => {
			registeredTools.set(tool.name, tool);
		}),
		appendEntry: vi.fn((type: string, data?: unknown) => {
			appendEntries.push({ type, data });
		}),
		sendUserMessage: vi.fn(),
		registerCommand: vi.fn(),
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		getSessionName: vi.fn(() => sessionName),
		setSessionName: vi.fn((name: string) => {
			sessionName = name;
		}),
	} as unknown as ExtensionAPI;

	return {
		pi,
		handlers,
		registeredTools,
		channelSend,
		appendEntries,
	};
}

function testCtx(overrides?: Record<string, unknown>) {
	return {
		sessionManager: {
			getBranch: () => [],
			getSessionId: () => "test-session-123",
			getEntries: () => [],
		},
		hasUI: true,
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(async () => true),
		},
		cwd: tmpdir(),
		model: { provider: "test-provider", id: "test-model" },
		...overrides,
	};
}

describe("subagent-v2 extension", () => {
	beforeEach(() => {
		mockRpcClientInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("registration", () => {
		it("registers subagent tool", () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			expect(mock.registeredTools.has("subagent")).toBe(true);
		});

		it("registers subagent_resume tool", () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			expect(mock.registeredTools.has("subagent_resume")).toBe(true);
		});

		it("registers subagent channel", () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			expect(mock.pi.registerChannel).toHaveBeenCalledWith("subagent");
		});

		it("subagent tool has correct parameter schema", () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			const tool = mock.registeredTools.get("subagent") as {
				name: string;
				parameters: { properties: Record<string, unknown>; required?: string[] };
			};
			expect(tool.parameters.properties.agent).toBeDefined();
			expect(tool.parameters.properties.task).toBeDefined();
			expect(tool.parameters.required).toContain("agent");
			expect(tool.parameters.required).toContain("task");
		});

		it("tool has renderCall method", () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			const tool = mock.registeredTools.get("subagent") as { renderCall: unknown };
			expect(typeof tool.renderCall).toBe("function");
		});

		it("tool has renderResult method", () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			const tool = mock.registeredTools.get("subagent") as { renderResult: unknown };
			expect(typeof tool.renderResult).toBe("function");
		});
	});

	describe("error handling", () => {
		it("returns error for unknown agent", async () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			const tool = mock.registeredTools.get("subagent") as {
				execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
			};

			const result = (await tool.execute("tc_1", { agent: "nonexistent", task: "do stuff" }, undefined, undefined, testCtx())) as {
				content: Array<{ type: string; text: string }>;
			};

			expect(result.content[0].text).toContain("Unknown agent");
			expect(result.content[0].text).toContain("nonexistent");
		});

		it("lists available agents when agent not found", async () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			const tool = mock.registeredTools.get("subagent") as {
				execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
			};

			const result = (await tool.execute("tc_1", { agent: "nonexistent", task: "do stuff" }, undefined, undefined, testCtx())) as {
				content: Array<{ type: string; text: string }>;
			};

			expect(result.content[0].text).toContain("code");
			expect(result.content[0].text).toContain("plan");
		});
	});

	describe("background mode", () => {
		it("returns immediately with background task ID", async () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			const tool = mock.registeredTools.get("subagent") as {
				execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
			};

			const result = (await tool.execute(
				"tc_bg_1",
				{ agent: "code", task: "background task", background: true },
				undefined,
				undefined,
				testCtx(),
			)) as {
				content: Array<{ type: string; text: string }>;
			};

			expect(result.content[0].text).toContain("Started background task");
			expect(result.content[0].text).toContain("bg-");
		});
	});

	describe("extractParentTodos", () => {
		it("extracts active todos from custom entries", () => {
			const branch = [
				{
					type: "custom",
					customType: "todo",
					data: {
						todos: [
							{ id: 1, text: "Active task", done: false },
							{ id: 2, text: "Done task", done: true },
							{ id: 3, text: "Deleted task", done: false, deleted: true },
						],
						nextId: 4,
					},
				},
			];

			const result = extractParentTodos(branch);
			expect(result).toEqual([{ id: 1, text: "Active task", priority: undefined, done: false }]);
		});

		it("extracts todos from tool result messages", () => {
			const branch = [
				{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "todo",
						details: {
							todos: [{ id: 1, text: "From tool result", done: false }],
							nextId: 2,
						},
					},
				},
			];

			const result = extractParentTodos(branch);
			expect(result).toEqual([{ id: 1, text: "From tool result", priority: undefined, done: false }]);
		});

		it("returns empty array for empty branch", () => {
			expect(extractParentTodos([])).toEqual([]);
		});

		it("skips non-relevant entries", () => {
			const branch = [
				{ type: "message", message: { role: "user", content: "hello" } },
				{ type: "message", message: { role: "toolResult", toolName: "bash" } },
				{ type: "other" },
			];

			expect(extractParentTodos(branch)).toEqual([]);
		});

		it("later entries override earlier ones", () => {
			const branch = [
				{
					type: "custom",
					customType: "todo",
					data: {
						todos: [{ id: 1, text: "First", done: false }],
						nextId: 2,
					},
				},
				{
					type: "custom",
					customType: "todo",
					data: {
						todos: [{ id: 1, text: "Second", done: false }],
						nextId: 2,
					},
				},
			];

			const result = extractParentTodos(branch);
			expect(result).toEqual([{ id: 1, text: "Second", priority: undefined, done: false }]);
		});
	});

	describe("renderCall", () => {
		it("renders agent name and task preview", () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			const tool = mock.registeredTools.get("subagent") as {
				renderCall: (args: unknown, theme: unknown, ctx: unknown) => { text: string };
			};

			const theme = {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				muted: (t: string) => t,
				warning: (t: string) => t,
				toolTitle: (t: string) => t,
			};

			const result = tool.renderCall(
				{ agent: "code", task: "fix the bug in the authentication module", agentScope: "user" },
				theme,
				{},
			);
			expect(result.text).toContain("subagent");
			expect(result.text).toContain("code");
		});

		it("renders background indicator when background is true", () => {
			const mock = createMockPi();
			subagentV2Extension(mock.pi);
			const tool = mock.registeredTools.get("subagent") as {
				renderCall: (args: unknown, theme: unknown, ctx: unknown) => { text: string };
			};

			const theme = {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				muted: (t: string) => t,
				warning: (t: string) => t,
				toolTitle: (t: string) => t,
			};

			const result = tool.renderCall(
				{ agent: "code", task: "do stuff", background: true },
				theme,
				{},
			);
			expect(result.text).toContain("[bg]");
		});
	});
});
