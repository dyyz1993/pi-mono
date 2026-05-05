import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "../../extensions/coordinator/handler.js";
import type { CoordinatorChannelContract, DelegatedTask } from "../../extensions/coordinator/types.js";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.js";
import { AuthStorage } from "../../src/core/auth-storage.js";
import { ChannelManager } from "../../src/core/extensions/channel-manager.js";
import type { Channel, ChannelDataMessage } from "../../src/core/extensions/channel-types.js";
import { ClientChannel, ServerChannel } from "../../src/core/extensions/index.js";
import { SessionManager } from "../../src/core/session-manager.js";
import type { ExtensionAPI, ExtensionFactory } from "../../src/index.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-coord-life-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

class MockChannel {
	name = "coordinator";
	sentMessages: unknown[] = [];
	handlers = new Set<(data: unknown) => void>();

	send(data: unknown): void {
		this.sentMessages.push(data);
		for (const handler of this.handlers) {
			handler(data);
		}
	}

	onReceive(handler: (data: unknown) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	invoke(data: unknown, _timeoutMs?: number): Promise<unknown> {
		const msg = data as Record<string, unknown>;
		return new Promise((resolve) => {
			const check = () => {
				const response = this.sentMessages.find(
					(m) => (m as Record<string, unknown>)?.invokeId === msg.invokeId && m !== msg,
				);
				if (response) resolve(response);
			};
			setTimeout(check, 10);
		});
	}

	call(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
		const payload = { __call: method, invokeId: `inv_${Date.now()}_${Math.random()}`, ...params };
		this.send(payload);
		return this.invoke(payload, timeoutMs);
	}
}

async function createTestRuntime(tempDir: string, extensionFactory: ExtensionFactory) {
	const faux = registerFauxProvider();
	faux.setResponses([fauxAssistantMessage("ok")]);

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

	const channelOutput: ChannelDataMessage[] = [];
	const channelManager = new ChannelManager((msg) => channelOutput.push(msg));

	const runtimeOptions = {
		agentDir: tempDir,
		authStorage,
		model: faux.getModel(),
		resourceLoaderOptions: {
			extensionFactories: [extensionFactory],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
		},
	};

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
				model: runtimeOptions.model,
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: tempDir,
		agentDir: tempDir,
		sessionManager: SessionManager.create(tempDir),
	});

	await runtime.session.bindExtensions({
		registerChannel: (name: string) => channelManager.register(name),
	});

	return { runtime, faux, channelManager, channelOutput };
}

describe("Coordinator Extension: lifecycle integration", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	it("should fire session_start and register tools on bind", async () => {
		const tempDir = createTempDir();
		const lifecycleLog: string[] = [];

		const extensionFactory: ExtensionFactory = (pi: ExtensionAPI) => {
			pi.on("session_start", () => {
				lifecycleLog.push("session_start");
			});

			pi.registerTool({
				name: "session_delegate",
				label: "Session Delegate",
				description: "Delegate a task",
				parameters: {
					type: "object",
					properties: { task: { type: "string" } },
					required: ["task"],
				} as any,
				async execute(_toolCallId, _params) {
					return { output: "delegated" };
				},
			});

			pi.registerTool({
				name: "session_delegate_send",
				label: "Session Delegate Send",
				description: "Send message",
				parameters: {
					type: "object",
					properties: { targetSessionId: { type: "string" }, message: { type: "string" } },
					required: ["targetSessionId", "message"],
				} as any,
				async execute() {
					return { output: "sent" };
				},
			});

			pi.registerTool({
				name: "session_delegate_stop",
				label: "Session Delegate Stop",
				description: "Stop session",
				parameters: {
					type: "object",
					properties: { sessionId: { type: "string" } },
					required: ["sessionId"],
				} as any,
				async execute() {
					return { output: "stopped" };
				},
			});
		};

		const env = await createTestRuntime(tempDir, extensionFactory);

		cleanups.push(async () => {
			env.runtime.session.dispose();
			env.faux.unregister();
			rmSync(tempDir, { recursive: true, force: true });
		});

		expect(lifecycleLog).toContain("session_start");
		expect(env.channelOutput).toBeDefined();
	});

	it("should register coordinator channel", async () => {
		const tempDir = createTempDir();

		let channelRegistered = false;
		const extensionFactory: ExtensionFactory = (pi: ExtensionAPI) => {
			pi.registerChannel("coordinator");
			pi.on("session_start", () => {
				channelRegistered = true;
			});
		};

		const channelOutput: ChannelDataMessage[] = [];
		const channelManager = new ChannelManager((msg) => channelOutput.push(msg));

		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("ok")]);

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [extensionFactory],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({ ...runtimeOptions, cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: runtimeOptions.model,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});

		await runtime.session.bindExtensions({
			registerChannel: (name: string) => channelManager.register(name),
		});

		cleanups.push(async () => {
			runtime.session.dispose();
			faux.unregister();
			rmSync(tempDir, { recursive: true, force: true });
		});

		expect(channelRegistered).toBe(true);
		expect(channelOutput).toHaveLength(0);

		const inbound = { type: "channel_data", name: "coordinator", data: { test: "hello" } };
		channelManager.handleInbound(inbound);
	});
});

