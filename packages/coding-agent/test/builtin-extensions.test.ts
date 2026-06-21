/**
 * Tests for 13 built-in extensions: registration and basic behavior.
 *
 * Each extension is loaded individually and tested for:
 * 1. Loading without errors
 * 2. Correct tools/channels/commands/flags registered
 * 3. Basic behavior where feasible
 */

import * as fs from "node:fs";
import { mkdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ChannelManager } from "../src/core/extensions/channel-manager.ts";
import type { ChannelDataMessage, ChannelOutputFn } from "../src/core/extensions/channel-types.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions } from "../src/core/extensions/types.ts";
import { FileSnapshotManager } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function builtinExtensionPath(name: string): string {
	return path.resolve(__dirname, `../dist/extensions/${name}/index.ts`);
}

function createCapturingChannelManager(): {
	manager: ChannelManager;
	outputs: ChannelDataMessage[];
} {
	const outputs: ChannelDataMessage[] = [];
	const outputFn: ChannelOutputFn = (msg) => {
		outputs.push(msg);
	};
	const manager = new ChannelManager(outputFn);
	return { manager, outputs };
}

function findResponse(
	outputs: ChannelDataMessage[],
	channelName: string,
	invokeId: string,
): Record<string, unknown> | undefined {
	const msg = outputs.find(
		(m) => m.name === channelName && (m.data as Record<string, unknown>)?.invokeId === invokeId,
	);
	return msg ? (msg.data as Record<string, unknown>) : undefined;
}

