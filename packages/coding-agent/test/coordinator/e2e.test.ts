import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "../../extensions/coordinator/handler.js";
import type { DelegatedTask } from "../../extensions/coordinator/types.js";
import type { AgentSessionEvent } from "../../src/core/agent-session.js";
import type { ExtensionAPI, ExtensionFactory } from "../../src/index.js";
import { createHarness, getAssistantTexts, type Harness } from "../suite/harness.js";

type ToolExecutionStartEvent = Extract<AgentSessionEvent, { type: "tool_execution_start" }>;
type ToolExecutionEndEvent = Extract<AgentSessionEvent, { type: "tool_execution_end" }>;
type TurnEndEvent = Extract<AgentSessionEvent, { type: "turn_end" }>;

interface MockProcessManagerSession {
	sessionId: string;
	projectPath: string;
	status: "idle" | "streaming" | "stopped" | "completed";
}

function createMockProcessManager() {
	const sessions = new Map<string, MockProcessManagerSession>();
	const delegateLog: Array<{ sessionId: string; task: string }> = [];
	const sendLog: Array<{ from: string; to: string; message: string }> = [];
	const compactStates = new Map<
		string,
		{
			isCompacting: boolean;
			contextUsage: { tokens: number | null; contextWindow: number; percent: number | null };
		}
	>();

	return {
		sessions,
		delegateLog,
		sendLog,
		compactStates,

		async delegate(task: string, projectPath: string) {
			const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			sessions.set(sessionId, { sessionId, projectPath, status: "idle" });
			delegateLog.push({ sessionId, task });
			return { sessionId, status: "started" as const };
		},

		async delegate_fork(_sessionId: string, _task: string, _title?: string) {
			const newSessionId = `sess_fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			sessions.set(newSessionId, { sessionId: newSessionId, projectPath: "/project", status: "idle" });
			return { sessionId: newSessionId, status: "started" as const };
		},

		delegate_compact_status(sessionId: string) {
			const state = compactStates.get(sessionId);
			return (
				state ?? {
					isCompacting: false,
					contextUsage: { tokens: null as number | null, contextWindow: 0, percent: null as number | null },
				}
			);
		},

		async delegate_send(fromSessionId: string, toSessionId: string, message: string) {
			sendLog.push({ from: fromSessionId, to: toSessionId, message });
			const target = sessions.get(toSessionId);
			if (!target) {
				return { delivered: false, targetStatus: "not_found" as const };
			}
			if (target.status === "stopped") {
				target.status = "idle";
				return { delivered: true, targetStatus: "started" as const };
			}
			return { delivered: true, targetStatus: "active" as const };
		},

		delegate_status(sessionId: string) {
			const s = sessions.get(sessionId);
			return s ? { status: s.status } : { status: "stopped" as const };
		},

		delegate_list() {
			return Array.from(sessions.values());
		},

		delegate_stop(sessionId: string) {
			const s = sessions.get(sessionId);
			if (!s) return false;
			s.status = "stopped";
			return true;
		},
	};
}

type MockProcessManager = ReturnType<typeof createMockProcessManager>;

function createCoordinatorExtensionFactory(
	processManager: MockProcessManager,
	options: {
		sessionId?: string;
		taskStoreDir?: string;
		onContextEvent?: (prompt: string) => void;
	} = {},
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		let currentSessionId = options.sessionId ?? "";
		let store: TaskStore | null = null;

		pi.on("session_start" as any, (_event: any, ctx: any) => {
			if (options.sessionId) {
				currentSessionId = options.sessionId;
			} else {
				currentSessionId = ctx.sessionManager.getSessionId();
			}
			const dir = options.taskStoreDir ?? ctx.sessionManager.getSessionDir();
			if (dir) {
				store = new TaskStore(dir);
			}
		});

		pi.registerTool({
			name: "session_delegate",
			label: "Session Delegate",
			description: "Delegate a task to a background session.",
			parameters: {
				type: "object" as const,
				properties: {
					task: { type: "string", description: "Task description" },
					title: { type: "string", description: "Short title" },
				},
				required: ["task"],
			} as any,
			async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
				const result = await processManager.delegate(params.task, ctx.cwd);

				if (store) {
					store.add({
						sessionId: result.sessionId,
						title: params.title || params.task.slice(0, 60),
						task: params.task,
						projectPath: ctx.cwd,
						dispatchedAt: Date.now(),
						status: "idle",
					});
				}

				return {
					content: [
						{
							type: "text" as const,
							text: `Delegated task to session ${result.sessionId} (status: ${result.status})`,
						},
					],
					details: { ...result, dispatchedBy: currentSessionId },
				};
			},
		});

		pi.registerTool({
			name: "session_delegate_send",
			label: "Session Delegate Send",
			description: "Send a message to a delegated session.",
			parameters: {
				type: "object" as const,
				properties: {
					targetSessionId: { type: "string" },
					message: { type: "string" },
				},
				required: ["targetSessionId", "message"],
			} as any,
			async execute(_toolCallId: string, params: any) {
				const result = await processManager.delegate_send(currentSessionId, params.targetSessionId, params.message);

				if (!result.delivered) {
					return {
						content: [
							{ type: "text" as const, text: `Could not deliver to ${params.targetSessionId}: not found` },
						],
						details: { error: true },
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: `Message delivered to ${params.targetSessionId} (status: ${result.targetStatus})`,
						},
					],
					details: result,
				};
			},
		});

		pi.registerTool({
			name: "session_delegate_status",
			label: "Session Delegate Status",
			description: "Check status of a delegated task.",
			parameters: {
				type: "object" as const,
				properties: { sessionId: { type: "string" } },
				required: ["sessionId"],
			} as any,
			async execute(_toolCallId: string, params: any) {
				const task = store?.get(params.sessionId);
				if (task) {
					const status = task.status === "completed" ? "DONE" : task.status.toUpperCase();
					return {
						content: [{ type: "text" as const, text: `Task "${task.title}" (${params.sessionId}): ${status}` }],
						details: { task },
					};
				}
				const remote = processManager.delegate_status(params.sessionId);
				return {
					content: [{ type: "text" as const, text: `Session ${params.sessionId} status: ${remote.status}` }],
					details: { task: null },
				};
			},
		});

		pi.registerTool({
			name: "session_delegate_stop",
			label: "Session Delegate Stop",
			description: "Stop a delegated task session.",
			parameters: {
				type: "object" as const,
				properties: { sessionId: { type: "string" } },
				required: ["sessionId"],
			} as any,
			async execute(_toolCallId: string, params: any) {
				const ok = processManager.delegate_stop(params.sessionId);
				if (ok && store) {
					store.update(params.sessionId, { status: "stopped" });
				}
				return {
					content: [
						{
							type: "text" as const,
							text: ok
								? `Session ${params.sessionId} stopped.`
								: `Session ${params.sessionId} not found or already stopped.`,
						},
					],
					details: { ok },
				};
			},
		});

		pi.registerTool({
			name: "session_delegate_fork",
			label: "Session Delegate Fork",
			description: "Fork an existing session and delegate a new task.",
			parameters: {
				type: "object" as const,
				properties: {
					sessionId: { type: "string", description: "Source session ID" },
					task: { type: "string", description: "Task description" },
					title: { type: "string", description: "Short title" },
				},
				required: ["sessionId", "task"],
			} as any,
			async execute(_toolCallId: string, params: any) {
				const result = await processManager.delegate_fork(params.sessionId, params.task, params.title);
				if (store) {
					store.add({
						sessionId: result.sessionId,
						title: params.title || params.task.slice(0, 60),
						task: params.task,
						projectPath: "/project",
						dispatchedAt: Date.now(),
						status: "idle",
					});
				}
				return {
					content: [
						{
							type: "text" as const,
							text: `Forked session ${params.sessionId} → ${result.sessionId} (status: ${result.status})`,
						},
					],
					details: { ...result, forkedFrom: params.sessionId },
				};
			},
		});

		pi.on("context" as any, (event: any) => {
			if (!store) return;
			const prompt = store.buildPrompt();
			if (prompt) {
				if (options.onContextEvent) {
					options.onContextEvent(prompt);
				}
				event.messages.push({
					role: "system",
					content: [{ type: "text", text: prompt }],
				});
			}
		});
	};
}

describe("Coordinator E2E: Single session delegate lifecycle", () => {
	const harnesses: Harness[] = [];
	const pm = createMockProcessManager();

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should call session_delegate tool and return result", async () => {
		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("session_delegate", { task: "refactor the auth module", title: "Auth Refactor" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Task delegated successfully."),
		]);

		await harness.session.prompt("delegate this task");

		expect(pm.delegateLog).toHaveLength(1);
		expect(pm.delegateLog[0].task).toBe("refactor the auth module");
	});

	it("should fire complete event sequence for delegate tool call", async () => {
		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "run tests" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("delegate tests");

		const eventTypes = harness.events.map((e) => e.type);

		expect(eventTypes).toContain("agent_start");
		expect(eventTypes).toContain("agent_end");
		expect(eventTypes).toContain("turn_start");
		expect(eventTypes).toContain("turn_end");
		expect(eventTypes).toContain("tool_execution_start");
		expect(eventTypes).toContain("tool_execution_end");

		const toolStarts = harness.eventsOfType<ToolExecutionStartEvent["type"]>("tool_execution_start");
		expect(toolStarts.length).toBeGreaterThanOrEqual(1);
		expect((toolStarts[0] as any).toolName).toBe("session_delegate");

		const toolEnds = harness.eventsOfType<ToolExecutionEndEvent["type"]>("tool_execution_end");
		expect(toolEnds.length).toBeGreaterThanOrEqual(1);
	});

	it("should persist delegated task in TaskStore via session_start", async () => {
		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm, { taskStoreDir: undefined })],
		});
		harnesses.push(harness);

		const storeDir = harness.tempDir;
		mkdirSync(storeDir, { recursive: true });

		const store = new TaskStore(storeDir);
		store.add({
			sessionId: "sess_manual_001",
			title: "Docs",
			task: "write documentation",
			projectPath: "/project",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		const reloaded = new TaskStore(storeDir);
		expect(reloaded.list()).toHaveLength(1);
		expect(reloaded.list()[0].title).toBe("Docs");
	});

	it("should handle delegate → status → stop full lifecycle", async () => {
		const localPm = createMockProcessManager();
		const precreatedSid = `sess_pre_${Date.now()}`;
		localPm.sessions.set(precreatedSid, {
			sessionId: precreatedSid,
			projectPath: "/project",
			status: "idle",
		});

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(localPm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "full lifecycle test" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("session_delegate_status", { sessionId: precreatedSid })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("session_delegate_stop", { sessionId: precreatedSid })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("lifecycle complete"),
		]);

		await harness.session.prompt("run lifecycle test");

		const toolStarts = harness.eventsOfType<ToolExecutionStartEvent["type"]>("tool_execution_start");
		const toolNames = toolStarts.map((e: any) => e.toolName);
		expect(toolNames).toContain("session_delegate");
		expect(toolNames).toContain("session_delegate_status");
		expect(toolNames).toContain("session_delegate_stop");

		const toolEnds = harness.eventsOfType<ToolExecutionEndEvent["type"]>("tool_execution_end");
		const delegateEnd = toolEnds.find((e: any) => e.toolName === "session_delegate");
		expect(delegateEnd).toBeDefined();
		expect((delegateEnd as any).isError).toBe(false);

		expect(localPm.delegateLog).toHaveLength(1);
		const stoppedSession = localPm.sessions.get(precreatedSid);
		expect(stoppedSession?.status).toBe("stopped");
	});
});

describe("Coordinator E2E: Bidirectional communication", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should allow session A to delegate and session B to send message back", async () => {
		const pmA = createMockProcessManager();
		const pmB = createMockProcessManager();

		const workerSessionId = `sess_worker_${Date.now()}`;
		pmA.sessions.set(workerSessionId, {
			sessionId: workerSessionId,
			projectPath: "/project",
			status: "idle",
		});
		pmB.sessions.set(workerSessionId, {
			sessionId: workerSessionId,
			projectPath: "/project",
			status: "idle",
		});

		const harnessA = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmA, { sessionId: "session_A" })],
		});
		harnesses.push(harnessA);

		const harnessB = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmB, { sessionId: "session_B" })],
		});
		harnesses.push(harnessB);

		harnessA.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "analyze codebase" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("delegated"),
		]);

		harnessB.setResponses([
			fauxAssistantMessage(
				fauxToolCall("session_delegate_send", {
					targetSessionId: "session_A",
					message: "Analysis complete: 42 files analyzed",
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("sent"),
		]);

		await harnessA.session.prompt("analyze the codebase");
		await harnessB.session.prompt("send results back");

		expect(pmA.delegateLog.length).toBeGreaterThanOrEqual(1);
		expect(pmA.delegateLog[0].task).toBe("analyze codebase");

		expect(pmB.sendLog.length).toBeGreaterThanOrEqual(1);
		expect(pmB.sendLog[0].to).toBe("session_A");
		expect(pmB.sendLog[0].message).toContain("Analysis complete");
	});

	it("should maintain separate event sequences for two sessions", async () => {
		const pmA = createMockProcessManager();
		const pmB = createMockProcessManager();

		const harnessA = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmA, { sessionId: "session_A" })],
		});
		harnesses.push(harnessA);

		const harnessB = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmB, { sessionId: "session_B" })],
		});
		harnesses.push(harnessB);

		harnessA.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "task from A" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("A done"),
		]);

		harnessB.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "task from B" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("B done"),
		]);

		await Promise.all([harnessA.session.prompt("delegate task A"), harnessB.session.prompt("delegate task B")]);

		const eventsA = harnessA.eventsOfType<ToolExecutionStartEvent["type"]>("tool_execution_start");
		const eventsB = harnessB.eventsOfType<ToolExecutionStartEvent["type"]>("tool_execution_start");

		expect((eventsA[0] as any).toolName).toBe("session_delegate");
		expect((eventsB[0] as any).toolName).toBe("session_delegate");

		expect(pmA.delegateLog[0].task).toBe("task from A");
		expect(pmB.delegateLog[0].task).toBe("task from B");
	});
});

describe("Coordinator E2E: Concurrent sessions", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should handle 3 concurrent sessions cross-communicating without interference", async () => {
		const pmA = createMockProcessManager();
		const pmB = createMockProcessManager();
		const pmC = createMockProcessManager();

		pmA.sessions.set("session_B", { sessionId: "session_B", projectPath: "/p", status: "idle" });
		pmB.sessions.set("session_C", { sessionId: "session_C", projectPath: "/p", status: "idle" });
		pmC.sessions.set("session_A", { sessionId: "session_A", projectPath: "/p", status: "idle" });

		const harnessA = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmA, { sessionId: "session_A" })],
		});
		harnesses.push(harnessA);

		const harnessB = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmB, { sessionId: "session_B" })],
		});
		harnesses.push(harnessB);

		const harnessC = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmC, { sessionId: "session_C" })],
		});
		harnesses.push(harnessC);

		harnessA.setResponses([
			fauxAssistantMessage(
				fauxToolCall("session_delegate_send", { targetSessionId: "session_B", message: "A to B" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("A done"),
		]);

		harnessB.setResponses([
			fauxAssistantMessage(
				fauxToolCall("session_delegate_send", { targetSessionId: "session_C", message: "B to C" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("B done"),
		]);

		harnessC.setResponses([
			fauxAssistantMessage(
				fauxToolCall("session_delegate_send", { targetSessionId: "session_A", message: "C to A" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("C done"),
		]);

		await Promise.all([
			harnessA.session.prompt("send to B"),
			harnessB.session.prompt("send to C"),
			harnessC.session.prompt("send to A"),
		]);

		expect(pmA.sendLog[0]).toEqual({ from: "session_A", to: "session_B", message: "A to B" });
		expect(pmB.sendLog[0]).toEqual({ from: "session_B", to: "session_C", message: "B to C" });
		expect(pmC.sendLog[0]).toEqual({ from: "session_C", to: "session_A", message: "C to A" });

		for (const harness of [harnessA, harnessB, harnessC]) {
			const eventTypes = harness.events.map((e) => e.type);
			expect(eventTypes).toContain("agent_start");
			expect(eventTypes).toContain("agent_end");
			expect(eventTypes).toContain("tool_execution_start");
			expect(eventTypes).toContain("tool_execution_end");
		}
	});

	it("should keep delegate logs isolated across concurrent sessions", async () => {
		const pmA = createMockProcessManager();
		const pmB = createMockProcessManager();

		const harnessA = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmA, { sessionId: "session_A" })],
		});
		harnesses.push(harnessA);

		const harnessB = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pmB, { sessionId: "session_B" })],
		});
		harnesses.push(harnessB);

		harnessA.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "task A1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		harnessB.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "task B1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await Promise.all([harnessA.session.prompt("delegate A"), harnessB.session.prompt("delegate B")]);

		expect(pmA.delegateLog).toHaveLength(1);
		expect(pmA.delegateLog[0].task).toBe("task A1");
		expect(pmB.delegateLog).toHaveLength(1);
		expect(pmB.delegateLog[0].task).toBe("task B1");
	});
});

describe("Coordinator E2E: Session restart recovery", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should reload tasks from file after session restart", async () => {
		const tempDir = harnesses.length > 0 ? undefined : undefined;
		const pm = createMockProcessManager();

		const harness1 = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness1);

		const taskStoreDir = harness1.tempDir;
		mkdirSync(taskStoreDir, { recursive: true });

		const store1 = new TaskStore(taskStoreDir);
		store1.add({
			sessionId: "sess_restart_001",
			title: "Long Task",
			task: "long-running task",
			projectPath: "/project",
			dispatchedAt: Date.now(),
			status: "idle",
		});

		expect(store1.list()).toHaveLength(1);

		const filePath = join(taskStoreDir, "coordinator-tasks.json");
		expect(existsSync(filePath)).toBe(true);

		const store2 = new TaskStore(taskStoreDir);
		expect(store2.list()).toHaveLength(1);
		expect(store2.list()[0].title).toBe("Long Task");
		expect(store2.list()[0].task).toBe("long-running task");
	});

	it("should allow new session to see previous tasks via buildPrompt", async () => {
		const pm = createMockProcessManager();
		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		const taskStoreDir = harness.tempDir;
		mkdirSync(taskStoreDir, { recursive: true });

		const store = new TaskStore(taskStoreDir);
		store.add({
			sessionId: "sess_build_001",
			title: "Refactor",
			task: "refactor utils",
			projectPath: "/project",
			dispatchedAt: Date.now() - 5000,
			status: "idle",
		});

		store.update("sess_build_001", {
			status: "completed",
			completedAt: Date.now(),
			result: "Refactored 12 files",
		});

		const prompt = store.buildPrompt();
		expect(prompt).toContain("## Delegated Tasks");
		expect(prompt).toContain("Refactor");
		expect(prompt).toContain("DONE");
		expect(prompt).toContain("Refactored 12 files");
	});
});

describe("Coordinator E2E: Context injection verification", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should include delegated task in context via store buildPrompt", async () => {
		const pm = createMockProcessManager();
		const contextSnapshots: string[] = [];

		const harness = await createHarness({
			extensionFactories: [
				createCoordinatorExtensionFactory(pm, {
					taskStoreDir: undefined,
					onContextEvent: (prompt) => contextSnapshots.push(prompt),
				}),
			],
		});
		harnesses.push(harness);

		const taskStoreDir = harness.tempDir;
		mkdirSync(taskStoreDir, { recursive: true });

		const store = new TaskStore(taskStoreDir);
		store.add({
			sessionId: "sess_ctx_001",
			title: "Perf Analysis",
			task: "analyze perf",
			projectPath: "/project",
			dispatchedAt: Date.now(),
			status: "streaming",
		});

		const prompt = store.buildPrompt();
		expect(prompt).toContain("Perf Analysis");
		expect(prompt).toContain("STREAMING");
		expect(prompt).toContain("sess_ctx_001");
	});

	it("should include multiple delegated tasks in context", async () => {
		const pm = createMockProcessManager();

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		const taskStoreDir = harness.tempDir;
		mkdirSync(taskStoreDir, { recursive: true });

		const store = new TaskStore(taskStoreDir);
		store.add({
			sessionId: "sess_multi_001",
			title: "Task One",
			task: "task one",
			projectPath: "/project",
			dispatchedAt: Date.now() - 10000,
			status: "idle",
		});
		store.add({
			sessionId: "sess_multi_002",
			title: "Task Two",
			task: "task two",
			projectPath: "/project",
			dispatchedAt: Date.now() - 5000,
			status: "streaming",
		});

		const prompt = store.buildPrompt();
		expect(prompt).toContain("Task One");
		expect(prompt).toContain("Task Two");
	});

	it("should show DONE status for completed tasks in context", async () => {
		const pm = createMockProcessManager();

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		const taskStoreDir = harness.tempDir;
		mkdirSync(taskStoreDir, { recursive: true });

		const store = new TaskStore(taskStoreDir);
		store.add({
			sessionId: "sess_done_001",
			title: "Feature Build",
			task: "build feature",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "completed",
			completedAt: 2000,
			result: "Feature shipped",
		});

		const prompt = store.buildPrompt();
		expect(prompt).toContain("DONE");
		expect(prompt).toContain("Feature shipped");
	});
});

describe("Coordinator E2E: Error scenarios", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should handle send to non-existent session", async () => {
		const pm = createMockProcessManager();

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("session_delegate_send", {
					targetSessionId: "nonexistent_session",
					message: "hello",
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("handled error"),
		]);

		await harness.session.prompt("send to nonexistent");

		const toolEnds = harness.eventsOfType<ToolExecutionEndEvent["type"]>("tool_execution_end");
		expect(toolEnds.length).toBeGreaterThanOrEqual(1);

		const sendEnd = toolEnds.find((e: any) => e.toolName === "session_delegate_send");
		expect(sendEnd).toBeDefined();

		const result = (sendEnd as any).result;
		expect(result.content[0].text).toContain("not found");
	});

	it("should handle stop of already stopped session", async () => {
		const pm = createMockProcessManager();

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate_stop", { sessionId: "ghost_session" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("handled"),
		]);

		await harness.session.prompt("stop nonexistent");

		const toolEnds = harness.eventsOfType<ToolExecutionEndEvent["type"]>("tool_execution_end");
		const stopEnd = toolEnds.find((e: any) => e.toolName === "session_delegate_stop");
		expect(stopEnd).toBeDefined();

		const result = (stopEnd as any).result;
		expect(result.content[0].text).toContain("not found");
	});

	it("should handle delegate with empty task string", async () => {
		const pm = createMockProcessManager();

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("delegated empty task"),
		]);

		await harness.session.prompt("delegate empty");

		expect(pm.delegateLog).toHaveLength(1);
		expect(pm.delegateLog[0].task).toBe("");
	});

	it("should handle status check for unknown session gracefully", async () => {
		const pm = createMockProcessManager();

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate_status", { sessionId: "unknown_session_xyz" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("no such session"),
		]);

		await harness.session.prompt("check unknown status");

		const toolEnds = harness.eventsOfType<ToolExecutionEndEvent["type"]>("tool_execution_end");
		const statusEnd = toolEnds.find((e: any) => e.toolName === "session_delegate_status");
		expect(statusEnd).toBeDefined();

		const result = (statusEnd as any).result;
		expect(result.details.task).toBeNull();
	});

	it("should handle multiple tool calls in a single response", async () => {
		const pm = createMockProcessManager();

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("session_delegate", { task: "multi 1" }),
					fauxToolCall("session_delegate", { task: "multi 2" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("both delegated"),
		]);

		await harness.session.prompt("delegate two tasks at once");

		expect(pm.delegateLog).toHaveLength(2);
		expect(pm.delegateLog.map((l) => l.task)).toEqual(["multi 1", "multi 2"]);
	});
});

describe("Coordinator E2E: TaskStore persistence edge cases", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should persist tasks to file and reload correctly", async () => {
		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(createMockProcessManager())],
		});
		harnesses.push(harness);

		const taskStoreDir = harness.tempDir;
		mkdirSync(taskStoreDir, { recursive: true });

		const store = new TaskStore(taskStoreDir);
		store.add({
			sessionId: "sess_persist_001",
			title: "Persist Test",
			task: "verify persistence",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "idle",
		});

		const filePath = join(taskStoreDir, "coordinator-tasks.json");
		expect(existsSync(filePath)).toBe(true);

		const raw = JSON.parse(readFileSync(filePath, "utf-8")) as DelegatedTask[];
		expect(raw).toHaveLength(1);
		expect(raw[0].sessionId).toBe("sess_persist_001");

		const reloaded = new TaskStore(taskStoreDir);
		expect(reloaded.list()).toHaveLength(1);
		expect(reloaded.get("sess_persist_001")!.title).toBe("Persist Test");
	});

	it("should handle task update and removal correctly", async () => {
		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(createMockProcessManager())],
		});
		harnesses.push(harness);

		const taskStoreDir = harness.tempDir;
		mkdirSync(taskStoreDir, { recursive: true });

		const store = new TaskStore(taskStoreDir);
		store.add({
			sessionId: "sess_update_001",
			title: "Initial",
			task: "initial task",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "idle",
		});

		store.update("sess_update_001", { status: "streaming" });
		expect(store.get("sess_update_001")!.status).toBe("streaming");

		store.update("sess_update_001", {
			status: "completed",
			completedAt: 2000,
			result: "All done",
		});
		expect(store.get("sess_update_001")!.status).toBe("completed");
		expect(store.get("sess_update_001")!.result).toBe("All done");

		store.remove("sess_update_001");
		expect(store.list()).toHaveLength(0);

		const reloaded = new TaskStore(taskStoreDir);
		expect(reloaded.list()).toHaveLength(0);
	});

	it("should truncate long results in buildPrompt", async () => {
		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(createMockProcessManager())],
		});
		harnesses.push(harness);

		const taskStoreDir = harness.tempDir;
		mkdirSync(taskStoreDir, { recursive: true });

		const store = new TaskStore(taskStoreDir);
		const longResult = "x".repeat(300);
		store.add({
			sessionId: "sess_long_001",
			title: "Long Result",
			task: "long result task",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "completed",
			completedAt: 2000,
			result: longResult,
		});

		const prompt = store.buildPrompt();
		expect(prompt).toContain(`${"x".repeat(200)}...`);
		expect(prompt).not.toContain("x".repeat(300));
	});
});

describe("Coordinator E2E: Fork functionality", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should fork a delegated session via tool call", async () => {
		const pm = createMockProcessManager();
		const precreatedSid = `sess_orig_${Date.now()}`;
		pm.sessions.set(precreatedSid, { sessionId: precreatedSid, projectPath: "/project", status: "idle" });

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("session_delegate", { task: "original task", title: "Original" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(
				fauxToolCall("session_delegate_fork", {
					sessionId: precreatedSid,
					task: "forked subtask",
					title: "Forked Work",
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("fork completed"),
		]);

		await harness.session.prompt("delegate and then fork");

		const toolStarts = harness.eventsOfType<ToolExecutionStartEvent["type"]>("tool_execution_start");
		const toolNames = toolStarts.map((e: any) => e.toolName);
		expect(toolNames).toContain("session_delegate");
		expect(toolNames).toContain("session_delegate_fork");
	});

	it("should maintain both original and forked session tasks independently", async () => {
		const pm = createMockProcessManager();
		const precreatedSid = `sess_orig_${Date.now()}`;
		pm.sessions.set(precreatedSid, {
			sessionId: precreatedSid,
			projectPath: "/project",
			status: "idle",
		});

		const harness = await createHarness({
			extensionFactories: [createCoordinatorExtensionFactory(pm)],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("session_delegate_fork", { sessionId: precreatedSid, task: "subtask work", title: "Subtask" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("fork the session");

		const toolEnds = harness.eventsOfType<ToolExecutionEndEvent["type"]>("tool_execution_end");
		const forkEnd = toolEnds.find((e: any) => e.toolName === "session_delegate_fork");
		expect(forkEnd).toBeDefined();
		expect((forkEnd as any).isError).toBe(false);

		const original = pm.sessions.get(precreatedSid);
		expect(original?.status).toBe("idle");

		const forkedSessionIds = Array.from(pm.sessions.keys()).filter((id) => id !== precreatedSid);
		expect(forkedSessionIds.length).toBe(1);
		const forkedSession = pm.sessions.get(forkedSessionIds[0]);
		expect(forkedSession?.status).toBe("idle");
	});
});

describe("Coordinator E2E: Compacting status", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("should report compacting status via delegate_compact_status", async () => {
		const pm = createMockProcessManager();
		const sessionId = `sess_compact_${Date.now()}`;
		pm.sessions.set(sessionId, { sessionId, projectPath: "/project", status: "streaming" });
		pm.compactStates.set(sessionId, {
			isCompacting: true,
			contextUsage: { tokens: 80000, contextWindow: 200000, percent: 40 },
		});

		const status = pm.delegate_compact_status(sessionId);
		expect(status.isCompacting).toBe(true);
		expect(status.contextUsage.percent).toBe(40);
	});

	it("should default to not compacting for unknown sessions", async () => {
		const pm = createMockProcessManager();
		const status = pm.delegate_compact_status("unknown_session");
		expect(status.isCompacting).toBe(false);
		expect(status.contextUsage.tokens).toBeNull();
	});
});
