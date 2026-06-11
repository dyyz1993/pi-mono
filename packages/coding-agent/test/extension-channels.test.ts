/**
 * Tests for extension channel handlers — file-review and file-snapshot.
 *
 * These tests load the actual built-in extensions and verify their channel
 * handler registration and behavior.
 */

import * as fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ChannelManager } from "../src/core/extensions/channel-manager.ts";
import type { ChannelDataMessage, ChannelOutputFn } from "../src/core/extensions/channel-types.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type {
	ExtensionActions,
	ExtensionContext,
	ExtensionContextActions,
	ProviderConfig,
} from "../src/core/extensions/types.ts";
import { FileSnapshotManager } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";
import { SessionManager } from "../src/core/session-manager.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the path to a built-in extension in dist/extensions/.
 */
function builtinExtensionPath(name: string): string {
	return path.resolve(__dirname, `../dist/extensions/${name}/index.ts`);
}

/**
 * Create a ChannelManager whose outputFn captures all sent messages.
 * Returns the manager and an array that collects output messages.
 */
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

/**
 * Find the response for a given invokeId in the captured outputs.
 */
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

// ─── Test setup ────────────────────────────────────────────────────────────

describe("Extension Channel Integration", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	const extensionActions: ExtensionActions = {
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => undefined,
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

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-channels-test-"));
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// ─── file-review channel ───────────────────────────────────────────────

	describe("file-review channel", () => {
		it("registers the file-review channel on load", async () => {
			const extPath = builtinExtensionPath("file-review");
			expect(fs.existsSync(extPath)).toBe(true);

			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			expect(result.errors).toEqual([]);
			expect(result.extensions).toHaveLength(1);

			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			expect(manager.has("file-review")).toBe(true);
			expect(result.runtime.resolvedChannels.has("file-review")).toBe(true);
		});

		it("review.pending returns empty when no changes recorded", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.pending", invokeId: "test-pending-1" },
			});

			const data = findResponse(outputs, "file-review", "test-pending-1");
			expect(data).toBeDefined();
			const pendingResult = data!.result ?? [];
			expect(Array.isArray(pendingResult)).toBe(true);
			expect(pendingResult).toHaveLength(0);
		});

		it("review.summary returns empty array when no turns recorded", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.summary", invokeId: "test-summary-1" },
			});

			const data = findResponse(outputs, "file-review", "test-summary-1");
			expect(data).toBeDefined();
			expect(data!.result).toEqual([]);
		});

		it("review.history returns empty array when no turns recorded", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.history", invokeId: "test-history-1" },
			});

			const data = findResponse(outputs, "file-review", "test-history-1");
			expect(data).toBeDefined();
			expect(data!.result).toEqual([]);
		});

		it("review.clear clears the turn log and returns ok", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.clear", invokeId: "test-clear-1" },
			});

			const data = findResponse(outputs, "file-review", "test-clear-1");
			expect(data).toBeDefined();
			expect(data!.ok).toBe(true);
		});

		it("review.approve returns ok for any path", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			runner.bindCore(extensionActions, extensionContextActions);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: {
					__call: "review.approve",
					path: "src/test.ts",
					invokeId: "test-approve-1",
				},
			});

			const data = findResponse(outputs, "file-review", "test-approve-1");
			expect(data).toBeDefined();
			expect(data!.ok).toBe(true);
		});

		it("review.live returns turnIndex and changes array", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.live", invokeId: "test-live-1" },
			});

			const data = findResponse(outputs, "file-review", "test-live-1");
			expect(data).toBeDefined();
			expect(data!.turnIndex).toBe(-1);
			expect(data!.changes).toEqual([]);
		});

		it("review.approvals returns empty array initially", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			runner.bindCore(extensionActions, extensionContextActions);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.approvals", invokeId: "test-appr-1" },
			});

			const data = findResponse(outputs, "file-review", "test-appr-1");
			expect(data).toBeDefined();
			expect(data!.result).toEqual([]);
		});

		it("review.fileHistory returns empty for unknown path", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: {
					__call: "review.fileHistory",
					path: "nonexistent.ts",
					invokeId: "test-fh-1",
				},
			});

			const data = findResponse(outputs, "file-review", "test-fh-1");
			expect(data).toBeDefined();
			expect(data!.result).toEqual([]);
		});

		it("review.history filters by fromTurn", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: {
					__call: "review.history",
					fromTurn: 5,
					invokeId: "test-hist-filter-1",
				},
			});

			const data = findResponse(outputs, "file-review", "test-hist-filter-1");
			expect(data).toBeDefined();
			expect(data!.result).toEqual([]);
		});

		it("review.approveAll returns count of zero when nothing pending", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			runner.bindCore(extensionActions, extensionContextActions);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.approveAll", invokeId: "test-aa-1" },
			});

			const data = findResponse(outputs, "file-review", "test-aa-1");
			expect(data).toBeDefined();
			expect(data!.count).toBe(0);
		});
	});

	// ─── file-review reject flow tests (need real snapshot context) ──────

	describe("file-review reject flows", () => {
		const appendEntry = ((type: string) => `entry-${type}-${Date.now()}`) as unknown as (type: string, data: unknown) => string;

		async function setupFileReviewChannel() {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			expect(result.errors).toEqual([]);

			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(extensionActions, extensionContextActions);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			const storeDir = path.join(tempDir, ".pi-review-store");
			mkdirSync(storeDir, { recursive: true });
			const git = new InternalGit(storeDir);
			const snapshotManager = new FileSnapshotManager(git);
			snapshotManager.initialize(tempDir);

			// Wire into runner context + fire session_start to capture ctx
			runner.setFileSnapshotManagerFn(() => snapshotManager);
			runner.setContextDirFns({
				getProjectRoot: () => tempDir,
				getSessionDataDir: () => tempDir,
				getProjectDataDir: () => tempDir,
				getCwdDataDir: () => tempDir,
				getGlobalDataDir: () => tempDir,
			});
			await runner.emit({ type: "session_start", reason: "startup" });

			return { manager, outputs, runner, snapshotManager, tempDir };
		}

		it("review.reject deletes an added file from disk", async () => {
			const { manager, outputs, snapshotManager, runner } = await setupFileReviewChannel();

			writeFileSync(path.join(tempDir, "add.txt"), "v1\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);
			await runner.emit({ type: "turn_end", turnIndex: 0, message: {} as never, toolResults: [] });

			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.reject", path: "add.txt", invokeId: "rr-1" },
			});
			await new Promise((r) => setTimeout(r, 50));
			const rejectData = findResponse(outputs, "file-review", "rr-1");
			expect(rejectData).toBeDefined();
			expect(rejectData!.ok).toBe(true);
			expect(existsSync(path.join(tempDir, "add.txt"))).toBe(false);
		});

		it("reject then re-create — file is on disk and discoverable", async () => {
			const { manager, outputs, snapshotManager, runner } = await setupFileReviewChannel();

			writeFileSync(path.join(tempDir, "again.txt"), "v1\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);
			await runner.emit({ type: "turn_end", turnIndex: 0, message: {} as never, toolResults: [] });

			// Reject → file deleted from disk
			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.reject", path: "again.txt", invokeId: "rr-2" },
			});
			await new Promise((r) => setTimeout(r, 50));
			const rejectData = findResponse(outputs, "file-review", "rr-2");
			expect(rejectData).toBeDefined();
			expect(rejectData!.ok).toBe(true);
			expect(existsSync(path.join(tempDir, "again.txt"))).toBe(false);

			// Re-create the file in a new turn
			writeFileSync(path.join(tempDir, "again.txt"), "v2-again\n");
			snapshotManager.onTurnEnd(tempDir, 1, appendEntry);
			await runner.emit({ type: "turn_end", turnIndex: 1, message: {} as never, toolResults: [] });

			// File should be on disk and discoverable via getLiveChanges
			expect(existsSync(path.join(tempDir, "again.txt"))).toBe(true);
			expect(readFileSync(path.join(tempDir, "again.txt"), "utf-8")).toBe("v2-again\n");
		});
	});

	// ─── file-snapshot channel ─────────────────────────────────────────────

	describe("file-snapshot channel", () => {
		it("registers the file-snapshot channel on load", async () => {
			const extPath = builtinExtensionPath("file-snapshot");
			expect(fs.existsSync(extPath)).toBe(true);

			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			expect(result.errors).toEqual([]);
			expect(result.extensions).toHaveLength(1);

			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			expect(manager.has("file-snapshot")).toBe(true);
			expect(result.runtime.resolvedChannels.has("file-snapshot")).toBe(true);
		});

		// file-snapshot uses createTypedChannel (ServerChannel with __call routing).
		// Responses are sent via channel.send(), not returned from onReceive.
		// Context (including fileSnapshotManager) is captured via session_start event.

		const snapshotActions: ExtensionActions = {
			...extensionActions,
			appendEntry: ((type: string) => `entry-${type}-${Date.now()}`) as unknown as ExtensionActions["appendEntry"],
		};
		const appendEntry = snapshotActions.appendEntry as unknown as (type: string) => string;

		let snapshotInvokeCounter = 0;

		async function invokeSnapshotMethod(
			manager: ChannelManager,
			outputs: ChannelDataMessage[],
			method: string,
			params?: Record<string, unknown>,
		): Promise<unknown> {
			const invokeId = `snap-test-${++snapshotInvokeCounter}`;
			manager.handleInbound({
				type: "channel_data",
				name: "file-snapshot",
				data: { __call: method, ...(params ?? {}), invokeId },
			});

			// Wait for async response (handlers may be async)
			for (let i = 0; i < 100; i++) {
				const response = findResponse(outputs, "file-snapshot", invokeId);
				if (response) {
					const { invokeId: _, ...rest } = response;
					// Array results are wrapped as { result: [...] }
					if ("result" in rest && Array.isArray(rest.result)) return rest.result;
					return Object.keys(rest).length > 0 ? rest : null;
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			throw new Error(`No response for snapshot.${method} within timeout`);
		}

		async function setupSnapshotChannel() {
			const extPath = builtinExtensionPath("file-snapshot");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			expect(result.errors).toEqual([]);

			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(snapshotActions, extensionContextActions);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			const storeDir = path.join(tempDir, ".pi-snapshot-store");
			mkdirSync(storeDir, { recursive: true });
			const git = new InternalGit(storeDir);
			const snapshotManager = new FileSnapshotManager(git);
			snapshotManager.initialize(tempDir);

			// Wire FileSnapshotManager + directory fns into runner context
			runner.setFileSnapshotManagerFn(() => snapshotManager);
			runner.setContextDirFns({
				getProjectRoot: () => tempDir,
				getSessionDataDir: () => tempDir,
				getProjectDataDir: () => tempDir,
				getCwdDataDir: () => tempDir,
				getGlobalDataDir: () => tempDir,
			});

			// Fire session_start so the extension captures ctx with fileSnapshotManager
			await runner.emit({ type: "session_start", reason: "startup" });

			return { manager, outputs, runner, snapshotManager, git, storeDir };
		}

		it("snapshot.list returns empty list when no snapshots recorded", async () => {
			const { manager, outputs } = await setupSnapshotChannel();

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.list");

			expect(Array.isArray(result)).toBe(true);
			expect(result).toHaveLength(0);
		});

		it("snapshot.list returns modified files after a turn", async () => {
			const { manager, outputs, snapshotManager } = await setupSnapshotChannel();

			// Simulate file changes
			writeFileSync(path.join(tempDir, "new-file.txt"), "content\n");

			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.list");

			expect(Array.isArray(result)).toBe(true);
			expect((result as unknown[]).length).toBeGreaterThan(0);
			const files = result as Array<Record<string, unknown>>;
			const newFile = files.find((f) => f.path === "new-file.txt");
			expect(newFile).toBeDefined();
			expect(newFile!.status).toBe("added");
		});

		it("snapshot.get returns null for unknown entry ID", async () => {
			const { manager, outputs } = await setupSnapshotChannel();

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.get", {
				snapshotId: "nonexistent-id",
			});

			expect(result).toBeNull();
		});

		it("snapshot.get returns snapshot data for valid entry ID", async () => {
			const { manager, outputs, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "test.txt"), "hello\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const snapshots = snapshotManager.getModifiedFiles({});
			expect(snapshots.length).toBeGreaterThan(0);
			const entryId = snapshots[0]!.entryId;

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.get", { snapshotId: entryId });

			expect(result).toBeDefined();
			expect(result).not.toBeNull();
			const snapshot = result as Record<string, unknown>;
			expect(snapshot.id).toBe(entryId);
			expect(snapshot.stepIndex).toBe(0);
			expect(snapshot.treeHash).toBeDefined();
			expect(snapshot.diff).toBeDefined();
			expect(snapshot.files).toBeDefined();
			expect(snapshot.rolledBack).toBe(false);
		});

		it("snapshot.restoreByHash restores files from a tree hash", async () => {
			const { manager, outputs, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "restore-me.txt"), "original\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			// Get the actual tree hash (not entryId) from the snapshot
			const snapshots = snapshotManager.getModifiedFiles({});
			const snap = snapshotManager.getSnapshotAtEntry(snapshots[0]!.entryId);
			const treeHash = snap?.snapshotTreeHash ?? snapshots[0]!.entryId;

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.restoreByHash", {
				snapshotTreeHash: treeHash,
			});

			expect(result).toBeDefined();
			expect((result as Record<string, unknown>).restored).toBeDefined();
		});

		it("snapshot.rollback restores files to a previous snapshot state", async () => {
			const { manager, outputs, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "rollback.txt"), "version1\n");
			const entryId = snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			// The rollback handler reads entries from sessionManager to locate
			// the snapshot's treeHash. We need to inject a matching entry.
			const stepSnapshotEntry: SessionEntry = {
				type: "custom",
				id: entryId ?? "snap-1",
				parentId: "root",
				timestamp: new Date().toISOString(),
				customType: "step-snapshot",
				data: snapshotManager.getSnapshotAtEntry(entryId ?? "snap-1") ?? {
					baselineTreeHash: null,
					snapshotTreeHash: "",
					diff: null,
					turnIndex: 0,
				},
			};
			(sessionManager as unknown as { entries: SessionEntry[] }).entries = [stepSnapshotEntry];

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.rollback", {
				snapshotId: entryId ?? "snap-1",
			});

			expect(result).toBeDefined();
			const r = result as Record<string, unknown>;
			expect(r.ok).toBe(true);
			expect(Array.isArray(r.restoredFiles)).toBe(true);
		});

		it("snapshot.unrevert returns ok=false when no unrevert point exists", async () => {
			const { manager, outputs } = await setupSnapshotChannel();

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.unrevert", {
				snapshotId: "no-such-point",
			});

			expect(result).toBeDefined();
			expect((result as Record<string, unknown>).ok).toBe(false);
		});

		it("snapshot.stats returns git object store statistics", async () => {
			const { manager, outputs, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "stats.txt"), "data\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.stats");

			expect(result).toBeDefined();
			const stats = result as Record<string, number>;
			expect(stats.totalObjects).toBeDefined();
			expect(stats.totalBytes).toBeDefined();
			expect(stats.totalObjects).toBeGreaterThan(0);
			expect(typeof stats.totalBytes).toBe("number");
		});

		it("snapshot.gc runs garbage collection and returns result", async () => {
			const { manager, outputs, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "gc.txt"), "will be snapshotted\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.gc");

			expect(result).toBeDefined();
			const gcResult = result as Record<string, unknown>;
			expect(gcResult.deletedObjects).toBeDefined();
			expect(gcResult.freedBytes).toBeDefined();
		});

		it("snapshot.prune removes old objects and returns result", async () => {
			const { manager, outputs, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "prune.txt"), "data\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.prune", {
				maxAgeMs: 1, // Very short age to prune everything
			});

			expect(result).toBeDefined();
			const pruneResult = result as Record<string, unknown>;
			expect(pruneResult.deletedObjects).toBeDefined();
			expect(pruneResult.freedBytes).toBeDefined();
		});

		it("snapshot.enforceLimit removes objects exceeding size limit", async () => {
			const { manager, outputs, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "limit.txt"), "data\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeSnapshotMethod(manager, outputs, "snapshot.enforceLimit", {
				maxBytes: 1, // Very small limit
			});

			expect(result).toBeDefined();
			const limitResult = result as Record<string, unknown>;
			expect(limitResult.deletedObjects).toBeDefined();
			expect(limitResult.freedBytes).toBeDefined();
		});
	});

	// ─── Channel infrastructure ────────────────────────────────────────────

	describe("channel infrastructure", () => {
		it("pending channels are resolved after flushPendingChannels", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);

			// Before flush, channels are deferred
			expect(result.runtime.pendingChannelRegistrations.length).toBeGreaterThan(0);
			expect(result.runtime.resolvedChannels.size).toBe(0);

			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			// After flush, pending is empty and resolved is populated
			expect(result.runtime.pendingChannelRegistrations).toHaveLength(0);
			expect(result.runtime.resolvedChannels.has("file-review")).toBe(true);
		});

		it("handles unknown method gracefully (no crash)", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			// Send an unknown method — ServerChannel silently ignores it
			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.nonexistent", invokeId: "unknown-1" },
			});

			// No response should be generated for unknown methods
			const response = findResponse(outputs, "file-review", "unknown-1");
			expect(response).toBeUndefined();
		});

		it("channel responds with invokeId matching request", async () => {
			const extPath = builtinExtensionPath("file-review");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);

			const { manager, outputs } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			const invokeId = "unique-id-42";
			manager.handleInbound({
				type: "channel_data",
				name: "file-review",
				data: { __call: "review.pending", invokeId },
			});

			const data = findResponse(outputs, "file-review", invokeId);
			expect(data).toBeDefined();
			expect(data!.invokeId).toBe(invokeId);
		});
	});
});