describe("Coordinator: TaskStore integration with session directory", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
	});

	it("should persist and reload tasks across session restarts", () => {
		const tempDir = createTempDir();
		cleanups.push(() => rmSync(tempDir, { recursive: true, force: true }));

		const store1 = new TaskStore(tempDir);
		store1.add({
			sessionId: "sess_persist_001",
			title: "Long-running task",
			task: "do something important",
			projectPath: "/project",
			dispatchedAt: 1000,
			status: "streaming",
		});

		const store2 = new TaskStore(tempDir);
		const tasks = store2.list();
		expect(tasks).toHaveLength(1);
		expect(tasks[0].sessionId).toBe("sess_persist_001");
		expect(tasks[0].title).toBe("Long-running task");
		expect(tasks[0].status).toBe("streaming");
	});

	it("should build system prompt with task summary", () => {
		const tempDir = createTempDir();
		cleanups.push(() => rmSync(tempDir, { recursive: true, force: true }));

		const store = new TaskStore(tempDir);
		store.add({
			sessionId: "sess_prompt_001",
			title: "Refactor Module",
			task: "refactor the auth module",
			projectPath: "/project",
			dispatchedAt: Date.now() - 30000,
			status: "streaming",
		});
		store.add({
			sessionId: "sess_prompt_002",
			title: "Write Tests",
			task: "write tests for utils",
			projectPath: "/project",
			dispatchedAt: Date.now() - 15000,
			status: "completed",
			completedAt: Date.now(),
			result: "42 tests written, all passing",
		});

		const prompt = store.buildPrompt();
		expect(prompt).toContain("## Delegated Tasks");
		expect(prompt).toContain("Refactor Module");
		expect(prompt).toContain("Write Tests");
		expect(prompt).toContain("STREAMING");
		expect(prompt).toContain("DONE");
		expect(prompt).toContain("42 tests written");
	});

	it("should handle full bidirectional channel communication via MockChannel", async () => {
		const mockChannel = new MockChannel();

		const server = new ServerChannel<CoordinatorChannelContract>(mockChannel);
		const client = new ClientChannel<CoordinatorChannelContract>(mockChannel);

		const handledTasks: DelegatedTask[] = [];

		server.handle("session_delegate", async ({ task, title }) => {
			const t: DelegatedTask = {
				sessionId: `sess_${Date.now()}`,
				title: title || task.slice(0, 60),
				task,
				projectPath: "/project",
				dispatchedAt: Date.now(),
				status: "idle",
			};
			handledTasks.push(t);
			return { sessionId: t.sessionId, status: "started" as const };
		});

		server.handle("session_delegate_send", async ({ targetSessionId: _targetSessionId, message: _message }) => {
			return { delivered: true, targetStatus: "active" as const };
		});

		server.handle("session_delegate_stop", async ({ sessionId }) => {
			const idx = handledTasks.findIndex((t) => t.sessionId === sessionId);
			if (idx >= 0) handledTasks[idx].status = "stopped";
			return { ok: idx >= 0 };
		});

		const delegateResult = await client.call("session_delegate", {
			task: "analyze code quality",
			title: "Code Analysis",
		});
		expect(delegateResult.status).toBe("started");
		expect(delegateResult.sessionId).toBeTruthy();
		expect(handledTasks).toHaveLength(1);
		expect(handledTasks[0].title).toBe("Code Analysis");

		const sendResult = await client.call("session_delegate_send", {
			targetSessionId: delegateResult.sessionId,
			message: "How's it going?",
		});
		expect(sendResult.delivered).toBe(true);

		const stopResult = await client.call("session_delegate_stop", {
			sessionId: delegateResult.sessionId,
		});
		expect(stopResult.ok).toBe(true);
		expect(handledTasks[0].status).toBe("stopped");
	});

	it("should emit and receive events bidirectionally", () => {
		const mockChannel = new MockChannel();

		const server = new ServerChannel<CoordinatorChannelContract>(mockChannel);
		const client = new ClientChannel<CoordinatorChannelContract>(mockChannel);

		const receivedByClient: unknown[] = [];
		client.on("message_received", (data) => receivedByClient.push(data));

		server.emit("message_received", { fromSessionId: "sess_worker", message: "task complete" });

		expect(receivedByClient.length).toBeGreaterThanOrEqual(1);
		expect(receivedByClient[0]).toEqual({ fromSessionId: "sess_worker", message: "task complete" });
	});
});
