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

function createCoordinatorLikeExtension(tempDir: string, tasks: DelegatedTask[]): (pi: ExtensionAPI) => void {
	const store = new TaskStore(tempDir);
	for (const task of tasks) {
		store.add(task);
	}

	return (pi: ExtensionAPI) => {
		pi.on("context", (event) => {
			const prompt = store.buildPrompt();
			if (prompt) {
				event.messages.push({
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				});
			}
		});
	};
}

function extractAllUserText(context: Context): string {
	return context.messages
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

describe("coordinator missing cleanup mechanism", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
	});

	it("includes stopped tasks in context (by design, tasks are long-lived for re-activation)", async () => {
		const tempDir = path.join(os.tmpdir(), `coordinator-regression-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const stoppedTask = makeTask({
			sessionId: "sess-stopped-design",
			title: "Stopped but re-activatable task",
			status: "stopped",
		});

		const capturedContexts: Context[] = [];

		const harness = await createHarness({
			extensionFactories: [createCoordinatorLikeExtension(tempDir, [stoppedTask])],
		});

		cleanups.push(() => {
			harness.cleanup();
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});

		harness.setResponses([
			(context: Context) => {
				capturedContexts.push(context);
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("do something");

		expect(capturedContexts.length).toBeGreaterThanOrEqual(1);
		const allUserText = extractAllUserText(capturedContexts[0]);

		expect(allUserText).toContain("Stopped but re-activatable task");
		expect(allUserText).toContain("STOPPED");
	});

	it("includes completed tasks in context (by design, for historical reference)", async () => {
		const tempDir = path.join(os.tmpdir(), `coordinator-regression-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const completedTask = makeTask({
			sessionId: "sess-done-design",
			title: "Completed task visible by design",
			status: "completed",
			completedAt: Date.now(),
			result: "Task completed successfully",
		});

		const capturedContexts: Context[] = [];

		const harness = await createHarness({
			extensionFactories: [createCoordinatorLikeExtension(tempDir, [completedTask])],
		});

		cleanups.push(() => {
			harness.cleanup();
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});

		harness.setResponses([
			(context: Context) => {
				capturedContexts.push(context);
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("do something else");

		expect(capturedContexts.length).toBeGreaterThanOrEqual(1);
		const allUserText = extractAllUserText(capturedContexts[0]);

		expect(allUserText).toContain("Completed task visible by design");
		expect(allUserText).toContain("DONE");
	});

	it("BUG: tasks accumulate without any cleanup mechanism", async () => {
		const tempDir = path.join(os.tmpdir(), `coordinator-regression-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const tasks: DelegatedTask[] = [];
		for (let i = 0; i < 10; i++) {
			tasks.push(
				makeTask({
					sessionId: `sess-accum-${i}`,
					title: `Accumulated task ${i}`,
					status: i < 3 ? "idle" : i < 6 ? "stopped" : "completed",
					completedAt: i >= 6 ? Date.now() : undefined,
				}),
			);
		}

		const capturedContexts: Context[] = [];

		const harness = await createHarness({
			extensionFactories: [createCoordinatorLikeExtension(tempDir, tasks)],
		});

		cleanups.push(() => {
			harness.cleanup();
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});

		harness.setResponses([
			(context: Context) => {
				capturedContexts.push(context);
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("list my tasks");

		expect(capturedContexts.length).toBeGreaterThanOrEqual(1);
		const allUserText = extractAllUserText(capturedContexts[0]);

		for (let i = 0; i < 10; i++) {
			expect(allUserText).toContain(`Accumulated task ${i}`);
		}
	});

	it("BUG: ghost tasks (referencing deleted sessions) still appear in context", async () => {
		const tempDir = path.join(os.tmpdir(), `coordinator-regression-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const ghostTask = makeTask({
			sessionId: "ghost-session-nonexistent",
			title: "Ghost task for deleted session",
			status: "idle",
		});

		const capturedContexts: Context[] = [];

		const harness = await createHarness({
			extensionFactories: [createCoordinatorLikeExtension(tempDir, [ghostTask])],
		});

		cleanups.push(() => {
			harness.cleanup();
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});

		harness.setResponses([
			(context: Context) => {
				capturedContexts.push(context);
				return fauxAssistantMessage("ok");
			},
		]);

		await harness.session.prompt("check tasks");

		expect(capturedContexts.length).toBeGreaterThanOrEqual(1);
		const allUserText = extractAllUserText(capturedContexts[0]);

		expect(allUserText).toContain("ghost-session-nonexistent");
		expect(allUserText).toContain("Ghost task for deleted session");
	});

	it("BUG: stopping all tasks does not reduce the count in buildPrompt", async () => {
		const tempDir = path.join(os.tmpdir(), `coordinator-regression-${Date.now()}`);
		fs.mkdirSync(tempDir, { recursive: true });

		const store = new TaskStore(tempDir);
		for (let i = 0; i < 5; i++) {
			store.add(
				makeTask({
					sessionId: `sess-stopall-${i}`,
					title: `Task to stop ${i}`,
					status: "idle",
				}),
			);
		}

		expect(store.list().length).toBe(5);
		expect(store.buildPrompt()).toBeTruthy();

		for (let i = 0; i < 5; i++) {
			store.update(`sess-stopall-${i}`, { status: "stopped" });
		}

		expect(store.list().length).toBe(5);
		const prompt = store.buildPrompt();
		expect(prompt).toBeTruthy();
		for (let i = 0; i < 5; i++) {
			expect(prompt).toContain(`Task to stop ${i}`);
		}

		cleanups.push(() => {
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});
});
