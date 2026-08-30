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
let activeTools: string[] = [];

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
	getActiveTools: () => activeTools,
	getAllTools: () => [],
	setActiveTools: (toolNames) => {
		activeTools = toolNames;
	},
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
	getSettings: () => ({}),
};

// ─── Test suite ────────────────────────────────────────────────────────────

describe("Built-in Extensions", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		sentMessages = [];
		activeTools = [];
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

	// ─── 12. learning ───────────────────────────────────────────────────

	describe("learning", () => {
		it("registers memory tools", async () => {
			const { runner } = await loadExtension("learning");
			const names = getToolNames(runner);
			expect(names).toContain("create_bookmark");
			expect(names).toContain("save_memory");
		});

		it("registers the learning channel", async () => {
			const { manager } = await loadExtension("learning");
			expect(manager.has("learning")).toBe(true);
			expect(manager.has("memory")).toBe(false);
		});
	});
});
