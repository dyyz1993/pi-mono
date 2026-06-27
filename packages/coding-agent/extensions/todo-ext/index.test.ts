/**
 * Tests for the todo-ext extension.
 *
 * Two test tiers:
 * 1. Registration + Channel: ExtensionRunner + real ChannelManager pattern
 *    (same pattern as test/extension-channels.test.ts)
 * 2. Tool Execution: createHarness full session simulation
 *    (same pattern as test/suite/agent-session-prompt.test.ts)
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { discoverAndLoadExtensions } from "../../src/core/extensions/index.ts";
import { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type {
	ExtensionActions,
	ExtensionContextActions,
} from "../../src/core/extensions/types.ts";
import { ChannelManager } from "../../src/core/extensions/channel-manager.ts";
import type { ChannelDataMessage, ChannelOutputFn } from "../../src/core/extensions/channel-types.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, type Harness } from "../../test/suite/harness.ts";
import todoExtFactory from "./index.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

function builtinExtensionPath(name: string): string {
	const url = new URL(".", import.meta.url);
	return join(url.pathname, "..", name);
}

function createCapturingChannelManager() {
	const outputs: ChannelDataMessage[] = [];
	const outputFn: ChannelOutputFn = (msg) => {
		outputs.push(msg);
	};
	const manager = new ChannelManager(outputFn);
	return { manager, outputs };
}

function findChannelEvent(
	outputs: ChannelDataMessage[],
	channelName: string,
	action: string,
): Record<string, unknown> | undefined {
	for (const msg of outputs) {
		if (msg.name !== channelName) continue;
		const d = msg.data as Record<string, unknown>;
		if (d?.action === action) return d;
	}
	return undefined;
}

const extensionActions: ExtensionActions = {
	sendMessage: () => {},
	sendUserMessage: () => {},
	appendEntry: () => undefined,
	deleteEntries: () => {},
	summarizeEntries: () => {},
	setSessionName: () => {},
	getSessionName: () => undefined,
	setLabel: () => {},
	getActiveTools: () => [],
	getAllTools: () => [],
	setActiveTools: () => {},
	refreshTools: () => {},
	setToolOperationsProvider: () => {},
	getToolOperationsProvider: () => undefined,
	getCommands: () => [],
	setModel: async () => false,
	getThinkingLevel: () => "off",
	setThinkingLevel: () => {},
	registerChannel: () => ({
		name: "todo",
		send: () => {},
		onReceive: () => () => {},
		invoke: async () => ({}),
		call: async () => ({}),
	}),
	callLLM: async () => "",
};

const extensionContextActions: ExtensionContextActions = {
	getModel: () => undefined,
	isIdle: () => true,
	isProjectTrusted: () => true,
	getSignal: () => undefined,
	abort: () => {},
	hasPendingMessages: () => false,
	shutdown: () => {},
	getContextUsage: () => undefined,
	compact: () => {},
	getSystemPrompt: () => "",
};

let tempDir: string;
let sessionManager: SessionManager;
let modelRegistry: ModelRegistry;

// ─── Tier 1: Registration + Channel ────────────────────────────────────────

describe("todo-ext registration and channel", () => {
	beforeEach(() => {
		tempDir = `/tmp/pi-todo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		mkdirSync(tempDir, { recursive: true });
		sessionManager = SessionManager.inMemory();
		const authStorage = new AuthStorage(join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("registers the todo tool", async () => {
		const extPath = builtinExtensionPath("todo-ext");
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);

		const ext = result.extensions[0];
		expect(ext.tools.has("todo")).toBe(true);
		const tool = ext.tools.get("todo")!;
		expect(tool.definition.name).toBe("todo");
		expect(tool.definition.description).toContain("Manage a todo list");
		expect(tool.sourceInfo).toBeDefined();
	});

	it("registers the /todos command", async () => {
		const extPath = builtinExtensionPath("todo-ext");
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.extensions[0]!.commands.has("todos")).toBe(true);
	});

	it("registers the todo channel and flushes pending registration", async () => {
		const extPath = builtinExtensionPath("todo-ext");
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

		const { manager } = createCapturingChannelManager();
		runner.flushPendingChannels((name) => manager.register(name));

		expect(manager.has("todo")).toBe(true);
		expect(result.runtime.resolvedChannels.has("todo")).toBe(true);
	});

	it("pending channels are resolved after flushPendingChannels", async () => {
		const extPath = builtinExtensionPath("todo-ext");
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);

		expect(result.runtime.pendingChannelRegistrations.length).toBeGreaterThan(0);
		expect(result.runtime.resolvedChannels.size).toBe(0);

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		const { manager } = createCapturingChannelManager();
		runner.flushPendingChannels((name) => manager.register(name));

		expect(result.runtime.pendingChannelRegistrations).toHaveLength(0);
		expect(result.runtime.resolvedChannels.has("todo")).toBe(true);
	});

	it("emits restored event on session_start via channel", async () => {
		const extPath = builtinExtensionPath("todo-ext");
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);

		const { manager, outputs } = createCapturingChannelManager();
		runner.flushPendingChannels((name) => manager.register(name));

		runner.setContextDirFns({
			getProjectRoot: () => tempDir,
			getSessionDataDir: () => tempDir,
			getProjectDataDir: () => tempDir,
			getCwdDataDir: () => tempDir,
			getGlobalDataDir: () => tempDir,
		});

		await runner.emit({ type: "session_start", reason: "startup" });

		const restored = findChannelEvent(outputs, "todo", "restored");
		expect(restored).toBeDefined();
		expect(restored!.action).toBe("restored");
		expect(Array.isArray(restored!.todos)).toBe(true);
	});
});

// ─── Tier 2: Tool Execution via Harness ────────────────────────────────────

describe("todo-ext tool execution", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	async function createTodoHarness(): Promise<Harness> {
		const harness = await createHarness({
			extensionFactories: [todoExtFactory],
		});
		harnesses.push(harness);
		return harness;
	}

	// ── add ──

	it("add: creates a single todo", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Write tests" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("add a task");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		expect(toolEvents.length).toBeGreaterThanOrEqual(1);
		const lastTool = toolEvents[toolEvents.length - 1]!;
		expect(lastTool.toolName).toBe("todo");
		expect(lastTool.isError).toBe(false);
		const result = lastTool.result as { content: Array<{ type: string; text: string }>; details: { action: string; todos: Array<{ id: number; text: string; done: boolean }>; nextId: number; added: Array<{ id: number; text: string }> } };
		expect(result.details.action).toBe("add");
		expect(result.details.added).toHaveLength(1);
		expect(result.details.added[0]!.text).toBe("Write tests");
		expect(result.details.todos).toHaveLength(1);
		expect(result.details.nextId).toBe(2);
	});

	it("add: creates batch todos with newline-separated text", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("todo", { action: "add", text: "Step 1\nStep 2\nStep 3" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create a plan");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		expect(toolEvents.length).toBeGreaterThanOrEqual(1);
		const lastTool = toolEvents[toolEvents.length - 1]!;
		const result = lastTool.result as { details: { action: string; todos: Array<{ text: string }>; added: Array<{ text: string }> } };
		expect(result.details.action).toBe("add_batch");
		expect(result.details.added).toHaveLength(3);
		expect(result.details.added.map((t: { text: string }) => t.text)).toEqual(["Step 1", "Step 2", "Step 3"]);
	});

	it("add: error when text is missing", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "add" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("add empty");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		expect(toolEvents.length).toBeGreaterThanOrEqual(1);
		const lastTool = toolEvents[toolEvents.length - 1]!;
		const result = lastTool.result as { content: Array<{ type: string; text: string }>; details: { error?: string } };
		expect(result.details.error).toBe("text required");
		expect(result.content[0]!.text).toContain("Error");
	});

	it("add: respects priority parameter", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Urgent task", priority: "high" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("add urgent task");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const lastTool = toolEvents[toolEvents.length - 1]!;
		const result = lastTool.result as { details: { added: Array<{ priority: string }> } };
		expect(result.details.added[0]!.priority).toBe("high");
	});

	// ── list ──

	it("list: returns empty when no todos", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "list" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("show todos");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const lastTool = toolEvents[toolEvents.length - 1]!;
		const result = lastTool.result as { content: Array<{ type: string; text: string }>; details: { totalActive: number } };
		expect(result.details.totalActive).toBe(0);
		expect(result.content[0]!.text).toContain("No todos");
	});

	it("list: returns active todos after adding", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Task A" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Task B" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "list" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("add two tasks and list");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		// Find the list call (last todo call)
		const listEvents = toolEvents.filter((e) => e.toolName === "todo");
		const listResult = listEvents[listEvents.length - 1]!.result as { details: { totalActive: number; todos: Array<{ text: string }> } };
		expect(listResult.details.totalActive).toBe(2);
		expect(listResult.details.todos.map((t: { text: string }) => t.text)).toContain("Task A");
		expect(listResult.details.todos.map((t: { text: string }) => t.text)).toContain("Task B");
	});

	// ── toggle ──

	it("toggle: marks a todo as done", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Toggle me" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "toggle", id: 1 }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("add and toggle");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const toggleEvents = toolEvents.filter(
			(e) => e.toolName === "todo" && (e.result as { details: { action: string } }).details.action === "toggle",
		);
		expect(toggleEvents).toHaveLength(1);
		const result = toggleEvents[0]!.result as { details: { modified: Array<{ id: number; done: boolean }> } };
		expect(result.details.modified).toHaveLength(1);
		expect(result.details.modified[0]!.done).toBe(true);
	});

	it("toggle: error when id is missing", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "toggle" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("toggle without id");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const lastTool = toolEvents[toolEvents.length - 1]!;
		const result = lastTool.result as { details: { error?: string } };
		expect(result.details.error).toBe("id required");
	});

	it("toggle: error when id not found", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "toggle", id: 999 }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("toggle nonexistent");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const lastTool = toolEvents[toolEvents.length - 1]!;
		const result = lastTool.result as { content: Array<{ type: string; text: string }>; details: { error?: string } };
		expect(result.details.error).toContain("not found");
		expect(result.content[0]!.text).toContain("Error");
	});

	// ── remove ──

	it("remove: deletes a todo by id", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Remove me" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "remove", id: 1 }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("add and remove");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const removeEvents = toolEvents.filter(
			(e) => e.toolName === "todo" && (e.result as { details: { action: string } }).details.action === "remove",
		);
		expect(removeEvents).toHaveLength(1);
		const result = removeEvents[0]!.result as { details: { deleted: Array<{ id: number; deleted?: boolean }> } };
		expect(result.details.deleted).toHaveLength(1);
	});

	it("remove: error when id is missing", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "remove" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("remove without id");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const lastTool = toolEvents[toolEvents.length - 1]!;
		const result = lastTool.result as { details: { error?: string } };
		expect(result.details.error).toBe("id required");
	});

	it("remove: error when id not found", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "remove", id: 999 }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("remove nonexistent");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const lastTool = toolEvents[toolEvents.length - 1]!;
		const result = lastTool.result as { details: { error?: string } };
		expect(result.details.error).toContain("not found");
	});

	// ── clear ──

	it("clear: removes all todos", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Task 1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Task 2" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "clear" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("add two and clear");

		const toolEvents = harness.eventsOfType("tool_execution_end");
		const clearEvents = toolEvents.filter(
			(e) => e.toolName === "todo" && (e.result as { details: { action: string } }).details.action === "clear",
		);
		expect(clearEvents).toHaveLength(1);
		const result = clearEvents[0]!.result as { details: { todos: unknown[]; nextId: number } };
		expect(result.details.todos).toHaveLength(0);
		expect(result.details.nextId).toBe(1);
	});

	// ── multi-step workflow ──

	it("full workflow: add, toggle, add more, list, remove, clear", async () => {
		const harness = await createTodoHarness();

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Task A\nTask B" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "toggle", id: 1 }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "add", text: "Task C", priority: "high" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "list" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "remove", id: 2 }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("todo", { action: "clear" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("full workflow test");

		const toolEvents = harness.eventsOfType("tool_execution_end").filter((e) => e.toolName === "todo");
		expect(toolEvents).toHaveLength(6);

		// Step 1: add batch
		const addResult = toolEvents[0]!.result as { details: { action: string; added: unknown[] } };
		expect(addResult.details.action).toBe("add_batch");
		expect(addResult.details.added).toHaveLength(2);

		// Step 2: toggle #1
		const toggleResult = toolEvents[1]!.result as { details: { action: string; modified: Array<{ id: number; done: boolean }> } };
		expect(toggleResult.details.action).toBe("toggle");
		expect(toggleResult.details.modified[0]!.done).toBe(true);

		// Step 3: add with priority
		const addPrioResult = toolEvents[2]!.result as { details: { added: Array<{ priority: string }> } };
		expect(addPrioResult.details.added[0]!.priority).toBe("high");

		// Step 4: list - should show 3 todos (A done, B active, C active)
		const listResult = toolEvents[3]!.result as { details: { totalActive: number; todos: unknown[] } };
		expect(listResult.details.todos).toHaveLength(3);

		// Step 5: remove #2
		const removeResult = toolEvents[4]!.result as { details: { deleted: Array<{ id: number }> } };
		expect(removeResult.details.deleted[0]!.id).toBe(2);

		// Step 6: clear
		const clearResult = toolEvents[5]!.result as { details: { todos: unknown[]; nextId: number } };
		expect(clearResult.details.todos).toHaveLength(0);
		expect(clearResult.details.nextId).toBe(1);
	});
});
