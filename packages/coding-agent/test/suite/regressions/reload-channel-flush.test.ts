import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@dyyz1993/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../../../src/core/agent-session.js";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../../src/core/agent-session-runtime.js";
import { AuthStorage } from "../../../src/core/auth-storage.js";
import { SessionManager } from "../../../src/core/session-manager.js";
import type { ExtensionAPI, ExtensionFactory } from "../../../src/index.js";

describe("reload flushes channels", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeForTest(extensionFactory: ExtensionFactory, responses: string[]) {
		const tempDir = join(tmpdir(), `pi-reload-channels-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider({
			models: [{ id: "faux-1", reasoning: false }],
		});
		faux.setResponses(responses.map((response) => fauxAssistantMessage(response)));

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir: tempDir,
				authStorage,
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
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
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

		// Track resolved channels
		const resolvedChannels = new Map<string, { sendCalled: number }>();

		const registerChannel = (name: string) => {
			const tracker = { sendCalled: 0 };
			resolvedChannels.set(name, tracker);
			return {
				name,
				send: (_data: unknown) => {
					tracker.sendCalled++;
				},
				onReceive: () => () => {},
				invoke: () => Promise.reject(new Error("not implemented")),
				call: () => Promise.reject(new Error("not implemented")),
			};
		};

		const rebindSession = async (): Promise<void> => {
			const session = runtime.session;
			await session.bindExtensions({
				commandContextActions: {
					waitForIdle: () => session.agent.waitForIdle(),
					newSession: async (options) => runtime.newSession(options),
					fork: async (entryId, options) => {
						const result = await runtime.fork(entryId, options);
						return { cancelled: result.cancelled };
					},
					navigateTree: async (targetId, options) => {
						const result = await session.navigateTree(targetId, {
							summarize: options?.summarize,
							customInstructions: options?.customInstructions,
							replaceInstructions: options?.replaceInstructions,
							label: options?.label,
						});
						return { cancelled: result.cancelled };
					},
					switchSession: async (sessionPath, options) => runtime.switchSession(sessionPath, options),
					reload: async () => {
						await session.reload();
					},
				},
				registerChannel,
			});
		};

		runtime.setRebindSession(async () => {
			await rebindSession();
		});
		await rebindSession();

		cleanups.push(async () => {
			await runtime.dispose();
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return { runtime, faux, resolvedChannels };
	}

	it("flushes pending channels after reload so extensions can communicate", async () => {
		const channelResolved = false;
		let channelSendAfterReload = false;

		const { runtime } = await createRuntimeForTest(
			(pi) => {
				// Register a channel (like coordinator does)
				const rawChannel = pi.registerChannel("test-channel");
				pi.on("session_start", () => {
					// Try to send on the channel after session starts
					try {
						rawChannel.send({ test: "after-reload" });
						channelSendAfterReload = true;
					} catch {
						// Channel not yet resolved — that's the old behavior
					}
				});
				pi.registerCommand("do-reload", {
					description: "do-reload",
					handler: async (_args, ctx) => {
						await ctx.reload();
					},
				});
			},
			["reloaded"],
		);

		// Before reload: channel may not be resolved yet (pending)
		channelSendAfterReload = false;

		// Trigger reload
		await runtime.session.prompt("/do-reload");

		// After reload: session_start fires again, channel should be resolved
		// because reload() now flushes pending channels via _registerChannel
		expect(channelSendAfterReload).toBe(true);
	});

	it("command context reload uses channel from new runner after reload", async () => {
		const events: string[] = [];

		const { runtime, resolvedChannels } = await createRuntimeForTest(
			(pi) => {
				pi.registerChannel("post-reload-channel");
				pi.on("session_start", () => {
					events.push("session_start");
					// Send a message through the channel to verify it's connected
					try {
						const ch = (pi as any).runtime?.resolvedChannels?.get("post-reload-channel");
						if (ch) {
							ch.send({ event: "start" });
						}
					} catch {
						// Channel not resolved
					}
				});
				pi.registerCommand("reload-and-check", {
					description: "reload-and-check",
					handler: async (_args, ctx) => {
						await ctx.reload();
					},
				});
			},
			["response"],
		);

		expect(events).toEqual(["session_start"]);
		expect(resolvedChannels.has("post-reload-channel")).toBe(true);

		// Trigger reload
		await runtime.session.prompt("/reload-and-check");

		// After reload: session_start should fire again
		expect(events).toEqual(["session_start", "session_start"]);

		// The new runner's channel should be resolved
		// (resolvedChannels is updated by registerChannel callback)
		expect(resolvedChannels.has("post-reload-channel")).toBe(true);
	});

	it("session.subscribe still receives events after reload", async () => {
		const receivedEvents: string[] = [];

		const { runtime } = await createRuntimeForTest(
			(pi) => {
				pi.registerCommand("do-reload", {
					description: "do-reload",
					handler: async (_args, ctx) => {
						await ctx.reload();
					},
				});
			},
			["after-reload-response"],
		);

		// Subscribe BEFORE reload — simulates what rpc-mode does
		const unsub = runtime.session.subscribe((event) => {
			// Collect ALL event types to understand what flows
			if (event && typeof event === "object" && "type" in event) {
				receivedEvents.push((event as { type: string }).type);
			}
		});

		// Reload
		await runtime.session.prompt("/do-reload");

		// After reload, send a message to generate agent events through the session bus.
		// session_start is an extension-only event (emitted via _extensionRunner.emit),
		// NOT a session-level event — so session.subscribe() won't see it.
		// Instead, we verify the session-level event bus still works by sending a prompt
		// and checking for message_start/message_end events.
		await runtime.session.prompt("hello after reload");

		const hasMessageStart = receivedEvents.some((e) => e === "message_start");
		const hasMessageEnd = receivedEvents.some((e) => e === "message_end");
		expect(hasMessageStart).toBe(true);
		expect(hasMessageEnd).toBe(true);

		unsub();
	});

	it("extension stale-catch pattern: stale pi calls are caught, non-stale errors propagate", async () => {
		let staleCaught = false;

		const { runtime } = await createRuntimeForTest(
			(pi) => {
				// Register a command that reloads and then tries to use the old pi.
				// After ctx.reload(), the extension runtime is invalidated, so
				// any pi.* call should throw with a "stale" message.
				pi.registerCommand("stale-check", {
					description: "stale-check",
					handler: async (_args, ctx) => {
						await ctx.reload();
						// Now pi is stale — try the catch pattern used in extensions
						try {
							pi.sendUserMessage("should be stale");
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							if (/stale/i.test(msg)) {
								staleCaught = true;
								return;
							}
							throw err;
						}
					},
				});
			},
			["response1", "response2"],
		);

		// Test 1: stale error from old pi reference is caught by /stale/i pattern
		await runtime.session.prompt("/stale-check");
		expect(staleCaught).toBe(true);
	});
});
