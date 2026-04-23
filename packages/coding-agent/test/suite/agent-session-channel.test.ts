import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.js";
import { AuthStorage } from "../../src/core/auth-storage.js";
import { ChannelManager } from "../../src/core/extensions/channel-manager.js";
import type { ChannelDataMessage } from "../../src/core/extensions/channel-types.js";
import { SessionManager } from "../../src/core/session-manager.js";
import type { ExtensionAPI, ExtensionFactory } from "../../src/index.js";

describe("registerChannel integration", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeWithChannel(extensionFactory: ExtensionFactory) {
		const tempDir = join(tmpdir(), `pi-channel-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("ok")]);

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const outputMessages: ChannelDataMessage[] = [];
		const channelManager = new ChannelManager((message: ChannelDataMessage) => {
			outputMessages.push(message);
		});

		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((m) => ({
								id: m.id,
								name: m.name,
								api: m.api,
								reasoning: m.reasoning,
								input: m.input,
								cost: m.cost,
								contextWindow: m.contextWindow,
								maxTokens: m.maxTokens,
							})),
						});
						extensionFactory(pi);
					},
				],
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
			await runtime.dispose();
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return { runtime, faux, tempDir, channelManager, outputMessages };
	}

	it("registers a channel during extension load", async () => {
		let channelName: string | undefined;
		await createRuntimeWithChannel((pi) => {
			const channel = pi.registerChannel("test-ch");
			channelName = channel.name;
		});
		expect(channelName).toBe("test-ch");
	});

	it("sends data from extension via channel on session_start", async () => {
		const { outputMessages } = await createRuntimeWithChannel((pi) => {
			const channel = pi.registerChannel("events");
			pi.on("session_start", () => {
				channel.send({ event: "started", ts: 42 });
			});
		});

		const started = outputMessages.find(
			(m) => m.name === "events" && (m.data as Record<string, unknown>)?.event === "started",
		);
		expect(started).toBeDefined();
		expect((started!.data as Record<string, unknown>).ts).toBe(42);
	});

	it("sends data from extension on agent_end", async () => {
		const { runtime, faux, outputMessages } = await createRuntimeWithChannel((pi) => {
			const channel = pi.registerChannel("lifecycle");
			pi.on("agent_end", () => {
				channel.send({ event: "agent_done" });
			});
		});

		faux.setResponses([fauxAssistantMessage("done")]);
		await runtime.session.prompt("go");

		const done = outputMessages.find(
			(m) => m.name === "lifecycle" && (m.data as Record<string, unknown>)?.event === "agent_done",
		);
		expect(done).toBeDefined();
	});

	it("handles inbound channel_data from ChannelManager to extension", async () => {
		const received: unknown[] = [];
		const { channelManager } = await createRuntimeWithChannel((pi) => {
			const channel = pi.registerChannel("cmd");
			channel.onReceive((data) => {
				received.push(data);
			});
		});

		channelManager.handleInbound({ type: "channel_data", name: "cmd", data: { action: "ping" } });
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ action: "ping" });
	});

	it("extension responds to inbound via channel.send", async () => {
		const { channelManager, outputMessages } = await createRuntimeWithChannel((pi) => {
			const channel = pi.registerChannel("rpc");
			channel.onReceive((data) => {
				const d = data as Record<string, unknown>;
				channel.send({ action: "pong", invokeId: d.invokeId });
			});
		});

		channelManager.handleInbound({
			type: "channel_data",
			name: "rpc",
			data: { action: "ping", invokeId: "inv_123" },
		});

		const pong = outputMessages.find(
			(m) => m.name === "rpc" && (m.data as Record<string, unknown>)?.action === "pong",
		);
		expect(pong).toBeDefined();
		expect((pong!.data as Record<string, unknown>).invokeId).toBe("inv_123");
	});

	it("multiple channels are independent", async () => {
		const receivedA: unknown[] = [];
		const receivedB: unknown[] = [];

		const { channelManager } = await createRuntimeWithChannel((pi) => {
			const chA = pi.registerChannel("ch-a");
			chA.onReceive((data) => receivedA.push(data));
			const chB = pi.registerChannel("ch-b");
			chB.onReceive((data) => receivedB.push(data));
		});

		channelManager.handleInbound({ type: "channel_data", name: "ch-a", data: "for-a" });
		channelManager.handleInbound({ type: "channel_data", name: "ch-b", data: "for-b" });

		expect(receivedA).toEqual(["for-a"]);
		expect(receivedB).toEqual(["for-b"]);
	});

	it("inbound to nonexistent channel is silently ignored", async () => {
		const { channelManager } = await createRuntimeWithChannel((pi) => {
			pi.registerChannel("existing");
		});

		expect(() => {
			channelManager.handleInbound({ type: "channel_data", name: "nonexistent", data: {} });
		}).not.toThrow();
	});

	it("duplicate channel name: extension fails to load", async () => {
		const tempDir = join(tmpdir(), `pi-channel-dup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider();
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const outputMessages: ChannelDataMessage[] = [];
		const channelManager = new ChannelManager((msg) => outputMessages.push(msg));

		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((m) => ({
								id: m.id,
								name: m.name,
								api: m.api,
								reasoning: m.reasoning,
								input: m.input,
								cost: m.cost,
								contextWindow: m.contextWindow,
								maxTokens: m.maxTokens,
							})),
						});
						pi.registerChannel("dup");
						pi.registerChannel("dup");
					},
				],
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

		const hasChannel = channelManager.has("dup");

		await runtime.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });

		expect(hasChannel).toBe(true);
	});

	it("channel.send buffers data before bindExtensions and flushes after", async () => {
		const tempDir = join(tmpdir(), `pi-channel-buffer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("ok")]);

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const outputMessages: ChannelDataMessage[] = [];
		const channelManager = new ChannelManager((msg) => outputMessages.push(msg));

		let earlySendCalled = false;
		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((m) => ({
								id: m.id,
								name: m.name,
								api: m.api,
								reasoning: m.reasoning,
								input: m.input,
								cost: m.cost,
								contextWindow: m.contextWindow,
								maxTokens: m.maxTokens,
							})),
						});
						const channel = pi.registerChannel("early-ch");
						channel.send({ buffered: true });
						earlySendCalled = true;
					},
				],
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

		expect(earlySendCalled).toBe(true);
		expect(outputMessages).toHaveLength(0);

		await runtime.session.bindExtensions({
			registerChannel: (name: string) => channelManager.register(name),
		});

		await new Promise((r) => setTimeout(r, 50));

		expect(outputMessages).toHaveLength(1);
		expect(outputMessages[0]!.name).toBe("early-ch");
		expect(outputMessages[0]!.data).toEqual({ buffered: true });

		await runtime.dispose();
		faux.unregister();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});
});
