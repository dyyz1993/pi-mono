import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";
import todoExtensionDefault, { type TodoChannelEvent } from "./todo.js";

function createMockPi() {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const registeredTools = new Map<string, any>();
	const channelSend = vi.fn();
	const appendEntries: Array<{ type: string; data: unknown }> = [];
	const setWidgetCalls: Array<{ key: string; lines: string[] | undefined }> = [];
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
		off: vi.fn(),
		once: vi.fn(),
		emit: vi.fn(),
		setStatus: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
		registerChannel: vi.fn(() => {
			currentChannel = {
				name: "todo",
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
		registerCommand: vi.fn(),
	} as unknown as ExtensionAPI;

	return {
		pi,
		handlers,
		registeredTools,
		channelSend,
		appendEntries,
		setWidgetCalls,
		getCurrentChannel: () => currentChannel,
	};
}

function getTool(mock: ReturnType<typeof createMockPi>) {
	return mock.registeredTools.get("todo")!;
}

function _testCtx(overrides?: Record<string, unknown>) {
	return {
		sessionManager: { getBranch: () => [] },
		hasUI: true,
		ui: {
			notify: vi.fn(),
			setWidget: vi.fn(),
			theme: {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				warning: (t: string) => t,
				success: (t: string) => t,
				strikethrough: (t: string) => `~~${t}~~`,
				borderMuted: (t: string) => t,
			},
		},
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
		...overrides,
	};
}

function setupWithWidgetCtx(mock: ReturnType<typeof createMockPi>) {
	todoExtensionDefault(mock.pi);
	fireSessionStart(mock);
	mock.setWidgetCalls.length = 0;
	const tool = getTool(mock);

	const widgetCtx = {
		...mock,
		hasUI: true,
		ui: {
			notify: vi.fn(),
			setWidget: (key: string, lines?: string[] | undefined) => {
				mock.setWidgetCalls.push({ key, lines });
			},
			theme: {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				warning: (t: string) => t,
				success: (t: string) => t,
				strikethrough: (t: string) => `~~${t}~~`,
				borderMuted: (t: string) => t,
			},
		},
	};

	return { tool, widgetCtx };
}

function fireSessionStart(mock: ReturnType<typeof createMockPi>, ctxOverrides?: Record<string, unknown>): void {
	for (const h of mock.handlers.session_start ?? []) {
		h(
			{},
			{
				sessionManager: { getBranch: () => [] },
				hasUI: true,
				ui: {
					notify: vi.fn(),
					setWidget: vi.fn((key: string, lines?: string[] | undefined) => {
						mock.setWidgetCalls.push({ key, lines });
					}),
					theme: {
						fg: (_c: string, t: string) => t,
						bold: (t: string) => t,
						dim: (t: string) => t,
						accent: (t: string) => t,
						error: (t: string) => t,
						warning: (t: string) => t,
						success: (t: string) => t,
						strikethrough: (t: string) => t,
						borderMuted: (t: string) => t,
					},
				},
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

describe("todo extension", () => {
	describe("registration", () => {
		it("registers todo tool", () => {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			expect(mock.registeredTools.has("todo")).toBe(true);
		});

		it("registers /todos command", () => {
			const { pi } = createMockPi();
			todoExtensionDefault(pi);
			expect(pi.registerCommand).toHaveBeenCalledWith(
				"todos",
				expect.objectContaining({
					description: "Show all todos on the current branch",
				}),
			);
		});

		it("registers channel on session_start", () => {
			const { pi, handlers } = createMockPi();
			todoExtensionDefault(pi);

			fireSessionStart({
				pi,
				handlers,
				registeredTools: new Map(),
				channelSend: vi.fn(),
				appendEntries: [],
				setWidgetCalls: [],
				getCurrentChannel: () => null,
			});

			expect(pi.registerChannel).toHaveBeenCalledWith("todo");
		});

		it("tool has correct parameter schema", () => {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			const tool = mock.registeredTools.get("todo")!;
			expect(tool.parameters.properties.action).toBeDefined();
			expect(tool.parameters.properties.text).toBeDefined();
			expect(tool.parameters.properties.id).toBeDefined();
			expect(tool.parameters.required).toContain("action");
		});
	});

	describe("tool actions - LLM calls", () => {
		async function setup() {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			fireSessionStart(mock);
			return mock;
		}

		describe("list", () => {
			it("returns empty list when no todos", async () => {
				const mock = await setup();
				const tool = getTool(mock);
				const result = await tool.execute("tc_1", { action: "list" }, undefined, undefined, {} as any);

				expect(result.content[0].text).toBe("No todos");
				expect(result.details.todos).toEqual([]);
			});

			it("returns existing todos", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				await tool.execute("tc_1", { action: "add", text: "First task" }, undefined, undefined, {} as any);
				await tool.execute("tc_2", { action: "add", text: "Second task" }, undefined, undefined, {} as any);
				const result = await tool.execute("tc_3", { action: "list" }, undefined, undefined, {} as any);

				expect(result.details.todos).toHaveLength(2);
				expect(result.content[0].text).toContain("#1: First task");
				expect(result.content[0].text).toContain("#2: Second task");
			});
		});

		describe("add", () => {
			it("adds a new todo with incremental id", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				const result = await tool.execute(
					"tc_1",
					{ action: "add", text: "Buy milk" },
					undefined,
					undefined,
					{} as any,
				);

				expect(result.content[0].text).toContain("#1: Buy milk");
				expect(result.details.todos).toEqual([{ id: 1, text: "Buy milk", done: false }]);
				expect(result.details.nextId).toBe(2);
			});

			it("increments id for each add", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				await tool.execute("tc_1", { action: "add", text: "Task 1" }, undefined, undefined, {} as any);
				const result2 = await tool.execute(
					"tc_2",
					{ action: "add", text: "Task 2" },
					undefined,
					undefined,
					{} as any,
				);

				expect(result2.details.todos).toHaveLength(2);
				expect(result2.details.todos[1].id).toBe(2);
				expect(result2.details.nextId).toBe(3);
			});

			it("returns error when text is missing", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				const result = await tool.execute("tc_1", { action: "add" }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("Error:");
				expect(result.details.error).toBe("text required");
			});

			it("adds multiple todos from newline-separated text", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				const result = await tool.execute(
					"tc_1",
					{ action: "add", text: "Step 1\nStep 2\nStep 3" },
					undefined,
					undefined,
					{} as any,
				);

				expect(result.content[0].text).toContain("Added 3 todos");
				expect(result.details.todos).toHaveLength(3);
				expect(result.details.todos[0]).toEqual({ id: 1, text: "Step 1", done: false });
				expect(result.details.todos[1]).toEqual({ id: 2, text: "Step 2", done: false });
				expect(result.details.todos[2]).toEqual({ id: 3, text: "Step 3", done: false });
				expect(result.details.nextId).toBe(4);
			});

			it("skips empty lines in batch add", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				const result = await tool.execute(
					"tc_1",
					{ action: "add", text: "\nStep A\n\nStep B\n" },
					undefined,
					undefined,
					{} as any,
				);

				expect(result.details.todos).toHaveLength(2);
				expect(result.details.todos[0].text).toBe("Step A");
				expect(result.details.todos[1].text).toBe("Step B");
			});
		});

		describe("toggle", () => {
			it("toggles a todo to done", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				await tool.execute("tc_1", { action: "add", text: "Do it" }, undefined, undefined, {} as any);
				const result = await tool.execute("tc_2", { action: "toggle", id: 1 }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("completed");
				expect(result.details.todos[0].done).toBe(true);
			});

			it("toggles a todo back to undone", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				await tool.execute("tc_1", { action: "add", text: "Do it" }, undefined, undefined, {} as any);
				await tool.execute("tc_2", { action: "toggle", id: 1 }, undefined, undefined, {} as any);
				const result = await tool.execute("tc_3", { action: "toggle", id: 1 }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("uncompleted");
				expect(result.details.todos[0].done).toBe(false);
			});

			it("returns error when id is missing", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				const result = await tool.execute("tc_1", { action: "toggle" }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("Error:");
				expect(result.details.error).toBe("id required");
			});

			it("returns error for non-existent id", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				const result = await tool.execute("tc_1", { action: "toggle", id: 99 }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("not found");
				expect(result.details.error).toContain("#99");
			});
		});

		describe("remove", () => {
			it("logically deletes a todo (sets deleted flag)", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				await tool.execute("tc_1", { action: "add", text: "Keep this" }, undefined, undefined, {} as any);
				await tool.execute("tc_2", { action: "add", text: "Drop this" }, undefined, undefined, {} as any);
				const result = await tool.execute("tc_3", { action: "remove", id: 2 }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("Removed todo #2: Drop this");
				expect(result.details.todos).toHaveLength(2);
				expect(result.details.todos[1].deleted).toBe(true);
				expect(result.details.todos[0].deleted).toBeFalsy();
			});

			it("removed todos are hidden from list output", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				await tool.execute("tc_1", { action: "add", text: "Visible" }, undefined, undefined, {} as any);
				await tool.execute("tc_2", { action: "add", text: "Hidden" }, undefined, undefined, {} as any);
				await tool.execute("tc_3", { action: "remove", id: 2 }, undefined, undefined, {} as any);
				const result = await tool.execute("tc_4", { action: "list" }, undefined, undefined, {} as any);

				expect(result.content[0].text).not.toContain("Hidden");
				expect(result.content[0].text).toContain("#1: Visible");
			});

			it("list details still contain deleted todos for history", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				await tool.execute("tc_1", { action: "add", text: "A" }, undefined, undefined, {} as any);
				await tool.execute("tc_2", { action: "remove", id: 1 }, undefined, undefined, {} as any);
				const result = await tool.execute("tc_3", { action: "list" }, undefined, undefined, {} as any);

				expect(result.details.todos).toHaveLength(1);
				expect(result.details.todos[0].deleted).toBe(true);
			});

			it("returns error when id is missing", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				const result = await tool.execute("tc_1", { action: "remove" }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("Error:");
				expect(result.details.error).toBe("id required");
			});

			it("returns error for non-existent id", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				const result = await tool.execute("tc_1", { action: "remove", id: 99 }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("not found");
				expect(result.details.error).toContain("#99");
			});
		});

		describe("clear", () => {
			it("clears all todos and resets nextId", async () => {
				const mock = await setup();
				const tool = getTool(mock);

				await tool.execute("tc_1", { action: "add", text: "T1" }, undefined, undefined, {} as any);
				await tool.execute("tc_2", { action: "add", text: "T2" }, undefined, undefined, {} as any);
				const result = await tool.execute("tc_3", { action: "clear" }, undefined, undefined, {} as any);

				expect(result.content[0].text).toContain("Cleared 2");
				expect(result.details.todos).toEqual([]);
				expect(result.details.nextId).toBe(1);

				const afterClear = await tool.execute(
					"tc_4",
					{ action: "add", text: "New T1" },
					undefined,
					undefined,
					{} as any,
				);
				expect(afterClear.details.todos[0].id).toBe(1);
			});
		});
	});

	describe("channel push - real-time events", () => {
		async function setup() {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			fireSessionStart(mock);
			return mock;
		}

		it("pushes 'restored' event on session_start", async () => {
			const mock = await setup();

			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "restored",
					todos: [],
				}),
			);
		});

		it("pushes 'add' event when LLM adds a todo", async () => {
			const mock = await setup();
			mock.channelSend.mockClear();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "New task" }, undefined, undefined, {} as any);

			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "add",
					todos: [{ id: 1, text: "New task", done: false }],
				}),
			);
		});

		it("pushes 'toggle' event when LLM toggles a todo", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "Task" }, undefined, undefined, {} as any);
			mock.channelSend.mockClear();
			await tool.execute("tc_2", { action: "toggle", id: 1 }, undefined, undefined, {} as any);

			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "toggle",
					todos: [{ id: 1, text: "Task", done: true }],
				}),
			);
		});

		it("pushes 'clear' event when LLM clears todos", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "T" }, undefined, undefined, {} as any);
			mock.channelSend.mockClear();
			await tool.execute("tc_2", { action: "clear" }, undefined, undefined, {} as any);

			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "clear",
					todos: [],
				}),
			);
		});

		it("pushes 'remove' event with deleted flag in todos", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "Keep" }, undefined, undefined, {} as any);
			await tool.execute("tc_2", { action: "add", text: "Drop" }, undefined, undefined, {} as any);
			mock.channelSend.mockClear();
			await tool.execute("tc_3", { action: "remove", id: 2 }, undefined, undefined, {} as any);

			const sentData = mock.channelSend.mock.calls[0][0] as TodoChannelEvent;
			expect(sentData.action).toBe("remove");
			expect(sentData.todos).toHaveLength(2);
			expect(sentData.todos.find((t) => t.id === 2)?.deleted).toBe(true);
			expect(sentData.todos.find((t) => t.id === 1)?.deleted).toBeFalsy();
		});

		it("pushes 'list' event when LLM lists todos", async () => {
			const mock = await setup();
			mock.channelSend.mockClear();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "list" }, undefined, undefined, {} as any);

			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "list",
					todos: [],
				}),
			);
		});

		it("includes timestamp in every push", async () => {
			const mock = await setup();
			mock.channelSend.mockClear();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "Test" }, undefined, undefined, {} as any);

			const sentData = mock.channelSend.mock.calls[0][0] as TodoChannelEvent;
			expect(sentData.timestamp).toBeGreaterThan(0);
			expect(typeof sentData.timestamp).toBe("number");
		});
	});

	describe("appendEntry persistence", () => {
		async function setup() {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			fireSessionStart(mock);
			return mock;
		}

		it("persists add entry", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "Persist me" }, undefined, undefined, {} as any);

			const entry = mock.appendEntries.find((e) => e.type === "todo");
			expect(entry).toBeDefined();
			const data = entry!.data as any;
			expect(data.action).toBe("add");
			expect(data.todos).toEqual([{ id: 1, text: "Persist me", done: false }]);
			expect(data.nextId).toBe(2);
			expect(data.timestamp).toBeDefined();
		});

		it("persists toggle entry", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "Toggle me" }, undefined, undefined, {} as any);
			mock.appendEntries.length = 0;
			await tool.execute("tc_2", { action: "toggle", id: 1 }, undefined, undefined, {} as any);

			const entry = mock.appendEntries.find((e) => e.type === "todo");
			expect(entry!.data).toMatchObject({
				action: "toggle",
				todos: [{ id: 1, text: "Toggle me", done: true }],
			});
		});

		it("persists clear entry", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "Gone" }, undefined, undefined, {} as any);
			mock.appendEntries.length = 0;
			await tool.execute("tc_2", { action: "clear" }, undefined, undefined, {} as any);

			const entry = mock.appendEntries.find((e) => e.type === "todo");
			expect(entry!.data).toMatchObject({
				action: "clear",
				todos: [],
				nextId: 1,
			});
		});

		it("persists error entries", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add" }, undefined, undefined, {} as any);

			const errorEntry = mock.appendEntries.find((e) => e.type === "todo");
			expect(errorEntry!.data).toMatchObject({
				action: "add_error",
			});
		});

		it("every action produces exactly one appendEntry", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute("tc_1", { action: "add", text: "A" }, undefined, undefined, {} as any);
			await tool.execute("tc_2", { action: "add", text: "B" }, undefined, undefined, {} as any);
			await tool.execute("tc_3", { action: "toggle", id: 1 }, undefined, undefined, {} as any);
			await tool.execute("tc_4", { action: "list" }, undefined, undefined, {} as any);

			const todoEntries = mock.appendEntries.filter((e) => e.type === "todo");
			expect(todoEntries).toHaveLength(4);
		});
	});

	describe("channel + appendEntry integration", () => {
		it("full lifecycle: add -> toggle -> list -> clear with both outputs", async () => {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			fireSessionStart(mock);
			const tool = getTool(mock);

			mock.channelSend.mockClear();
			mock.appendEntries.length = 0;

			const r1 = await tool.execute("tc_1", { action: "add", text: "Step 1" }, undefined, undefined, {} as any);
			expect(r1.details.todos).toHaveLength(1);
			expect(mock.channelSend).toHaveBeenCalledTimes(1);
			expect(mock.appendEntries).toHaveLength(1);

			const r2 = await tool.execute("tc_2", { action: "add", text: "Step 2" }, undefined, undefined, {} as any);
			expect(r2.details.todos).toHaveLength(2);
			expect(mock.channelSend).toHaveBeenCalledTimes(2);
			expect(mock.appendEntries).toHaveLength(2);

			const r3 = await tool.execute("tc_3", { action: "toggle", id: 1 }, undefined, undefined, {} as any);
			expect(r3.details.todos[0].done).toBe(true);
			expect(mock.channelSend).toHaveBeenCalledTimes(3);
			expect(mock.appendEntries).toHaveLength(3);

			const r4 = await tool.execute("tc_4", { action: "list" }, undefined, undefined, {} as any);
			expect(r4.details.todos).toHaveLength(2);
			expect(mock.channelSend).toHaveBeenCalledTimes(4);
			expect(mock.appendEntries).toHaveLength(4);

			const r5 = await tool.execute("tc_5", { action: "clear" }, undefined, undefined, {} as any);
			expect(r5.details.todos).toHaveLength(0);
			expect(mock.channelSend).toHaveBeenCalledTimes(5);
			expect(mock.appendEntries).toHaveLength(5);
		});
	});

	describe("priority", () => {
		async function setup() {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			fireSessionStart(mock);
			return mock;
		}

		it("sets priority when provided on add", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			const result = await tool.execute(
				"tc_1",
				{ action: "add", text: "Urgent task", priority: "high" },
				undefined,
				undefined,
				{} as any,
			);

			expect(mock.registeredTools.get("todo")!.parameters.properties.priority).toBeDefined();
			expect(result.details.todos[0].priority).toBe("high");
		});

		it("defaults to no priority when not specified", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			const result = await tool.execute(
				"tc_1",
				{ action: "add", text: "Normal task" },
				undefined,
				undefined,
				{} as any,
			);

			expect(result.details.todos[0].priority).toBeUndefined();
		});

		it("persists priority in appendEntry", async () => {
			const mock = await setup();
			const tool = getTool(mock);

			await tool.execute(
				"tc_1",
				{ action: "add", text: "Low prio", priority: "low" },
				undefined,
				undefined,
				{} as any,
			);

			const entry = mock.appendEntries.find((e) => e.type === "todo");
			expect((entry!.data as any).todos[0].priority).toBe("low");
		});
	});

	describe("setWidget - live panel rendering", () => {
		it("renders widget after add", async () => {
			const { tool, widgetCtx } = setupWithWidgetCtx(createMockPi());

			await tool.execute("tc_1", { action: "add", text: "Show in panel" }, undefined, undefined, widgetCtx);

			expect(widgetCtx.setWidgetCalls).toHaveLength(1);
			expect(widgetCtx.setWidgetCalls[0].key).toBe("todo-todos");
			expect(widgetCtx.setWidgetCalls[0].lines).toBeDefined();
			expect(widgetCtx.setWidgetCalls[0].lines!.length).toBe(1);
		});

		it("clears widget when all todos cleared", async () => {
			const { tool, widgetCtx } = setupWithWidgetCtx(createMockPi());

			await tool.execute("tc_1", { action: "add", text: "T" }, undefined, undefined, widgetCtx);
			widgetCtx.setWidgetCalls.length = 0;
			await tool.execute("tc_2", { action: "clear" }, undefined, undefined, widgetCtx);

			expect(widgetCtx.setWidgetCalls[widgetCtx.setWidgetCalls.length - 1].lines).toBeUndefined();
		});

		it("updates widget on toggle", async () => {
			const { tool, widgetCtx } = setupWithWidgetCtx(createMockPi());

			await tool.execute("tc_1", { action: "add", text: "Task" }, undefined, undefined, widgetCtx);
			widgetCtx.setWidgetCalls.length = 0;
			await tool.execute("tc_2", { action: "toggle", id: 1 }, undefined, undefined, widgetCtx);

			expect(widgetCtx.setWidgetCalls).toHaveLength(1);
		});

		it("updates widget on remove", async () => {
			const { tool, widgetCtx } = setupWithWidgetCtx(createMockPi());

			await tool.execute("tc_1", { action: "add", text: "Gone" }, undefined, undefined, widgetCtx);
			widgetCtx.setWidgetCalls.length = 0;
			await tool.execute("tc_2", { action: "remove", id: 1 }, undefined, undefined, widgetCtx);

			expect(widgetCtx.setWidgetCalls).toHaveLength(1);
		});
	});

	describe("renderCall / renderResult methods", () => {
		it("tool has renderCall method", () => {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			const tool = mock.registeredTools.get("todo")!;
			expect(typeof tool.renderCall).toBe("function");
		});

		it("tool has renderResult method", () => {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			const tool = mock.registeredTools.get("todo")!;
			expect(typeof tool.renderResult).toBe("function");
		});

		it("renderCall returns Text with action name", () => {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			const tool = mock.registeredTools.get("todo")!;
			const theme = {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				strikethrough: (t: string) => t,
			};
			const result = tool.renderCall({ action: "add", text: "hello" }, theme as any);
			expect(result.text).toContain("todo");
			expect(result.text).toContain("add");
		});

		it("renderResult renders list with checkmarks", () => {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			const tool = mock.registeredTools.get("todo")!;
			const theme = {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				strikethrough: (t: string) => t,
			};
			const result = tool.renderResult(
				{
					content: [{ type: "text", text: "[x] #1: Test\n[ ] #2: Test2" }],
					details: {
						action: "list",
						todos: [
							{ id: 1, text: "Test", done: true },
							{ id: 2, text: "Test2", done: false },
						],
						nextId: 3,
					},
				},
				{ expanded: true },
				theme as any,
			);
			expect(result.text).toContain("2 todos");
			expect(result.text).toContain("☑");
			expect(result.text).toContain("☐");
			expect(result.text).toContain("Test");
			expect(result.text).toContain("已完成");
			expect(result.text).toContain("待处理");
		});

		it("renderResult renders remove with list card", () => {
			const mock = createMockPi();
			todoExtensionDefault(mock.pi);
			const tool = mock.registeredTools.get("todo")!;
			const theme = {
				fg: (_c: string, t: string) => t,
				bold: (t: string) => t,
				dim: (t: string) => t,
				accent: (t: string) => t,
				error: (t: string) => t,
				strikethrough: (t: string) => t,
			};
			const result = tool.renderResult(
				{
					content: [{ type: "text", text: "Removed todo #1: Gone" }],
					details: { action: "remove", todos: [], nextId: 1 },
				},
				{ expanded: false },
				theme as any,
			);
			expect(result.text).toContain("0 todos");
		});
	});
});
