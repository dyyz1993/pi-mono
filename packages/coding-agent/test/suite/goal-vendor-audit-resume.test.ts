/**
 * Crash-resume regression tests for goal-vendor's auditing state.
 *
 * finishAudit persists status "auditing" before running checks and the isolated
 * auditor. If the process dies mid-audit (crash, kill, restart), the in-flight
 * audit chain is lost. session_start must re-enter finishAudit from the
 * persisted state; otherwise the goal is stuck in "auditing" forever and every
 * run-phase tool rejects with "No running goal".
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../../extensions/goal-vendor/state.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ChannelManager } from "../../src/core/extensions/channel-manager.ts";
import type { ChannelDataMessage, ChannelOutputFn } from "../../src/core/extensions/channel-types.ts";
import { discoverAndLoadExtensions } from "../../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions, ToolInfo } from "../../src/core/extensions/types.ts";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

let mockTools: ToolInfo[] = [];

function goalVendorSourcePath(): string {
	const here = path.dirname(new URL(import.meta.url).pathname);
	return path.resolve(here, "../../extensions/goal-vendor/index.ts");
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
	return outputs.find((m) => m.name === channelName && (m.data as Record<string, unknown>)?.invokeId === invokeId)
		?.data as Record<string, unknown> | undefined;
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
	getAllTools: () => mockTools,
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

describe("goal-vendor auditing crash resume", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-audit-resume-")));
		mockTools = [];
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = tempDir;
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
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

	function mirrorStatePath(): string {
		const id = sha256(sessionManager.getSessionId()).slice(0, 24);
		return path.join(tempDir, "pi-goal", "sessions", id, "state.json");
	}

	async function driveToRunningGoal(): Promise<void> {
		const first = await loadGoalVendor();
		await invokeChannelMethod(first.manager, first.outputs, "goal", "startSetup", {
			objective: "create report.txt in the workspace",
		});
		const submitted = await invokeChannelMethod(first.manager, first.outputs, "goal", "submitContract", {
			outcome: "create report.txt in the workspace",
			criteria: ["report.txt exists in the workspace"],
			phases: [{ id: "P1", title: "create the report", criterionIds: ["AC1"] }],
			verificationChecks: [{ id: "V1", kind: "file_exists", path: "report.txt", label: "report exists" }],
			authorities: [],
		});
		expect(submitted.submitted).toBe(true);
		const approved = await invokeChannelMethod(first.manager, first.outputs, "goal", "approveContract");
		expect(approved.approved).toBe(true);
	}

	it("re-enters the audit pipeline after a restart instead of staying stuck in auditing", async () => {
		await driveToRunningGoal();

		// Simulate a process death mid-finishAudit: the persisted state says
		// "auditing" but no audit is in flight anymore.
		const statePath = mirrorStatePath();
		expect(fs.existsSync(statePath)).toBe(true);
		const crashed = JSON.parse(fs.readFileSync(statePath, "utf8")) as { status: string; revision: number };
		expect(crashed.status).toBe("running");
		crashed.status = "auditing";
		crashed.revision += 1;
		fs.writeFileSync(statePath, JSON.stringify(crashed));

		// Fresh process: new extension instance, empty in-memory store, same disk.
		const restarted = await loadGoalVendor();
		const status = await invokeChannelMethod(restarted.manager, restarted.outputs, "goal", "getStatus");
		expect(status.rawStatus).not.toBe("auditing");
		// The failing file_exists check routes into verification-failure recovery
		// (status "running"), which is the goal's normal autonomous path.
		expect(status.rawStatus).toBe("running");
	});

	it("does not lose a healthy running goal across restart", async () => {
		await driveToRunningGoal();

		const restarted = await loadGoalVendor();
		const status = await invokeChannelMethod(restarted.manager, restarted.outputs, "goal", "getStatus");
		expect(status.rawStatus).toBe("running");
	});
});

describe("goal-vendor provider-error turn resume", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-err-resume-")));
		mockTools = [];
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = tempDir;
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function loadGoalVendor(): Promise<{
		runner: ExtensionRunner;
		manager: ChannelManager;
		outputs: ChannelDataMessage[];
		sent: Array<Record<string, unknown>>;
	}> {
		const result = await discoverAndLoadExtensions([goalVendorSourcePath()], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const sent: Array<Record<string, unknown>> = [];
		(extensionActions as { sendMessage: unknown }).sendMessage = (message: Record<string, unknown>) => {
			sent.push(message);
		};

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
		return { runner, manager, outputs, sent };
	}

	function errorTurn(): { type: "agent_end"; messages: unknown[] } {
		return {
			type: "agent_end",
			messages: [
				{ role: "assistant", stopReason: "error", errorMessage: "HTTP 400: messages parameter is illegal" },
			],
		};
	}

	async function driveToRunningGoal(): Promise<{
		runner: ExtensionRunner;
		manager: ChannelManager;
		outputs: ChannelDataMessage[];
		sent: Array<Record<string, unknown>>;
	}> {
		const loaded = await loadGoalVendor();
		await invokeChannelMethod(loaded.manager, loaded.outputs, "goal", "startSetup", {
			objective: "create report.txt in the workspace",
		});
		const submitted = await invokeChannelMethod(loaded.manager, loaded.outputs, "goal", "submitContract", {
			outcome: "create report.txt in the workspace",
			criteria: ["report.txt exists in the workspace"],
			phases: [{ id: "P1", title: "create the report", criterionIds: ["AC1"] }],
			verificationChecks: [
				{
					id: "V1",
					kind: "file_exists",
					path: path.join(fs.realpathSync(tempDir), "report.txt"),
					label: "report exists",
				},
			],
			authorities: [],
		});
		expect(submitted.submitted).toBe(true);
		const approved = await invokeChannelMethod(loaded.manager, loaded.outputs, "goal", "approveContract");
		expect(approved.approved).toBe(true);
		loaded.sent.length = 0;
		return loaded;
	}

	it("auto-resumes a running goal when the turn ends with a provider error", async () => {
		const { runner, manager, outputs, sent } = await driveToRunningGoal();
		await runner.emit(errorTurn() as never);
		const continuations = sent.filter((m) => m.customType === "pi-goal-continuation-v1");
		expect(continuations.length).toBe(1);
		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.rawStatus).toBe("running");
		expect(status.interrupt).toBeUndefined();
	});

	it("resets the consecutive-error counter after a clean turn", async () => {
		const { runner, manager, outputs, sent } = await driveToRunningGoal();
		await runner.emit(errorTurn() as never);
		await runner.emit(errorTurn() as never);
		// clean turn resets the bounded counter
		await runner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "toolUse" }] } as never);
		await runner.emit(errorTurn() as never);
		await runner.emit(errorTurn() as never);
		// only 2 consecutive since the reset: still auto-resuming, no interrupt
		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.rawStatus).toBe("running");
		expect(status.interrupt).toBeUndefined();
		void runner;
	});

	it("escalates to a BLOCKER interrupt after more than three consecutive error turns", async () => {
		const { runner, manager, outputs, sent } = await driveToRunningGoal();
		for (let i = 0; i < 4; i++) await runner.emit(errorTurn() as never);
		// 3 resumes + 1 capping turn
		const continuations = sent.filter((m) => m.customType === "pi-goal-continuation-v1");
		expect(continuations.length).toBe(3);
		const status = await invokeChannelMethod(manager, outputs, "goal", "getStatus");
		expect(status.rawStatus).toBe("interrupted");
		expect((status.interrupt as { class?: string } | undefined)?.class).toBe("BLOCKER");
	});
});
