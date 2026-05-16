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
import type { ExtensionAPI, ExtensionCommandContext, ExtensionFactory } from "../../../src/index.js";

function getText(message: AgentSession["messages"][number]): string {
	if (!("content" in message)) {
		return "";
	}
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("");
}

describe("reload stale context", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeForTest(extensionFactory: ExtensionFactory, responses: string[]) {
		const tempDir = join(tmpdir(), `pi-reload-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
								models: faux.models.map((registeredModel) => ({
									id: registeredModel.id,
									name: registeredModel.name,
									api: registeredModel.api,
									reasoning: registeredModel.reasoning,
									input: registeredModel.input,
									cost: registeredModel.cost,
									contextWindow: registeredModel.contextWindow,
									maxTokens: registeredModel.maxTokens,
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

		return { runtime, faux };
	}

	it("invalidates old ctx and old pi after reload", async () => {
		const events: string[] = [];
		let oldCtx: ExtensionCommandContext | undefined;
		let oldPi: ExtensionAPI | undefined;
		let staleCtxThrows = false;
		let stalePiThrows = false;
		let staleCtxMessage = "";
		let stalePiMessage = "";
		let instanceId = 0;

		const { runtime } = await createRuntimeForTest(
			(pi) => {
				const currentInstance = ++instanceId;
				pi.on("session_start", () => {
					events.push(`start:${currentInstance}`);
				});
				pi.on("session_shutdown", () => {
					events.push(`shutdown:${currentInstance}`);
				});
				pi.registerCommand("repro", {
					description: "repro",
					handler: async (_args, ctx) => {
						oldCtx = ctx;
						oldPi = pi;
						await ctx.reload();
						// After reload, old ctx should throw on property access
						try {
							oldCtx?.cwd;
						} catch (err) {
							staleCtxThrows = true;
							staleCtxMessage = err instanceof Error ? err.message : String(err);
						}
						// After reload, old pi should throw on action methods
						try {
							oldPi?.sendUserMessage("stale message");
						} catch (err) {
							stalePiThrows = true;
							stalePiMessage = err instanceof Error ? err.message : String(err);
						}
					},
				});
			},
			["hello reply"],
		);

		expect(events).toEqual(["start:1"]);

		await runtime.session.prompt("/repro");

		// Events: shutdown on old runner, start on new runner
		expect(events).toEqual(["start:1", "shutdown:1", "start:2"]);

		// Both ctx and pi should throw after reload
		expect(staleCtxThrows).toBe(true);
		expect(stalePiThrows).toBe(true);

		// Error messages should mention "reload"
		expect(staleCtxMessage).toMatch(/reload/i);
		expect(stalePiMessage).toMatch(/reload/i);
	});

	it("invalidates all lazy getters on stale ctx after reload", async () => {
		let capturedCtx: ExtensionCommandContext | undefined;
		const staleResults: Array<{ prop: string; threw: boolean }> = [];

		const { runtime } = await createRuntimeForTest(
			(pi) => {
				pi.registerCommand("check-props", {
					description: "check-props",
					handler: async (_args, ctx) => {
						capturedCtx = ctx;
						await ctx.reload();
						// After reload, every lazy getter on the old ctx should throw
						for (const [prop, accessor] of [
							["cwd", () => capturedCtx!.cwd],
							["sessionManager", () => capturedCtx!.sessionManager],
							["model", () => capturedCtx!.model],
							["modelRegistry", () => capturedCtx!.modelRegistry],
							["isIdle", () => capturedCtx!.isIdle()],
							["signal", () => capturedCtx!.signal],
							["hasPendingMessages", () => capturedCtx!.hasPendingMessages()],
							["getContextUsage", () => capturedCtx!.getContextUsage()],
							["getSystemPrompt", () => capturedCtx!.getSystemPrompt()],
							["fileSnapshotManager", () => capturedCtx!.fileSnapshotManager],
							["extensionName", () => capturedCtx!.extensionName],
							["projectRoot", () => capturedCtx!.projectRoot],
							["sessionDataDir", () => capturedCtx!.sessionDataDir],
							["sessionSignal", () => capturedCtx!.sessionSignal],
						] as const) {
							try {
								accessor();
								staleResults.push({ prop, threw: false });
							} catch {
								staleResults.push({ prop, threw: true });
							}
						}
					},
				});
			},
			["done"],
		);

		await runtime.session.prompt("/check-props");

		// Every property should throw after reload
		const nonThrowing = staleResults.filter((r) => !r.threw);
		expect(nonThrowing).toEqual([]);
	});

	it("reload twice is safe", async () => {
		let instanceId = 0;
		const events: string[] = [];

		const { runtime } = await createRuntimeForTest(
			(pi) => {
				const currentInstance = ++instanceId;
				pi.on("session_start", () => {
					events.push(`start:${currentInstance}`);
				});
				pi.on("session_shutdown", () => {
					events.push(`shutdown:${currentInstance}`);
				});
				pi.registerCommand("reload-twice", {
					description: "reload-twice",
					handler: async (_args, ctx) => {
						await ctx.reload();
						// Second reload on a fresh ctx is fine
					},
				});
			},
			["first"],
		);

		expect(events).toEqual(["start:1"]);

		// First reload
		await runtime.session.prompt("/reload-twice");
		expect(events).toEqual(["start:1", "shutdown:1", "start:2"]);

		// Second reload
		await runtime.session.prompt("/reload-twice");
		expect(events).toEqual(["start:1", "shutdown:1", "start:2", "shutdown:2", "start:3"]);
	});
});
