import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "../../../extensions/coordinator/handler.js";
import coordinatorExtension from "../../../extensions/coordinator/index.js";
import type { DelegatedTask } from "../../../extensions/coordinator/types.js";

type ExtensionEventType =
	| "resources_discover"
	| "session_start"
	| "session_before_switch"
	| "session_before_fork"
	| "session_before_compact"
	| "session_compact"
	| "session_shutdown"
	| "session_rename"
	| "session_before_tree"
	| "session_tree"
	| "context"
	| "before_provider_request"
	| "after_provider_response"
	| "before_agent_start"
	| "agent_start"
	| "agent_end"
	| "turn_start"
	| "turn_end"
	| "message_start"
	| "message_update"
	| "message_end"
	| "tool_execution_start"
	| "tool_execution_update"
	| "tool_execution_end"
	| "model_select"
	| "thinking_level_select"
	| "tool_call"
	| "tool_result"
	| "user_bash"
	| "input"
	| "ui";

const ALL_EXTENSION_EVENTS: ExtensionEventType[] = [
	"resources_discover",
	"session_start",
	"session_before_switch",
	"session_before_fork",
	"session_before_compact",
	"session_compact",
	"session_shutdown",
	"session_rename",
	"session_before_tree",
	"session_tree",
	"context",
	"before_provider_request",
	"after_provider_response",
	"before_agent_start",
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"model_select",
	"thinking_level_select",
	"tool_call",
	"tool_result",
	"user_bash",
	"input",
	"ui",
];

interface CapturedHandlers {
	events: Set<string>;
	tools: Set<string>;
	commands: Set<string>;
}

function inspectCoordinatorExtension(): CapturedHandlers {
	const captured: CapturedHandlers = {
		events: new Set(),
		tools: new Set(),
		commands: new Set(),
	};

	const fakeChannel = {
		name: "coordinator",
		send: () => {},
		onReceive: () => () => {},
		invoke: () => Promise.resolve({}),
		call: () => Promise.resolve({}),
	};

	const fakeAPI = {
		on: (event: string, _handler: (...args: unknown[]) => unknown) => {
			captured.events.add(event);
		},
		registerTool: (tool: { name: string }) => {
			captured.tools.add(tool.name);
		},
		registerCommand: (name: string) => {
			captured.commands.add(name);
		},
		registerChannel: (_name: string) => fakeChannel,
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		foldEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		setName: () => {},
		extensionName: "test-coordinator",
	} as unknown as Parameters<typeof coordinatorExtension>[0];

	coordinatorExtension(fakeAPI);

	return captured;
}

