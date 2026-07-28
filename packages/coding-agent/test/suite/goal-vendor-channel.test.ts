/**
 * Channel method tests for goal-vendor's "goal" channel.
 *
 * Uses the same ExtensionRunner + ChannelManager harness pattern as
 * builtin-extensions.test.ts. Invokes channel methods via the JSONL
 * channel_data protocol and asserts return shapes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ChannelManager } from "../../src/core/extensions/channel-manager.ts";
import type { ChannelDataMessage, ChannelOutputFn } from "../../src/core/extensions/channel-types.ts";
import { discoverAndLoadExtensions } from "../../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions } from "../../src/core/extensions/types.ts";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function goalVendorSourcePath(): string {
	return path.resolve(__dirname, "../../extensions/goal-vendor/index.ts");
}

function createCapturingChannelManager(): { manager: ChannelManager; outputs: ChannelDataMessage[] } {
	const outputs: ChannelDataMessage[] = [];
	const outputFn: ChannelOutputFn = (msg) => {
		outputs.push(msg);
	};
	return { manager: new ChannelManager(outputFn), outputs };
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

const extensionActions: ExtensionActions = {
	sendMessage: () => {},
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
	callLLM: async () => "refined objective",
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

describe("goal-vendor channel", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-vendor-channel-"));
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function loadGoalVendor(): Promise<{
		runner: ExtensionRunner;
		manager: ChannelManager;
		outputs: ChannelDataMessage[];
	}> {
		const result = await discoverAndLoadExtensions([goalVendorSourcePath()], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, extensionContextActions);

		const { manager, outputs } = createCapturingChannelManager();
		runner.flushPendingChannels((name) => manager.register(name));
		runner.updateRegisterChannel((name) => manager.register(name));

		const storeDir = path.join(tempDir, ".pi-snapshot-store");
		fs.mkdirSync(storeDir, { recursive: true });
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

	it("registers a 'goal' channel", async () => {
		const { manager } = await loadGoalVendor();
		expect(manager.has("goal")).toBe(true);
	});

	it("getStatus returns idle status when no goal is active", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(response.state).toBe("idle");
		expect(response.enabled).toBe(true);
		expect(response.rawStatus).toBe("none");
	});

	it("disable sets enabled=false and state=disabled", async () => {
		const { manager, outputs } = await loadGoalVendor();
		await invokeChannelMethod(manager, outputs, "goal", "disable");
		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.enabled).toBe(false);
		expect(status.state).toBe("disabled");
	});

	it("enable restores enabled=true", async () => {
		const { manager, outputs } = await loadGoalVendor();
		await invokeChannelMethod(manager, outputs, "goal", "disable");
		await invokeChannelMethod(manager, outputs, "goal", "enable");
		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.enabled).toBe(true);
	});

	it("getTaskReport returns empty tasks when no goal is active", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "getTaskReport");
		expect(response.tasks).toEqual([]);
	});

	it("getTriggerHistory returns empty triggers when no events logged", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "getTriggerHistory");
		expect(response.triggers).toEqual([]);
	});

	it("refineGoal returns a refined objective", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "refineGoal", {
			objective: "build a feature",
		});
		expect(response.success).toBe(true);
		expect(typeof response.objective).toBe("string");
	});

	it("refineGoal rejects empty objective", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "refineGoal", { objective: "" });
		expect(response.success).toBe(false);
		expect(response.error).toBeDefined();
	});

	it("approveContract fails when no goal is awaiting approval", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "approveContract");
		expect(response.approved).toBe(false);
	});

	it("clearGoal returns cleared=false when no goal exists", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "clearGoal");
		expect(response.cleared).toBe(false);
	});

	it("forceContinue returns triggered=false when no active goal", async () => {
		const { manager, outputs } = await loadGoalVendor();
		const response = await invokeChannelMethod(manager, outputs, "goal", "forceContinue");
		expect(response.triggered).toBe(false);
	});
});
