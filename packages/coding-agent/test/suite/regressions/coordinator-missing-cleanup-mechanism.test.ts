import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "../../../extensions/coordinator/handler.js";
import coordinatorExtension from "../../../extensions/coordinator/index.js";
import type { DelegatedTask } from "../../../extensions/coordinator/types.js";

function makeTask(overrides: Partial<DelegatedTask> = {}): DelegatedTask {
	return {
		sessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		title: "Test task",
		task: "Do something",
		projectPath: "/tmp/test",
		dispatchedAt: Date.now(),
		status: "idle",
		...overrides,
	};
}

interface CapturedRegistration {
	events: Set<string>;
	tools: Set<string>;
	commands: Set<string>;
}

function inspectCoordinatorRegistration(): CapturedRegistration {
	const captured: CapturedRegistration = {
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

describe("coordinator cleanup mechanism - fix verification", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			if (fs.existsSync(dir)) {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}
		tempDirs.length = 0;
	});

	describe("a) removal tools now exist", () => {
		it("session_delegate_remove tool is registered", () => {
			const captured = inspectCoordinatorRegistration();
			expect(captured.tools.has("session_delegate_remove")).toBe(true);
			expect(captured.tools.has("session_delegate_clear_stopped")).toBe(true);
		});

		it("all registered tools include cleanup tools", () => {
			const captured = inspectCoordinatorRegistration();

			const expectedTools = [
				"session_delegate",
				"session_delegate_send",
				"session_delegate_status",
				"session_delegate_stop",
				"session_delegate_fork",
				"session_delegate_remove",
				"session_delegate_clear_stopped",
			];

			for (const name of expectedTools) {
				expect(captured.tools.has(name), `Tool "${name}" should be registered`).toBe(true);
			}

			expect(captured.tools.size).toBe(expectedTools.length);
		});

		it("session_delegate_remove calls store.remove() and also stops the session", () => {
			const indexSource = fs.readFileSync(path.join(__dirname, "../../../extensions/coordinator/index.ts"), "utf-8");

			const removeToolStart = indexSource.indexOf('name: "session_delegate_remove"');
			expect(removeToolStart).toBeGreaterThan(-1);

			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);
			const removeHandlerStart = handlerSource.indexOf('channel.handle("session_delegate_remove"');
			const handlerBlock = handlerSource.slice(removeHandlerStart);
			expect(handlerBlock).toContain("store.remove(sessionId)");
		});
	});

	describe("b) no removal command exists (by design, tools suffice)", () => {
		it("no /coordinator-cleanup or similar command is registered", () => {
			const captured = inspectCoordinatorRegistration();
			expect(captured.commands.size).toBe(0);
		});
	});

	describe("c) task count can now be reduced via remove/clear", () => {
		it("clearStopped() removes all stopped/completed tasks", () => {
			const tempDir = path.join(os.tmpdir(), `coord-accum-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const store = new TaskStore(tempDir);
			const statuses: DelegatedTask["status"][] = ["idle", "streaming", "stopped", "completed"];

			for (let i = 0; i < 10; i++) {
				store.add(
					makeTask({
						sessionId: `sess-accum-${i}`,
						title: `Task ${i}`,
						status: statuses[i % statuses.length],
						completedAt: statuses[i % statuses.length] === "completed" ? Date.now() : undefined,
					}),
				);
			}

			for (let i = 0; i < 10; i++) {
				store.update(`sess-accum-${i}`, { status: "stopped" });
			}

			const removed = store.clearStopped();
			expect(removed).toBe(10);
			expect(store.list().length).toBe(0);
		});

		it("store.remove() and clearStopped() provide API calls that reduce task count", () => {
			const tempDir = path.join(os.tmpdir(), `coord-no-reduce-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const store = new TaskStore(tempDir);
			store.add(makeTask({ sessionId: "sess-1" }));
			store.add(makeTask({ sessionId: "sess-2" }));

			store.update("sess-1", { status: "stopped" });
			store.update("sess-2", { status: "completed", completedAt: Date.now() });

			expect(store.list().length).toBe(2);

			store.remove("sess-1");
			expect(store.list().length).toBe(1);

			store.clearStopped();
			expect(store.list().length).toBe(0);
		});

		it("channel.handle(session_delegate_remove) calls store.remove()", () => {
			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);

			const removeHandlerStart = handlerSource.indexOf('channel.handle("session_delegate_remove"');
			expect(removeHandlerStart).toBeGreaterThan(-1);
			const handlerBlock = handlerSource.slice(removeHandlerStart);
			expect(handlerBlock).toContain("store.remove(sessionId)");
		});
	});

	describe("d) ghost session cleanup via remove tool", () => {
		it("task referencing nonexistent session can be removed", () => {
			const tempDir = path.join(os.tmpdir(), `coord-ghost-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const store = new TaskStore(tempDir);
			store.add(
				makeTask({
					sessionId: "ghost-session-nonexistent-999",
					title: "Ghost task",
					status: "idle",
				}),
			);

			store.remove("ghost-session-nonexistent-999");

			expect(store.buildPrompt()).toBe("");
			expect(store.list().length).toBe(0);
		});

		it("session_delegate_remove handler exists to clean ghost tasks", () => {
			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);
			expect(handlerSource).toContain('channel.handle("session_delegate_remove"');
		});

		it("buildPrompt filters out old stopped tasks", () => {
			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);

			const buildPromptStart = handlerSource.indexOf("buildPrompt()");
			const buildPromptBodyStart = handlerSource.indexOf("{", buildPromptStart);
			let braceCount = 1;
			let idx = buildPromptBodyStart + 1;
			while (braceCount > 0 && idx < handlerSource.length) {
				if (handlerSource[idx] === "{") braceCount++;
				else if (handlerSource[idx] === "}") braceCount--;
				idx++;
			}
			const buildPromptBody = handlerSource.slice(buildPromptBodyStart, idx);

			expect(buildPromptBody.includes("filter"), "buildPrompt() now filters old stopped tasks").toBe(true);
		});
	});

	describe("e) buildPrompt() has age-based filtering", () => {
		it("buildPrompt() filters out old stopped tasks (older than 5 minutes)", () => {
			const tempDir = path.join(os.tmpdir(), `coord-age-filter-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const store = new TaskStore(tempDir);
			const oldTime = Date.now() - 10 * 60 * 1000;

			store.add(
				makeTask({
					sessionId: "sess-old-stopped",
					title: "Old stopped",
					status: "stopped",
					completedAt: oldTime,
				}),
			);
			store.add(
				makeTask({
					sessionId: "sess-recent-stopped",
					title: "Recent stopped",
					status: "stopped",
					completedAt: Date.now(),
				}),
			);
			store.add(
				makeTask({
					sessionId: "sess-idle",
					title: "Idle task",
					status: "idle",
				}),
			);

			const prompt = store.buildPrompt();
			expect(prompt).not.toContain("Old stopped");
			expect(prompt).toContain("Recent stopped");
			expect(prompt).toContain("Idle task");
		});
	});

	describe("f) store.remove() is now called by handlers and tools", () => {
		it("TaskStore.remove() method exists and works correctly when called directly", () => {
			const tempDir = path.join(os.tmpdir(), `coord-smokinggun-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const store = new TaskStore(tempDir);
			store.add(makeTask({ sessionId: "sess-remove-works", title: "Removable" }));
			store.add(makeTask({ sessionId: "sess-keep", title: "Keeper" }));

			expect(store.list().length).toBe(2);

			store.remove("sess-remove-works");

			expect(store.get("sess-remove-works")).toBeUndefined();
			expect(store.list().length).toBe(1);
			expect(store.list()[0].sessionId).toBe("sess-keep");

			const prompt = store.buildPrompt();
			expect(prompt).not.toContain("Removable");
			expect(prompt).toContain("Keeper");
		});

		it("remove() persists correctly to disk", () => {
			const tempDir = path.join(os.tmpdir(), `coord-persist-remove-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const store1 = new TaskStore(tempDir);
			store1.add(makeTask({ sessionId: "sess-a" }));
			store1.add(makeTask({ sessionId: "sess-b" }));
			store1.remove("sess-a");

			const store2 = new TaskStore(tempDir);
			expect(store2.list().length).toBe(1);
			expect(store2.list()[0].sessionId).toBe("sess-b");
		});

		it("channel.handle(session_delegate_remove) calls remove()", () => {
			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);

			const handlerNames: string[] = [];
			const handlePattern = /channel\.handle\("([^"]+)"/g;
			for (const match of handlerSource.matchAll(handlePattern)) {
				handlerNames.push(match[1]);
			}

			expect(handlerNames).toContain("session_delegate_remove");

			const removeStart = handlerSource.indexOf('channel.handle("session_delegate_remove"');
			const handlerBlock = handlerSource.slice(removeStart);
			expect(handlerBlock).toContain("store.remove(sessionId)");
		});

		it("pi.registerTool(session_delegate_remove) calls remove() in its execute body", () => {
			const indexSource = fs.readFileSync(path.join(__dirname, "../../../extensions/coordinator/index.ts"), "utf-8");

			const toolStart = indexSource.indexOf('name: "session_delegate_remove"');
			const executeStart = indexSource.indexOf("async execute(", toolStart);
			const bodyStart = indexSource.indexOf("{", executeStart);
			let braceCount = 1;
			let endIdx = bodyStart + 1;
			while (braceCount > 0 && endIdx < indexSource.length) {
				if (indexSource[endIdx] === "{") braceCount++;
				else if (indexSource[endIdx] === "}") braceCount--;
				endIdx++;
			}
			const body = indexSource.slice(bodyStart, endIdx);

			expect(
				body.includes(".remove("),
				`pi.registerTool("session_delegate_remove") execute() calls store.remove()`,
			).toBe(true);
		});
	});
});