describe("coordinator event lifecycle analysis", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			if (fs.existsSync(dir)) {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}
		tempDirs.length = 0;
	});

	it("documents all available ExtensionEvent types", () => {
		expect(ALL_EXTENSION_EVENTS).toContain("session_start");
		expect(ALL_EXTENSION_EVENTS).toContain("session_shutdown");
		expect(ALL_EXTENSION_EVENTS).toContain("context");
		expect(ALL_EXTENSION_EVENTS).toContain("agent_end");
		expect(ALL_EXTENSION_EVENTS).toContain("tool_call");
		expect(ALL_EXTENSION_EVENTS).toContain("tool_result");
		expect(ALL_EXTENSION_EVENTS).toContain("message_start");
		expect(ALL_EXTENSION_EVENTS).toContain("message_end");
		expect(ALL_EXTENSION_EVENTS).toContain("turn_start");
		expect(ALL_EXTENSION_EVENTS).toContain("turn_end");
		expect(ALL_EXTENSION_EVENTS).toContain("before_agent_start");

		expect(ALL_EXTENSION_EVENTS.length).toBe(31);
	});

	it("coordinator only listens to session_start and context events", () => {
		const captured = inspectCoordinatorExtension();

		expect(captured.events).toContain("session_start");
		expect(captured.events).toContain("context");

		const criticalMissingEvents: ExtensionEventType[] = ["agent_end", "session_shutdown", "tool_result"];

		for (const missing of criticalMissingEvents) {
			expect(captured.events).not.toContain(missing);
		}
	});

	it("coordinator registers the expected tools", () => {
		const captured = inspectCoordinatorExtension();

		expect(captured.tools).toContain("session_delegate");
		expect(captured.tools).toContain("session_delegate_send");
		expect(captured.tools).toContain("session_delegate_status");
		expect(captured.tools).toContain("session_delegate_stop");
		expect(captured.tools).toContain("session_delegate_fork");
	});

	it("GAP: coordinator never listens to agent_end for task cleanup", () => {
		const captured = inspectCoordinatorExtension();

		expect(captured.events).not.toContain("agent_end");
	});

	it("GAP: coordinator never listens to session_shutdown for task removal", () => {
		const captured = inspectCoordinatorExtension();

		expect(captured.events).not.toContain("session_shutdown");
	});

	it("GAP: TaskStore.remove() exists but is never called from any event handler", () => {
		const storeProto = Object.getOwnPropertyNames(TaskStore.prototype);
		expect(storeProto).toContain("remove");

		const captured = inspectCoordinatorExtension();

		const handlersThatCouldRemove: string[] = [];
		for (const eventName of captured.events) {
			handlersThatCouldRemove.push(eventName);
		}

		expect(handlersThatCouldRemove).not.toContain("agent_end");
		expect(handlersThatCouldRemove).not.toContain("session_shutdown");
		expect(handlersThatCouldRemove).not.toContain("tool_result");
	});

	it("GAP: buildPrompt() includes all tasks without filtering (by design)", () => {
		const sessionDir = path.join(os.tmpdir(), `coord-analysis-${Date.now()}`);
		fs.mkdirSync(sessionDir, { recursive: true });
		tempDirs.push(sessionDir);

		const store = new TaskStore(sessionDir);

		store.add({
			sessionId: "s-stopped",
			title: "Stopped Task",
			task: "visible by design",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "stopped",
		});
		store.add({
			sessionId: "s-completed",
			title: "Completed Task",
			task: "visible by design",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "completed",
			completedAt: Date.now(),
		});
		store.add({
			sessionId: "s-active",
			title: "Active Task",
			task: "visible by design",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const prompt = store.buildPrompt();

		expect(prompt).toContain("Stopped Task");
		expect(prompt).toContain("Completed Task");
		expect(prompt).toContain("Active Task");
	});

	it("GAP: coordinator does not validate that referenced sessions still exist", () => {
		const sessionDir = path.join(os.tmpdir(), `coord-analysis-2-${Date.now()}`);
		fs.mkdirSync(sessionDir, { recursive: true });
		tempDirs.push(sessionDir);

		const store = new TaskStore(sessionDir);

		store.add({
			sessionId: "ghost-session-deleted-externally",
			title: "Ghost session",
			task: "session was deleted but task remains",
			projectPath: "/tmp/nonexistent",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const prompt = store.buildPrompt();
		expect(prompt).toContain("ghost-session-deleted-externally");
		expect(prompt).toContain("Ghost session");

		const tasks = store.list();
		expect(tasks.length).toBe(1);
		expect(tasks[0].sessionId).toBe("ghost-session-deleted-externally");
	});

	it("tasks survive store reload from disk (persistence verification)", () => {
		const sessionDir = path.join(os.tmpdir(), `coord-analysis-3-${Date.now()}`);
		fs.mkdirSync(sessionDir, { recursive: true });
		tempDirs.push(sessionDir);

		const store1 = new TaskStore(sessionDir);
		store1.add({
			sessionId: "s-persist-stale",
			title: "Persistent task",
			task: "survives reload",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "stopped",
		});

		const store2 = new TaskStore(sessionDir);
		const reloaded = store2.list();
		expect(reloaded.length).toBe(1);
		expect(reloaded[0].status).toBe("stopped");
		expect(reloaded[0].title).toBe("Persistent task");

		const prompt = store2.buildPrompt();
		expect(prompt).toContain("Persistent task");
		expect(prompt).toContain("STOPPED");
	});

	it("documents the complete event handling gap summary", () => {
		const captured = inspectCoordinatorExtension();

		const listenedEvents = Array.from(captured.events);
		const missingCleanupEvents: ExtensionEventType[] = ALL_EXTENSION_EVENTS.filter(
			(e) => !listenedEvents.includes(e),
		);

		expect(missingCleanupEvents).toContain("agent_end");
		expect(missingCleanupEvents).toContain("session_shutdown");
		expect(missingCleanupEvents).toContain("tool_result");
		expect(missingCleanupEvents).toContain("turn_end");
		expect(missingCleanupEvents).toContain("message_end");

		expect(captured.events.size).toBe(2);
	});
});
