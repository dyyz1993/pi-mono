import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type Context, fauxAssistantMessage } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "../../../extensions/coordinator/handler.js";
import type { DelegatedTask } from "../../../extensions/coordinator/types.js";
import type { ExtensionAPI } from "../../../src/index.js";
import { createHarness } from "../harness.js";

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

type SessionEventRecord = {
	type: string;
	timestamp: number;
	detail?: string;
};

function createCoordinatorLifecycleExtension(
	sessionDir: string,
	eventLog: SessionEventRecord[],
	initialTasks: DelegatedTask[] = [],
): (pi: ExtensionAPI) => void {
	const store = new TaskStore(sessionDir);
	for (const task of initialTasks) {
		store.add(task);
	}

	return (pi: ExtensionAPI) => {
		pi.on("session_start", (_event, _ctx) => {
			eventLog.push({ type: "session_start", timestamp: Date.now() });
		});

		pi.on("context", (event, _ctx) => {
			eventLog.push({ type: "context", timestamp: Date.now() });
			const prompt = store.buildPrompt();
			if (prompt) {
				event.messages.push({
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				});
			}
		});

		pi.on("agent_end", (_event, _ctx) => {
			eventLog.push({ type: "agent_end", timestamp: Date.now() });
		});

		pi.on("session_shutdown", (_event, _ctx) => {
			eventLog.push({ type: "session_shutdown", timestamp: Date.now() });
		});
	};
}

function extractInjectedText(messages: Context["messages"]): string {
	return messages
		.filter((m) => m.role === "user")
		.map((m) => {
			if (typeof m.content === "string") return m.content;
			if (Array.isArray(m.content)) {
				return m.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("\n");
			}
			return "";
		})
		.join("\n");
}

