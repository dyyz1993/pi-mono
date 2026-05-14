import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DelegatedTask } from "./types.js";
import { TaskStore } from "./handler.js";

function makeTask(overrides: Partial<DelegatedTask> = {}): DelegatedTask {
	return {
		sessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		title: "Test task",
		task: "Do something useful",
		projectPath: "/tmp/test",
		dispatchedAt: Date.now(),
		status: "idle",
		...overrides,
	};
}

describe("TaskStore.buildPrompt()", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("includes stopped tasks in prompt (by design, for re-activation)", () => {
		tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const store = new TaskStore(tempDir);
		const task = makeTask({ title: "Re-activatable task", sessionId: "sess-stopped-1" });
		store.add(task);
		store.update("sess-stopped-1", { status: "stopped" });

		const prompt = store.buildPrompt();

		expect(prompt).toContain("Re-activatable task");
		expect(prompt).toContain("STOPPED");
	});

	it("includes completed tasks in prompt (by design, for re-activation)", () => {
		tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const store = new TaskStore(tempDir);
		const task = makeTask({
			title: "Completed task still visible",
			sessionId: "sess-completed-1",
			status: "completed",
			completedAt: Date.now(),
			result: "Did the thing",
		});
		store.add(task);

		const prompt = store.buildPrompt();

		expect(prompt).toContain("Completed task still visible");
		expect(prompt).toContain("DONE");
	});

	it("persists tasks across restarts and buildPrompt includes them all", () => {
		tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const store1 = new TaskStore(tempDir);
		store1.add(makeTask({ title: "Task A", sessionId: "sess-a" }));
		store1.add(makeTask({ title: "Task B", sessionId: "sess-b", status: "completed", completedAt: Date.now() }));

		const store2 = new TaskStore(tempDir);
		const prompt = store2.buildPrompt();

		expect(prompt).toContain("Task A");
		expect(prompt).toContain("Task B");
		expect(prompt).toContain("DONE");
	});

	it("store.remove() exists and works when called directly", () => {
		tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const store = new TaskStore(tempDir);
		store.add(makeTask({ sessionId: "sess-removable", title: "Can be removed" }));
		expect(store.get("sess-removable")).toBeDefined();

		store.remove("sess-removable");

		expect(store.get("sess-removable")).toBeUndefined();
		expect(store.buildPrompt()).toBe("");
	});

	it("BUG: store.remove() is never called by any channel handler or tool", () => {
		tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const handlerSource = fs.readFileSync(
			path.join(__dirname, "handler.ts"),
			"utf-8",
		);

		const indexSource = fs.readFileSync(
			path.join(__dirname, "index.ts"),
			"utf-8",
		);

		expect(
			handlerSource.includes("remove("),
			"TaskStore.remove() method exists in handler.ts",
		).toBe(true);

		const handlerBodies: string[] = [];
		const handlePattern = /channel\.handle\("([^"]+)",\s*async\s*\([^)]*\)\s*=>\s*\{/g;
		let match;
		while ((match = handlePattern.exec(handlerSource)) !== null) {
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
			expect(
				body.includes("remove("),
				"No channel.handle() body should call remove()",
			).toBe(false);
		}

		expect(
			indexSource.includes(".remove("),
			"BUG: index.ts never calls store.remove() - no tool/command exposes removal",
		).toBe(false);
	});

	it("session_delegate_stop only sets status=stopped, does not remove task", () => {
		tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const store = new TaskStore(tempDir);
		store.add(makeTask({ sessionId: "sess-stop-test", title: "Accumulated task" }));
		store.update("sess-stop-test", { status: "stopped" });

		const task = store.get("sess-stop-test");
		expect(task).toBeDefined();
		expect(task?.status).toBe("stopped");

		const prompt = store.buildPrompt();
		expect(prompt).toContain("Accumulated task");
		expect(prompt).toContain("STOPPED");
	});

	it("BUG: no tool or command exposes remove functionality to LLM or user", () => {
		const indexSource = fs.readFileSync(
			path.join(__dirname, "index.ts"),
			"utf-8",
		);

		const registeredTools: string[] = [];
		const toolPattern = /pi\.registerTool\(\{[^}]*name:\s*"([^"]+)"/g;
		let match;
		while ((match = toolPattern.exec(indexSource)) !== null) {
			registeredTools.push(match[1]);
		}

		const registeredCommands: string[] = [];
		const cmdPattern = /pi\.registerCommand\(\s*"([^"]+)"/g;
		while ((match = cmdPattern.exec(indexSource)) !== null) {
			registeredCommands.push(match[1]);
		}

		const removalToolNames = [
			"session_delegate_remove",
			"session_delegate_cleanup",
			"session_delegate_forget",
			"session_delegate_delete",
		];

		for (const name of removalToolNames) {
			expect(
				registeredTools.includes(name),
				`BUG: No tool named "${name}" is registered`,
			).toBe(false);
		}

		const removalCmdPatterns = [
			"coordinator-cleanup",
			"coordinator-remove",
			"coordinator-forget",
			"coordinator-clear",
		];

		for (const name of removalCmdPatterns) {
			expect(
				registeredCommands.includes(name),
				`BUG: No command named "${name}" is registered`,
			).toBe(false);
		}
	});

	it("BUG: no automatic cleanup of tasks whose sessions no longer exist", () => {
		tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const store = new TaskStore(tempDir);
		store.add(makeTask({
			sessionId: "ghost-session-999",
			title: "Ghost task",
			status: "idle",
		}));

		const prompt = store.buildPrompt();
		expect(prompt).toContain("ghost-session-999");
		expect(prompt).toContain("Ghost task");

		expect(store.list().length).toBe(1);
	});

	it("BUG: no age-based or context-pressure-based cleanup mechanism", () => {
		tempDir = path.join(os.tmpdir(), `coordinator-test-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const store = new TaskStore(tempDir);
		const oldTimestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;

		for (let i = 0; i < 20; i++) {
			store.add(makeTask({
				sessionId: `sess-old-${i}`,
				title: `Old task ${i}`,
				dispatchedAt: oldTimestamp + i * 1000,
				status: "completed",
				completedAt: oldTimestamp + i * 1000 + 5000,
			}));
		}

		const allTasks = store.list();
		expect(allTasks.length).toBe(20);

		const prompt = store.buildPrompt();
		for (let i = 0; i < 20; i++) {
			expect(prompt).toContain(`Old task ${i}`);
		}

		const handlerSource = fs.readFileSync(
			path.join(__dirname, "handler.ts"),
			"utf-8",
		);

		const hasMaxAgeLogic = handlerSource.includes("maxAge") ||
			handlerSource.includes("ttl") ||
			handlerSource.includes("expiry") ||
			handlerSource.includes("staleThreshold") ||
			handlerSource.includes("cleanupInterval");
		expect(
			hasMaxAgeLogic,
			"BUG: No age-based cleanup logic (maxAge/ttl/expiry) in handler.ts",
		).toBe(false);

		const indexSource = fs.readFileSync(
			path.join(__dirname, "index.ts"),
			"utf-8",
		);
		const hasContextEviction = indexSource.includes("contextPressure") ||
			indexSource.includes("evict") ||
			indexSource.includes("tokenBudget") ||
			indexSource.includes("maxContextTasks");
		expect(
			hasContextEviction,
			"BUG: No context-pressure-based eviction logic in index.ts",
		).toBe(false);
	});
});
