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

describe("coordinator missing cleanup mechanism - definitive bug verification", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			if (fs.existsSync(dir)) {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}
		tempDirs.length = 0;
	});

	describe("a) no removal tool exists", () => {
		it("no session_delegate_remove or session_delegate_cleanup tool is registered", () => {
			const captured = inspectCoordinatorRegistration();

			const removalToolNames = [
				"session_delegate_remove",
				"session_delegate_cleanup",
				"session_delegate_forget",
				"session_delegate_delete",
				"session_delegate_archive",
			];

			for (const name of removalToolNames) {
				expect(
					captured.tools.has(name),
					`BUG: No tool "${name}" registered. Available: ${Array.from(captured.tools).join(", ")}`,
				).toBe(false);
			}
		});

		it("all registered tools are delegation-only, none perform cleanup", () => {
			const captured = inspectCoordinatorRegistration();

			const expectedTools = [
				"session_delegate",
				"session_delegate_send",
				"session_delegate_status",
				"session_delegate_stop",
				"session_delegate_fork",
			];

			for (const name of expectedTools) {
				expect(captured.tools.has(name)).toBe(true);
			}

			expect(captured.tools.size).toBe(expectedTools.length);
		});

		it("session_delegate_stop is the closest to cleanup but only sets status=stopped", () => {
			const indexSource = fs.readFileSync(path.join(__dirname, "../../../extensions/coordinator/index.ts"), "utf-8");

			const stopToolMatch = indexSource.match(
				/name:\s*"session_delegate_stop"[\s\S]*?async execute[\s\S]*?\{([\s\S]*?)\n\t\t\}/,
			);
			expect(stopToolMatch).not.toBeNull();

			const stopBody = stopToolMatch![1];

			expect(stopBody.includes(".remove("), "BUG: session_delegate_stop does not call store.remove()").toBe(false);

			expect(stopBody.includes('status: "stopped"'), "session_delegate_stop only sets status=stopped").toBe(true);
		});
	});

	describe("b) no removal command exists", () => {
		it("no /coordinator-cleanup or similar command is registered", () => {
			const captured = inspectCoordinatorRegistration();

			expect(captured.commands.size).toBe(0);

			const indexSource = fs.readFileSync(path.join(__dirname, "../../../extensions/coordinator/index.ts"), "utf-8");

			expect(
				indexSource.includes("registerCommand"),
				"BUG: coordinator extension never calls registerCommand()",
			).toBe(false);
		});
	});

	describe("c) task accumulation simulation", () => {
		it("after stopping all 10 tasks, all 10 still appear in buildPrompt()", () => {
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

			expect(store.list().length).toBe(10);

			const prompt = store.buildPrompt();
			for (let i = 0; i < 10; i++) {
				expect(prompt).toContain(`Task ${i}`);
			}
		});

		it("there is NO API call sequence that can reduce the task count", () => {
			const tempDir = path.join(os.tmpdir(), `coord-no-reduce-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const store = new TaskStore(tempDir);
			store.add(makeTask({ sessionId: "sess-1" }));
			store.add(makeTask({ sessionId: "sess-2" }));

			store.update("sess-1", { status: "stopped" });
			store.update("sess-2", { status: "completed", completedAt: Date.now() });

			expect(store.list().length).toBe(2);

			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);

			const handlerBodies: string[] = [];
			const handlePattern = /channel\.handle\("([^"]+)",\s*async\s*\([^)]*\)\s*=>\s*\{/g;
			for (const match of handlerSource.matchAll(handlePattern)) {
				const startIdx = match.index + match[0].length;
				let braceCount = 1;
				let endIdx = startIdx;
				while (braceCount > 0 && endIdx < handlerSource.length) {
					if (handlerSource[endIdx] === "{") braceCount++;
					else if (handlerSource[endIdx] === "}") braceCount--;
					endIdx++;
				}
				handlerBodies.push(handlerSource.slice(startIdx, endIdx));
			}

			for (const body of handlerBodies) {
				expect(body.includes(".remove("), "BUG: No channel handler calls store.remove()").toBe(false);
			}
		});
	});

	describe("d) ghost session detection missing", () => {
		it("task referencing nonexistent session still appears in buildPrompt()", () => {
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

			const prompt = store.buildPrompt();
			expect(prompt).toContain("ghost-session-nonexistent-999");
			expect(prompt).toContain("Ghost task");
		});

		it("there is no mechanism to detect and clean ghost tasks", () => {
			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);

			const indexSource = fs.readFileSync(path.join(__dirname, "../../../extensions/coordinator/index.ts"), "utf-8");

			const hasSessionValidation =
				handlerSource.includes("sessionExists") ||
				handlerSource.includes("validateSession") ||
				handlerSource.includes("sessionManager.getSession") ||
				handlerSource.includes("checkSession");
			expect(hasSessionValidation, "BUG: No session existence validation in handler.ts").toBe(false);

			const hasIndexSessionValidation =
				indexSource.includes("sessionExists") ||
				indexSource.includes("validateSession") ||
				indexSource.includes("ghostSession") ||
				indexSource.includes("orphanTask");
			expect(hasIndexSessionValidation, "BUG: No session existence validation in index.ts").toBe(false);
		});

		it("buildPrompt has no guard against invalid session references", () => {
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

			const hasValidation =
				buildPromptBody.includes("sessionExists") ||
				buildPromptBody.includes("validate") ||
				buildPromptBody.includes("filter") ||
				buildPromptBody.includes("verify");
			expect(hasValidation, "BUG: buildPrompt() has no session validation or filtering").toBe(false);
		});
	});

	describe("e) no context-pressure eviction", () => {
		it("buildPrompt() blindly includes everything with no size limit", () => {
			const tempDir = path.join(os.tmpdir(), `coord-nolimit-${Date.now()}`);
			fs.mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const store = new TaskStore(tempDir);

			for (let i = 0; i < 50; i++) {
				store.add(
					makeTask({
						sessionId: `sess-bulk-${i}`,
						title: `Bulk task ${i} with a somewhat long description to increase token count`,
						task: `This is a detailed task description for task ${i} that would consume context window tokens`.repeat(
							3,
						),
						status: i % 2 === 0 ? "completed" : "stopped",
						completedAt: i % 2 === 0 ? Date.now() : undefined,
						result: i % 2 === 0 ? `Result of task ${i}: `.repeat(10) : undefined,
					}),
				);
			}

			const prompt = store.buildPrompt();
			expect(prompt.length).toBeGreaterThan(1000);

			for (let i = 0; i < 50; i++) {
				expect(prompt).toContain(`Bulk task ${i}`);
			}
		});

		it("no prioritization or eviction logic exists anywhere in the codebase", () => {
			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);

			const indexSource = fs.readFileSync(path.join(__dirname, "../../../extensions/coordinator/index.ts"), "utf-8");

			const combined = handlerSource + indexSource;

			const evictionKeywords = [
				"maxTasks",
				"evict",
				"priority",
				"prune",
				"trim",
				"tokenLimit",
				"budget",
				"taskBudget",
			];

			for (const keyword of evictionKeywords) {
				expect(combined.includes(keyword), `BUG: No "${keyword}" logic found in coordinator source`).toBe(false);
			}
		});
	});

	describe("f) store.remove() gap analysis - the smoking gun", () => {
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

		it("BUG: NO channel.handle() handler calls remove()", () => {
			const handlerSource = fs.readFileSync(
				path.join(__dirname, "../../../extensions/coordinator/handler.ts"),
				"utf-8",
			);

			const handlerNames: string[] = [];
			const handlePattern = /channel\.handle\("([^"]+)"/g;
			for (const match of handlerSource.matchAll(handlePattern)) {
				handlerNames.push(match[1]);
			}

			expect(handlerNames).toContain("session_delegate");
			expect(handlerNames).toContain("session_delegate_send");
			expect(handlerNames).toContain("session_delegate_status");
			expect(handlerNames).toContain("session_delegate_list");
			expect(handlerNames).toContain("session_delegate_stop");
			expect(handlerNames).toContain("session_delegate_fork");

			for (const name of handlerNames) {
				const handlerStart = handlerSource.indexOf(`channel.handle("${name}"`);
				const arrowStart = handlerSource.indexOf("=>", handlerStart);
				const bodyStart = handlerSource.indexOf("{", arrowStart);
				let braceCount = 1;
				let endIdx = bodyStart + 1;
				while (braceCount > 0 && endIdx < handlerSource.length) {
					if (handlerSource[endIdx] === "{") braceCount++;
					else if (handlerSource[endIdx] === "}") braceCount--;
					endIdx++;
				}
				const body = handlerSource.slice(bodyStart, endIdx);

				expect(body.includes(".remove("), `BUG: channel.handle("${name}") does not call store.remove()`).toBe(
					false,
				);
			}
		});

		it("BUG: NO pi.registerTool() calls remove() in its execute body", () => {
			const indexSource = fs.readFileSync(path.join(__dirname, "../../../extensions/coordinator/index.ts"), "utf-8");

			const toolNames: string[] = [];
			const toolPattern = /pi\.registerTool\(\{[^}]*name:\s*"([^"]+)"/g;
			for (const match of indexSource.matchAll(toolPattern)) {
				toolNames.push(match[1]);
			}

			for (const name of toolNames) {
				const toolStart = indexSource.indexOf(`name: "${name}"`);
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
					`BUG: pi.registerTool("${name}") execute() does not call store.remove()`,
				).toBe(false);
			}
		});

		it("BUG: NO pi.registerCommand() exists to expose remove to user", () => {
			const indexSource = fs.readFileSync(path.join(__dirname, "../../../extensions/coordinator/index.ts"), "utf-8");

			expect(
				indexSource.includes("registerCommand"),
				"BUG: coordinator extension never calls registerCommand()",
			).toBe(false);
		});
	});
});