describe("coordinator RPC lifecycle: event gap verification", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs) {
			if (fs.existsSync(dir)) {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}
		tempDirs.length = 0;
	});

	it("context event injects ALL tasks including stopped ones (by design, for re-activation)", async () => {
		const sessionDir = path.join(os.tmpdir(), `coord-lifecycle-1-${Date.now()}`);
		fs.mkdirSync(sessionDir, { recursive: true });
		tempDirs.push(sessionDir);

		const stoppedTask = makeTask({
			sessionId: "sess-stopped-001",
			title: "Stopped task visible by design",
			status: "stopped",
		});
		const activeTask = makeTask({
			sessionId: "sess-active-001",
			title: "Active task that should appear",
			status: "idle",
		});

		const eventLog: SessionEventRecord[] = [];

		const harness = await createHarness({
			extensionFactories: [createCoordinatorLifecycleExtension(sessionDir, eventLog, [stoppedTask, activeTask])],
		});

		const capturedContexts: Context[] = [];
		harness.setResponses([
			(ctx: Context) => {
				capturedContexts.push(ctx);
				return fauxAssistantMessage("first response");
			},
		]);

		await harness.session.prompt("do something");
		harness.cleanup();

		const eventTypes = eventLog.map((e) => e.type);

		expect(eventTypes).toContain("context");
		expect(eventTypes).toContain("agent_end");

		const contextIdx = eventTypes.indexOf("context");
		const agentEndIdx = eventTypes.indexOf("agent_end");
		expect(contextIdx).toBeLessThan(agentEndIdx);

		expect(capturedContexts.length).toBeGreaterThanOrEqual(1);
		const injectedText = extractInjectedText(capturedContexts[0].messages);

		expect(injectedText).toContain("Stopped task visible by design");
		expect(injectedText).toContain("STOPPED");
		expect(injectedText).toContain("Active task that should appear");
	});

	it("stopped tasks persist across multiple LLM turns without cleanup", async () => {
		const sessionDir = path.join(os.tmpdir(), `coord-lifecycle-2-${Date.now()}`);
		fs.mkdirSync(sessionDir, { recursive: true });
		tempDirs.push(sessionDir);

		const task = makeTask({
			sessionId: "sess-stale-across-turns",
			title: "Persistent cross-turn task",
			status: "stopped",
		});

		const eventLog: SessionEventRecord[] = [];

		const harness = await createHarness({
			extensionFactories: [createCoordinatorLifecycleExtension(sessionDir, eventLog, [task])],
		});

		const capturedContexts: Context[] = [];
		harness.setResponses([
			(ctx: Context) => {
				capturedContexts.push(ctx);
				return fauxAssistantMessage("turn 1 done");
			},
			(ctx: Context) => {
				capturedContexts.push(ctx);
				return fauxAssistantMessage("turn 2 done");
			},
		]);

		await harness.session.prompt("first prompt");
		await harness.session.agent.waitForIdle();

		await harness.session.prompt("second prompt");
		await harness.session.agent.waitForIdle();

		harness.cleanup();

		const contextEvents = eventLog.filter((e) => e.type === "context");
		expect(contextEvents.length).toBeGreaterThanOrEqual(2);

		expect(capturedContexts.length).toBeGreaterThanOrEqual(2);

		const turn1Text = extractInjectedText(capturedContexts[0].messages);
		const turn2Text = extractInjectedText(capturedContexts[1].messages);

		expect(turn1Text).toContain("Persistent cross-turn task");
		expect(turn1Text).toContain("STOPPED");

		expect(turn2Text).toContain("Persistent cross-turn task");
		expect(turn2Text).toContain("STOPPED");
	});

	it("BUG: TaskStore.remove() exists but is never called - tasks accumulate in JSON", async () => {
		const sessionDir = path.join(os.tmpdir(), `coord-lifecycle-3-${Date.now()}`);
		fs.mkdirSync(sessionDir, { recursive: true });
		tempDirs.push(sessionDir);

		const store = new TaskStore(sessionDir);

		store.add(makeTask({ sessionId: "sess-1", title: "Task 1", status: "idle" }));
		store.add(makeTask({ sessionId: "sess-2", title: "Task 2", status: "idle" }));
		store.update("sess-1", { status: "stopped" });
		store.update("sess-2", { status: "completed", completedAt: Date.now() });

		const allTasks = store.list();
		expect(allTasks.length).toBe(2);

		const prompt = store.buildPrompt();
		expect(prompt).toContain("STOPPED");
		expect(prompt).toContain("DONE");

		const raw = JSON.parse(fs.readFileSync(path.join(sessionDir, "coordinator-tasks.json"), "utf-8"));
		expect(raw.length).toBe(2);
		expect(raw.find((t: DelegatedTask) => t.sessionId === "sess-1").status).toBe("stopped");
		expect(raw.find((t: DelegatedTask) => t.sessionId === "sess-2").status).toBe("completed");

		store.add(makeTask({ sessionId: "sess-3", title: "Task 3", status: "idle" }));
		const updatedRaw = JSON.parse(fs.readFileSync(path.join(sessionDir, "coordinator-tasks.json"), "utf-8"));
		expect(updatedRaw.length).toBe(3);
	});

	it("session_shutdown event is available but coordinator does not clean up tasks", async () => {
		const sessionDir = path.join(os.tmpdir(), `coord-lifecycle-4-${Date.now()}`);
		fs.mkdirSync(sessionDir, { recursive: true });
		tempDirs.push(sessionDir);

		const task = makeTask({
			sessionId: "sess-pre-shutdown",
			title: "Task before shutdown",
			status: "stopped",
		});

		const store = new TaskStore(sessionDir);
		store.add(task);

		const preShutdownTasks = store.list();
		expect(preShutdownTasks.length).toBe(1);

		const fileExistsPreShutdown = fs.existsSync(path.join(sessionDir, "coordinator-tasks.json"));
		expect(fileExistsPreShutdown).toBe(true);

		const promptBeforeShutdown = store.buildPrompt();
		expect(promptBeforeShutdown).toContain("Task before shutdown");
		expect(promptBeforeShutdown).toContain("STOPPED");

		const storeAfterReload = new TaskStore(sessionDir);
		const tasksAfterReload = storeAfterReload.list();
		expect(tasksAfterReload.length).toBe(1);
		expect(tasksAfterReload[0].sessionId).toBe("sess-pre-shutdown");
		expect(tasksAfterReload[0].status).toBe("stopped");

		const promptAfterReload = storeAfterReload.buildPrompt();
		expect(promptAfterReload).toContain("Task before shutdown");
		expect(promptAfterReload).toContain("STOPPED");
	});

	it("buildPrompt includes tasks with ALL statuses without filtering", async () => {
		const sessionDir = path.join(os.tmpdir(), `coord-lifecycle-5-${Date.now()}`);
		fs.mkdirSync(sessionDir, { recursive: true });
		tempDirs.push(sessionDir);

		const store = new TaskStore(sessionDir);

		store.add(makeTask({ sessionId: "s-idle", title: "Idle Task", status: "idle" }));
		store.add(makeTask({ sessionId: "s-streaming", title: "Streaming Task", status: "streaming" }));
		store.add(makeTask({ sessionId: "s-stopped", title: "Stopped Task", status: "stopped" }));
		store.add(
			makeTask({ sessionId: "s-completed", title: "Completed Task", status: "completed", completedAt: Date.now() }),
		);

		const prompt = store.buildPrompt();

		expect(prompt).toContain("Idle Task");
		expect(prompt).toContain("Streaming Task");
		expect(prompt).toContain("Stopped Task");
		expect(prompt).toContain("Completed Task");

		expect(prompt).toContain("DONE");
		expect(prompt).toContain("STOPPED");
		expect(prompt).toContain("IDLE");
		expect(prompt).toContain("STREAMING");
	});
});