async function invokeChannelMethod(
	manager: ChannelManager,
	outputs: ChannelDataMessage[],
	channelName: string,
	method: string,
	params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const invokeId = `test-${channelName}-${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	manager.handleInbound({
		type: "channel_data",
		name: channelName,
		data: { __call: method, ...(params ?? {}), invokeId },
	});

	for (let i = 0; i < 100; i++) {
		const response = findResponse(outputs, channelName, invokeId);
		if (response) return response;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`No response for ${channelName}.${method} within timeout`);
}

function getToolNames(runner: ExtensionRunner): string[] {
	return runner.getAllRegisteredTools().map((t) => t.definition.name);
}

function getCommandNames(runner: ExtensionRunner): string[] {
	return runner.getRegisteredCommands().map((c) => c.invocationName);
}

// ─── Shared mock actions ───────────────────────────────────────────────────

let sentMessages: Array<{
	message: Parameters<ExtensionActions["sendMessage"]>[0];
	options: Parameters<ExtensionActions["sendMessage"]>[1];
}> = [];

const extensionActions: ExtensionActions = {
	sendMessage: (message, options) => {
		sentMessages.push({ message, options });
	},
	sendUserMessage: () => {},
	appendEntry: ((type: string) => `entry-${type}-${Date.now()}`) as unknown as ExtensionActions["appendEntry"],
	deleteEntries: () => {},
	summarizeEntries: () => {},
	setSessionName: () => {},
	getSessionName: () => undefined,
	setLabel: () => {},
	getActiveTools: () => [],
	getAllTools: () => [],
	setActiveTools: () => {},
	refreshTools: () => {},
	setToolOperationsProvider: () => {},
	getToolOperationsProvider: () => undefined,
	getCommands: () => [],
	setModel: async () => false,
	getThinkingLevel: () => "off",
	setThinkingLevel: () => {},
	registerChannel: (name) => ({
		name,
		send: () => {},
		onReceive: () => () => {},
		invoke: async () => ({}),
		call: async () => ({}),
	}),
	callLLM: async () => "",
};

const extensionContextActions: ExtensionContextActions = {
	getModel: () => undefined,
	isIdle: () => true,
	isProjectTrusted: () => true,
	getSignal: () => undefined,
	abort: () => {},
	hasPendingMessages: () => false,
	shutdown: () => {},
	getContextUsage: () => undefined,
	compact: () => {},
	getSystemPrompt: () => "",
};

// ─── Test suite ────────────────────────────────────────────────────────────

describe("Built-in Extensions", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		sentMessages = [];
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-builtin-ext-test-"));
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function loadExtension(extName: string): Promise<{
		runner: ExtensionRunner;
		manager: ChannelManager;
		outputs: ChannelDataMessage[];
	}> {
		const extPath = builtinExtensionPath(extName);
		expect(fs.existsSync(extPath)).toBe(true);

		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);

		const { manager, outputs } = createCapturingChannelManager();
		runner.flushPendingChannels((name) => manager.register(name));
		runner.updateRegisterChannel((name) => manager.register(name));

		const storeDir = path.join(tempDir, ".pi-snapshot-store");
		mkdirSync(storeDir, { recursive: true });
		const git = new InternalGit(storeDir);
		const snapshotManager = new FileSnapshotManager(git);
		snapshotManager.initialize(tempDir);
		runner.setFileSnapshotManagerFn(() => snapshotManager);
		runner.setContextDirFns({
			getProjectRoot: () => tempDir,
			getSessionDataDir: () => tempDir,
			getProjectDataDir: () => tempDir,
			getCwdDataDir: () => tempDir,
			getGlobalDataDir: () => tempDir,
		});

		await runner.emit({ type: "session_start", reason: "startup" });

		return { runner, manager, outputs };
	}

	// ─── 1. ask-tools ───────────────────────────────────────────────────

	describe("ask-tools", () => {
		it("registers the structured ask tool and notify tool", async () => {
			const { runner } = await loadExtension("ask-tools");
			const names = getToolNames(runner);
			expect(names).toContain("ask-user-question");
			expect(names).toContain("ask-notify");
			expect(names).not.toContain("ask-confirm");
			expect(names).not.toContain("ask-select");
			expect(names).not.toContain("ask-input");
			expect(names).not.toContain("ask-editor");
		});

		it("ask-user-question returns structured answers", async () => {
			const { runner } = await loadExtension("ask-tools");
			const tool = runner.getAllRegisteredTools().find((t) => t.definition.name === "ask-user-question");
			expect(tool).toBeDefined();

			const execute = tool!.definition.execute as unknown as (
				id: string,
				params: {
					title: string;
					questions: Array<{
						id: string;
						header: string;
						question: string;
						options: Array<{ label: string; description: string }>;
					}>;
				},
				signal: undefined,
				onUpdate: undefined,
				ctx: {
					ui: {
						askUserQuestion: (
							questions: unknown,
							options: unknown,
						) => Promise<{ action: "responded"; answers: Record<string, unknown> }>;
					};
				},
			) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;

			const result = await execute(
				"test-id",
				{
					title: "Test",
					questions: [
						{
							id: "scope",
							header: "Scope",
							question: "Proceed?",
							options: [
								{ label: "Yes", description: "Continue now" },
								{ label: "No", description: "Stop here" },
							],
						},
					],
				},
				undefined,
				undefined,
				{
					ui: {
						askUserQuestion: async () => ({ action: "responded", answers: { scope: { selected: ["Yes"] } } }),
					},
				},
			);

			expect(result.content[0]?.text).toContain("Yes");
		});
	});

	// ─── 2. auto-session-title ──────────────────────────────────────────

	describe("auto-session-title", () => {
		it("loads without errors and registers turn_end handler", async () => {
			const { runner } = await loadExtension("auto-session-title");
			expect(runner.hasHandlers("turn_end")).toBe(true);
		});

		it("turn_end hook fires without crash", async () => {
			const { runner } = await loadExtension("auto-session-title");

			await runner.emit({
				type: "turn_end",
				turnIndex: 0,
				message: { role: "assistant", content: [{ type: "text", text: "done" }] },
				toolResults: [],
			} as never);

			expect(runner.hasHandlers("turn_end")).toBe(true);
		});
	});

	// ─── 3. bash-ext ────────────────────────────────────────────────────

	describe("bash-ext", () => {
		it("registers bash and get_background_process tools", async () => {
			const { runner } = await loadExtension("bash-ext");
			const names = getToolNames(runner);
			expect(names).toContain("bash");
			expect(names).toContain("get_background_process");
		});

		it("registers bash channel", async () => {
			const { manager } = await loadExtension("bash-ext");
			expect(manager.has("bash")).toBe(true);
		});

		it("bash tool executes echo and returns output containing hello", async () => {
			const { runner } = await loadExtension("bash-ext");
			const tool = runner.getAllRegisteredTools().find((t) => t.definition.name === "bash");
			expect(tool).toBeDefined();

			const execute = tool!.definition.execute as unknown as (
				toolCallId: string,
				params: { command: string; description: string },
				signal: undefined,
				onUpdate: undefined,
				ctx: { cwd: string } | undefined,
			) => Promise<{ content: Array<{ type: string; text: string }> }>;

			const result = await execute(
				`bash-test-${Date.now()}`,
				{ command: "echo hello", description: "test echo" },
				undefined,
				undefined,
				{ cwd: tempDir },
			);

			expect(result.content[0]?.text).toContain("hello");
		});
	});

	// ─── 4. pi-hooks ─────────────────────────────────────────

	describe("pi-hooks", () => {
		it("registers hooks channel", async () => {
			const { manager } = await loadExtension("pi-hooks");
			expect(manager.has("hooks")).toBe(true);
		});

		it("hooks.getLog returns empty entries when no hooks configured", async () => {
			const { manager, outputs } = await loadExtension("pi-hooks");

			const data = await invokeChannelMethod(manager, outputs, "hooks", "hooks.getLog");
			expect(data).toBeDefined();

			const entries = data.entries as unknown[];
			expect(Array.isArray(entries)).toBe(true);
			expect(entries).toHaveLength(0);
		});
	});

	// ─── 5. multi-compaction ──────────────────────────────────────────

	describe("multi-compaction", () => {
		it("loads without errors", async () => {
			await loadExtension("_multi-compaction");
		});
	});

	// ─── 6. file-review ─────────────────────────────────────────────────

	describe("file-review", () => {
		it("registers file-review channel", async () => {
			const { manager } = await loadExtension("file-review");
			expect(manager.has("file-review")).toBe(true);
		});

		it("review.pending returns empty array", async () => {
			const { manager, outputs } = await loadExtension("file-review");

			const data = await invokeChannelMethod(manager, outputs, "file-review", "review.pending");
			expect(data).toBeDefined();

			const pendingResult = data.result ?? [];
			expect(Array.isArray(pendingResult)).toBe(true);
			expect(pendingResult).toHaveLength(0);
		});
	});

	// ─── 7. output-guard ────────────────────────────────────────────────

	describe("output-guard", () => {
		it("registers pdf_read tool", async () => {
			const { runner } = await loadExtension("output-guard");
			const names = getToolNames(runner);
			expect(names).toContain("pdf_read");
		});
	});

	// ─── 8. preview ─────────────────────────────────────────────────────

	describe("preview", () => {
		it("registers preview tool", async () => {
			const { runner } = await loadExtension("preview");
			const names = getToolNames(runner);
			expect(names).toContain("preview");
		});
	});

	// ─── 9. rules-engine ────────────────────────────────────────────────

	describe("rules-engine", () => {
		it("registers all 4 rules tools", async () => {
			const { runner } = await loadExtension("rules-engine");
			const names = getToolNames(runner);
			expect(names).toContain("rules_list");
			expect(names).toContain("rules_match");
			expect(names).toContain("rules_reload");
			expect(names).toContain("rules_show");
		});

		it("registers rules-engine channel", async () => {
			const { manager } = await loadExtension("rules-engine");
			expect(manager.has("rules-engine")).toBe(true);
		});

		it("registers rules command", async () => {
			const { runner } = await loadExtension("rules-engine");
			const commands = getCommandNames(runner);
			expect(commands).toContain("rules");
		});
	});

	// ─── 10. session-supervisor ─────────────────────────────────────────

	describe("session-supervisor", () => {
		it("registers supervisor_complete tool", async () => {
			const { runner } = await loadExtension("session-supervisor");
			const names = getToolNames(runner);
			expect(names).toContain("supervisor_complete");
		});

		it("marks approved supervisor_complete results as terminal", async () => {
			const { runner } = await loadExtension("session-supervisor");
			const tool = runner.getAllRegisteredTools().find((t) => t.definition.name === "supervisor_complete");
			expect(tool).toBeDefined();

			const result = await tool!.definition.execute(
				"test-supervisor-complete",
				{ summary: "done" },
				undefined,
				undefined,
				runner.createContext(),
			);

			expect(result.details).toMatchObject({ approved: true });
			expect(result.terminate).toBe(true);
		});

		it("registers supervisor channel", async () => {
			const { manager } = await loadExtension("session-supervisor");
			expect(manager.has("supervisor")).toBe(true);
		});

		it("registers 3 flags", async () => {
			const { runner } = await loadExtension("session-supervisor");
			const flags = runner.getFlags();
			expect(flags.has("disable-supervisor")).toBe(true);
			expect(flags.has("supervisor-max-continues")).toBe(true);
			expect(flags.has("supervisor-model")).toBe(true);
		});

		it("getStatus returns status with enabled field", async () => {
			const { manager, outputs } = await loadExtension("session-supervisor");

			const data = await invokeChannelMethod(manager, outputs, "supervisor", "getStatus");
			expect(data).toBeDefined();

			expect(typeof data.enabled).toBe("boolean");
		});

		it("persists enable state in the session runtime file", async () => {
			const { manager, outputs } = await loadExtension("session-supervisor");
			const runtimePath = path.join(tempDir, "supervisor-goal-runtime.json");

			const enabled = await invokeChannelMethod(manager, outputs, "supervisor", "enable");
			expect(enabled.enabled).toBe(true);
			expect(fs.existsSync(runtimePath)).toBe(true);
			expect(JSON.parse(fs.readFileSync(runtimePath, "utf-8"))).toMatchObject({ enabled: true });

			const disabled = await invokeChannelMethod(manager, outputs, "supervisor", "disable");
			expect(disabled.disabled).toBe(true);
			expect(fs.existsSync(runtimePath)).toBe(false);
		});

		it("setGoal persists and emits state without starting a new turn", async () => {
			const { manager, outputs } = await loadExtension("session-supervisor");

			const result = await invokeChannelMethod(manager, outputs, "supervisor", "setGoal", {
				objective: "finish the acceptance checklist",
			});
			const goal = result.goal as Record<string, unknown>;
			expect(goal.objective).toBe("finish the acceptance checklist");
			expect(goal.status).toBe("running");
			expect(goal.checklist).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						status: "in_progress",
						kind: "scope",
					}),
					expect.objectContaining({
						status: "pending",
						kind: "verification",
					}),
				]),
			);

			const status = await invokeChannelMethod(manager, outputs, "supervisor", "getStatus");
			expect(status.enabled).toBe(true);
			expect((status.goal as Record<string, unknown>).objective).toBe("finish the acceptance checklist");
			expect((status.goal as Record<string, unknown>).checklist).toEqual(goal.checklist);
			expect(sentMessages).toEqual([]);
		});

		it("setGoal returns fallback checklist before model refinement completes", async () => {
			const originalCallLLM = extensionActions.callLLM;
			let resolveCall: ((value: string) => void) | undefined;
			let callStarted = false;
			extensionActions.callLLM = async () => {
				callStarted = true;
				return new Promise<string>((resolve) => {
					resolveCall = resolve;
				});
			};

			try {
				const { manager, outputs } = await loadExtension("session-supervisor");
				const startedAt = Date.now();
				const result = await invokeChannelMethod(manager, outputs, "supervisor", "setGoal", {
					objective: "create slow-checklist.txt and verify it",
				});
				const elapsedMs = Date.now() - startedAt;
				const goal = result.goal as Record<string, unknown>;
				const initialChecklist = goal.checklist as Array<Record<string, unknown>>;

				expect(elapsedMs).toBeLessThan(500);
				expect(goal.id).toBeTruthy();
				expect(initialChecklist[0]?.kind).toBe("scope");
				expect(initialChecklist[0]?.status).toBe("in_progress");
				expect(callStarted).toBe(true);

				resolveCall?.(
					JSON.stringify({
						items: [
							{ text: "model refined scope", kind: "scope" },
							{ text: "model refined implementation", kind: "implementation" },
							{ text: "model refined verification", kind: "verification" },
						],
					}),
				);
				await new Promise((resolve) => setTimeout(resolve, 30));

				const status = await invokeChannelMethod(manager, outputs, "supervisor", "getStatus");
				const refinedGoal = status.goal as Record<string, unknown>;
				const refinedChecklist = refinedGoal.checklist as Array<Record<string, unknown>>;
				expect(refinedChecklist[0]).toMatchObject({
					text: "model refined scope",
					status: "in_progress",
				});
			} finally {
				extensionActions.callLLM = originalCallLLM;
			}
		});

		it("restores a running goal on session_start without starting a new turn", async () => {
			const now = Date.now();
			fs.writeFileSync(
				path.join(tempDir, "supervisor-goal-runtime.json"),
				JSON.stringify({
					enabled: true,
					activeGoal: {
						id: "goal_restore_test",
						objective: "restore without auto-run",
						status: "running",
						startedAt: now,
						updatedAt: now,
						continuationCount: 0,
						blockers: [],
					},
				}),
				"utf-8",
			);

			const { manager, outputs } = await loadExtension("session-supervisor");
			const status = await invokeChannelMethod(manager, outputs, "supervisor", "getStatus");
			expect(status.enabled).toBe(true);
			expect(status.state).toBe("idle");
			expect((status.goal as Record<string, unknown>).objective).toBe("restore without auto-run");
			expect(sentMessages).toEqual([]);
		});

		it("restores trigger history and task reports from session logs on session_start", async () => {
			const startedAt = Date.now() - 10_000;
			const logDir = path.join(tempDir, "supervisor-logs");
			fs.mkdirSync(logDir, { recursive: true });
			fs.writeFileSync(
				path.join(logDir, "trigger-restore-test.json"),
				JSON.stringify({
					seq: 7,
					startedAt,
					finishedAt: startedAt + 4500,
					durationMs: 4500,
					verdict: "complete",
					confidence: 0.93,
					guardResults: [
						{
							guardName: "incomplete-keywords",
							guardType: "keyword",
							passed: true,
							confidence: 1,
							remainingItems: [],
							detail: "No incomplete keywords",
							durationMs: 3,
						},
					],
					modelCheck: {
						passed: true,
						confidence: 0.9,
						response: "All good",
						durationMs: 4497,
						model: "fast",
					},
					action: "complete",
					reason: "All guards and model check passed",
				}),
				"utf-8",
			);

			const { manager, outputs } = await loadExtension("session-supervisor");
			const history = await invokeChannelMethod(manager, outputs, "supervisor", "getTriggerHistory", { limit: 50 });
			expect(history.triggers).toHaveLength(1);
			expect((history.triggers as Array<Record<string, unknown>>)[0]).toMatchObject({
				seq: 7,
				verdict: "complete",
				action: "complete",
				modelCheck: { model: "fast" },
			});

			const report = await invokeChannelMethod(manager, outputs, "supervisor", "getTaskReport");
			expect(report.tasks).toEqual([
				expect.objectContaining({
					guardName: "incomplete-keywords",
					guardType: "keyword",
					status: "completed",
				}),
			]);
		});

		it("requestPause and cancelPause are visible through getStatus", async () => {
			const { manager, outputs } = await loadExtension("session-supervisor");

			await invokeChannelMethod(manager, outputs, "supervisor", "enable");
			const pause = await invokeChannelMethod(manager, outputs, "supervisor", "requestPause", {
				delayMs: 60_000,
				reason: "test pause",
			});
			expect(pause.scheduled).toBe(true);

			const pausedStatus = await invokeChannelMethod(manager, outputs, "supervisor", "getStatus");
			expect(pausedStatus.state).toBe("paused");
			expect(pausedStatus.pendingPause).toMatchObject({
				delayMs: 60_000,
				reason: "test pause",
			});

			const cancel = await invokeChannelMethod(manager, outputs, "supervisor", "cancelPause");
			expect(cancel.cancelled).toBe(true);

			const resumedStatus = await invokeChannelMethod(manager, outputs, "supervisor", "getStatus");
			expect(resumedStatus.state).toBe("idle");
			expect(resumedStatus.pendingPause).toBeUndefined();
		});

		it("clearGoal removes the active goal from getStatus", async () => {
			const { manager, outputs } = await loadExtension("session-supervisor");

			await invokeChannelMethod(manager, outputs, "supervisor", "enable");
			await invokeChannelMethod(manager, outputs, "supervisor", "setGoal", {
				objective: "clear me",
			});

			const cleared = await invokeChannelMethod(manager, outputs, "supervisor", "clearGoal", {
				reason: "test clear",
			});
			expect(cleared.cleared).toBe(true);

			const status = await invokeChannelMethod(manager, outputs, "supervisor", "getStatus");
			expect(status.goal).toBeUndefined();
			expect(status.lastGoldResult).toBeUndefined();
		});

		it("does not re-run gold checks after a goal is already complete", async () => {
			const { runner, manager, outputs } = await loadExtension("session-supervisor");

			await invokeChannelMethod(manager, outputs, "supervisor", "setGoal", {
				objective: "create the acceptance marker",
			});

			const agentEndEvent = {
				type: "agent_end",
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "The acceptance marker was created and the task is complete.",
							},
						],
					},
				],
			} as never;

			await runner.emit(agentEndEvent);
			const firstStatus = await invokeChannelMethod(manager, outputs, "supervisor", "getStatus");
			expect((firstStatus.goal as Record<string, unknown>).status).toBe("complete");

			const firstTriggerCount = outputs.filter(
				(msg) => msg.name === "supervisor" && (msg.data as Record<string, unknown>).type === "triggerRecord",
			).length;
			const firstSentCount = sentMessages.length;

			await runner.emit(agentEndEvent);

			const secondTriggerCount = outputs.filter(
				(msg) => msg.name === "supervisor" && (msg.data as Record<string, unknown>).type === "triggerRecord",
			).length;
			expect(secondTriggerCount).toBe(firstTriggerCount);
			expect(sentMessages.length).toBe(firstSentCount);
		});
	});

	// ─── 11. todo-ext ───────────────────────────────────────────────────

	describe("todo-ext", () => {
		it("registers todo tool", async () => {
			const { runner } = await loadExtension("todo-ext");
			const names = getToolNames(runner);
			expect(names).toContain("todo");
		});

		it("registers todo channel", async () => {
			const { manager } = await loadExtension("todo-ext");
			expect(manager.has("todo")).toBe(true);
		});

		it("registers todos command", async () => {
			const { runner } = await loadExtension("todo-ext");
			const commands = getCommandNames(runner);
			expect(commands).toContain("todos");
		});
	});

	// ─── 12. auto-memory ────────────────────────────────────────────────

	describe("auto-memory", () => {
		it("registers create_bookmark tool", async () => {
			const { runner } = await loadExtension("auto-memory");
			const names = getToolNames(runner);
			expect(names).toContain("create_bookmark");
		});

		it("registers memory channel", async () => {
			const { manager } = await loadExtension("auto-memory");
			expect(manager.has("memory")).toBe(true);
		});
	});

	// ─── 13. agent-permissions ──────────────────────────────────────────

	describe("agent-permissions", () => {
		it("loads without errors and survives session_start", async () => {
			const { runner } = await loadExtension("agent-permissions");
			expect(runner.hasHandlers("tool_call")).toBe(true);
		});
	});
});
