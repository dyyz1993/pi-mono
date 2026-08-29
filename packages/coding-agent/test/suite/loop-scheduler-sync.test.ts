/**
 * becomeScheduler settings-sync regression tests for loop-scheduler.
 *
 * Reproduces the deployed-server failure: a warm-pool process adopts a session
 * (session_start) BEFORE the frontend persists loopScheduler settings, so its
 * jobs map is empty. Later becomeScheduler() must force-acquire the lock AND
 * sync loops from settings, otherwise the loop runs invisibly on another
 * instance while getStatus/list report nothing.
 *
 * Same harness pattern as goal-vendor-channel.test.ts.
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
import type { ExtensionActions, ExtensionContextActions, ToolInfo } from "../../src/core/extensions/types.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loopSchedulerSourcePath(): string {
	return path.resolve(__dirname, "../../extensions/loop-scheduler/index.ts");
}

interface TestLoopConfig {
	id: string;
	name: string;
	enabled: boolean;
	cron: string;
	prompt: string;
	deliverAs: "followUp" | "steer";
}

function makeLoop(id: string): TestLoopConfig {
	return {
		id,
		name: `loop-${id}`,
		enabled: true,
		cron: "* * * * *",
		prompt: "test prompt",
		deliverAs: "followUp",
	};
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
	getAllTools: (): ToolInfo[] => [],
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
	callLLM: async () => "ok",
};

describe("loop-scheduler becomeScheduler settings sync", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;
	let settingsState: Record<string, unknown>;
	let runners: ExtensionRunner[];

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-loop-scheduler-sync-"));
		settingsState = {};
		runners = [];
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
		// 模拟预热池进程：init 时不抢锁（factory 在 discover 阶段就运行，
		// 此时 setContextDirFns 还没接管 getGlobalDataDir）。锁竞争推迟到
		// becomeScheduler——正是生产上"adopt 早于 persist"的问题路径。
		process.env.PI_WARM_STANDBY = "1";
	});

	afterEach(async () => {
		for (const runner of runners) {
			try {
				await runner.emit({ type: "session_shutdown", reason: "quit" });
			} catch {
				// already shut down
			}
		}
		delete process.env.PI_WARM_STANDBY;
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	/** Pre-write a fresh lock held by a foreign pid — simulates a zombie/other
	 *  CLI process heartbeating the scheduler lease. */
	function writeForeignLock(): void {
		const lockDir = path.join(tempDir, "loop-scheduler");
		fs.mkdirSync(lockDir, { recursive: true });
		fs.writeFileSync(path.join(lockDir, "loop-scheduler.lock"), JSON.stringify({ pid: 999999, ts: Date.now() }));
	}

	async function loadLoopScheduler(): Promise<{ manager: ChannelManager; outputs: ChannelDataMessage[] }> {
		const result = await discoverAndLoadExtensions([loopSchedulerSourcePath()], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const contextActions: ExtensionContextActions = {
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
			getSettings: () => settingsState,
		};

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(extensionActions, contextActions);
		runners.push(runner);

		const { manager, outputs } = createCapturingChannelManager();
		runner.flushPendingChannels((name) => manager.register(name));
		runner.updateRegisterChannel((name) => manager.register(name));

		runner.setContextDirFns({
			getProjectRoot: () => tempDir,
			getSessionDataDir: () => tempDir,
			getProjectDataDir: () => tempDir,
			getCwdDataDir: () => tempDir,
			getGlobalDataDir: () => tempDir,
		});

		await runner.emit({ type: "session_start", reason: "startup" });
		return { manager, outputs };
	}

	it("becomeScheduler syncs loops from settings when jobs map was empty (adopt-before-persist)", async () => {
		writeForeignLock();
		const { manager, outputs } = await loadLoopScheduler();

		// settings empty at session_start → jobs empty
		const statusBefore = await invokeChannelMethod(manager, outputs, "loop-scheduler", "getStatus");
		expect(statusBefore.loops).toEqual([]);

		// frontend persists the loop AFTER our session_start already ran
		const loopA = makeLoop("loop-a");
		settingsState = { loopScheduler: { loops: [loopA] } };

		// becomeScheduler must force-acquire the lock and sync from settings
		const become = await invokeChannelMethod(manager, outputs, "loop-scheduler", "becomeScheduler");
		console.log("become response:", JSON.stringify(become));
		expect(become.ok).toBe(true);

		const status = await invokeChannelMethod(manager, outputs, "loop-scheduler", "getStatus");
		console.log("status after become:", JSON.stringify(status));
		const loops = status.loops as Array<{ id: string; isRunning: boolean; nextRun: number | null }>;
		expect(loops).toHaveLength(1);
		expect(loops[0].id).toBe("loop-a");
		expect(loops[0].isRunning).toBe(true);
		expect(loops[0].nextRun).not.toBeNull();

		const list = await invokeChannelMethod(manager, outputs, "loop-scheduler", "list");
		expect(list.isScheduler).toBe(true);
	});

	it("becomeScheduler does not duplicate loops already in jobs (additive sync)", async () => {
		writeForeignLock();
		const { manager, outputs } = await loadLoopScheduler();

		// create while NOT scheduler → recorded but unscheduled
		const loopB = makeLoop("loop-b");
		const created = await invokeChannelMethod(manager, outputs, "loop-scheduler", "create", {
			name: loopB.name,
			cron: loopB.cron,
			prompt: loopB.prompt,
			deliverAs: loopB.deliverAs,
		});
		expect(created.ok).toBe(true);

		// frontend persists; settings now contain the same loop
		settingsState = { loopScheduler: { loops: [{ ...loopB, id: created.id as string }] } };

		const become = await invokeChannelMethod(manager, outputs, "loop-scheduler", "becomeScheduler");
		expect(become.ok).toBe(true);

		const status = await invokeChannelMethod(manager, outputs, "loop-scheduler", "getStatus");
		const loops = status.loops as Array<{ id: string; isRunning: boolean }>;
		expect(loops).toHaveLength(1);
		expect(loops[0].id).toBe(created.id);
		expect(loops[0].isRunning).toBe(true);
	});
});
