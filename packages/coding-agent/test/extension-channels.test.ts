/**
 * Tests for extension channel handlers — file-review and file-snapshot.
 *
 * These tests load the actual built-in extensions and verify their channel
 * handler registration and behavior.
 */

import * as fs from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Directly invoke a channel handler registered on the ChannelManager
 * and capture its return value. This bypasses handleInbound() which
 * discards handler returns — necessary for testing raw onReceive handlers
 * like file-snapshot that return values instead of calling channel.send().
 */
async function invokeChannelHandler(manager: ChannelManager, channelName: string, data: unknown): Promise<unknown> {
	const channels = (
		manager as unknown as {
			channels: Map<string, { handlers: Set<(data: unknown) => unknown> }>;
		}
	).channels;
	const entry = channels.get(channelName);
	if (!entry || entry.handlers.size === 0) {
		throw new Error(`No handler registered for channel "${channelName}"`);
	}
	for (const handler of entry.handlers) {
		return await handler(data);
	}
	throw new Error("Handler did not execute");
}

/**
 * Create a mock ExtensionContext with a real FileSnapshotManager.
 */
function createMockExtensionContext(
	cwd: string,
	snapshotManager: FileSnapshotManager,
	sessionManager: SessionManager,
	modelRegistry: ModelRegistry,
): ExtensionContext {
	return {
		ui: {
			confirm: async () => true,
			select: async () => undefined,
			input: async () => undefined,
			notify: () => {},
			editor: async () => undefined,
		} as unknown as ExtensionContext["ui"],
		mode: "rpc" as const,
		hasUI: false,
		cwd,
		sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"],
		modelRegistry,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		sessionSignal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
		extensionName: "file-snapshot",
		projectRoot: cwd,
		sessionDataDir: cwd,
		projectDataDir: cwd,
		cwdDataDir: cwd,
		globalDataDir: cwd,
		fileSnapshotManager: snapshotManager,
		respondUI: () => () => {},
	};
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

		// file-snapshot uses raw channel.onReceive (not ServerChannel with __call).
		// The handler expects { method, params, context } where context is
		// ExtensionContext — only available after session_start fires.
		// We test by invoking the handler directly with a mock context containing
		// a real FileSnapshotManager, bypassing handleInbound() which discards returns.

		const snapshotActions: ExtensionActions = {
			...extensionActions,
			appendEntry: ((type: string) => `entry-${type}-${Date.now()}`) as unknown as ExtensionActions["appendEntry"],
		};
		const appendEntry = snapshotActions.appendEntry as unknown as (type: string) => string;

		async function setupSnapshotChannel() {
			const extPath = builtinExtensionPath("file-snapshot");
			const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
			expect(result.errors).toEqual([]);

			const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
			runner.bindCore(snapshotActions, extensionContextActions);

			const { manager } = createCapturingChannelManager();
			runner.flushPendingChannels((name) => manager.register(name));

			const storeDir = path.join(tempDir, ".pi-snapshot-store");
			mkdirSync(storeDir, { recursive: true });
			const git = new InternalGit(storeDir);
			const snapshotManager = new FileSnapshotManager(git);
			snapshotManager.initialize(tempDir);

			const ctx = createMockExtensionContext(tempDir, snapshotManager, sessionManager, modelRegistry);

			return { manager, runner, snapshotManager, ctx, git, storeDir };
		}

		it("snapshot.list returns empty list when no snapshots recorded", async () => {
			const { manager, ctx } = await setupSnapshotChannel();

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.list",
				context: ctx,
			});

			expect(Array.isArray(result)).toBe(true);
			expect(result).toHaveLength(0);
		});

		it("snapshot.list returns modified files after a turn", async () => {
			const { manager, ctx, snapshotManager } = await setupSnapshotChannel();

			// Simulate file changes
			writeFileSync(path.join(tempDir, "new-file.txt"), "content\n");

			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.list",
				context: ctx,
			});

			expect(Array.isArray(result)).toBe(true);
			expect((result as unknown[]).length).toBeGreaterThan(0);
			const files = result as Array<Record<string, unknown>>;
			const newFile = files.find((f) => f.path === "new-file.txt");
			expect(newFile).toBeDefined();
			expect(newFile!.status).toBe("added");
		});

		it("snapshot.get returns null for unknown entry ID", async () => {
			const { manager, ctx } = await setupSnapshotChannel();

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.get",
				params: { snapshotId: "nonexistent-id" },
				context: ctx,
			});

			expect(result).toBeNull();
		});

		it("snapshot.get returns snapshot data for valid entry ID", async () => {
			const { manager, ctx, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "test.txt"), "hello\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const snapshots = snapshotManager.getModifiedFiles({});
			expect(snapshots.length).toBeGreaterThan(0);
			const entryId = snapshots[0]!.entryId;

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.get",
				params: { snapshotId: entryId },
				context: ctx,
			});

			expect(result).toBeDefined();
			const snapshot = result as Record<string, unknown>;
			expect(snapshot).not.toBeNull();
			expect(snapshot.id).toBe(entryId);
			expect(snapshot.stepIndex).toBe(0);
			expect(snapshot.treeHash).toBeDefined();
			expect(snapshot.diff).toBeDefined();
			expect(snapshot.files).toBeDefined();
			expect(snapshot.rolledBack).toBe(false);
		});

		it("snapshot.restoreByHash restores files from a tree hash", async () => {
			const { manager, ctx, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "restore-me.txt"), "original\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const snapshots = snapshotManager.getModifiedFiles({});
			const treeHash = snapshots[0]!.entryId;

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.restoreByHash",
				params: { snapshotTreeHash: treeHash },
				context: ctx,
			});

			expect(result).toBeDefined();
			expect((result as Record<string, unknown>).restored).toBeDefined();
		});

		it("snapshot.rollback restores files to a previous snapshot state", async () => {
			const { manager, ctx, snapshotManager } = await setupSnapshotChannel();

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

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.rollback",
				params: { snapshotId: entryId ?? "snap-1" },
				context: ctx,
			});

			expect(result).toBeDefined();
			const r = result as Record<string, unknown>;
			expect(r.ok).toBe(true);
			expect(Array.isArray(r.restoredFiles)).toBe(true);
		});

		it("snapshot.unrevert returns ok=false when no unrevert point exists", async () => {
			const { manager, ctx } = await setupSnapshotChannel();

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.unrevert",
				params: { snapshotId: "no-such-point" },
				context: ctx,
			});

			expect(result).toBeDefined();
			expect((result as Record<string, unknown>).ok).toBe(false);
		});

		it("snapshot.stats returns git object store statistics", async () => {
			const { manager, ctx, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "stats.txt"), "data\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.stats",
				context: ctx,
			});

			expect(result).toBeDefined();
			const stats = result as Record<string, number>;
			expect(stats.totalObjects).toBeDefined();
			expect(stats.totalBytes).toBeDefined();
			expect(stats.totalObjects).toBeGreaterThan(0);
			expect(typeof stats.totalBytes).toBe("number");
		});

		it("snapshot.gc runs garbage collection and returns result", async () => {
			const { manager, ctx, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "gc.txt"), "will be snapshotted\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.gc",
				context: ctx,
			});

			expect(result).toBeDefined();
			const gcResult = result as Record<string, unknown>;
			expect(gcResult.deletedObjects).toBeDefined();
			expect(gcResult.freedBytes).toBeDefined();
		});

		it("snapshot.prune removes old objects and returns result", async () => {
			const { manager, ctx, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "prune.txt"), "data\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.prune",
				params: { maxAgeMs: 1 }, // Very short age to prune everything
				context: ctx,
			});

			expect(result).toBeDefined();
			const pruneResult = result as Record<string, unknown>;
			expect(pruneResult.deletedObjects).toBeDefined();
			expect(pruneResult.freedBytes).toBeDefined();
		});

		it("snapshot.enforceLimit removes objects exceeding size limit", async () => {
			const { manager, ctx, snapshotManager } = await setupSnapshotChannel();

			writeFileSync(path.join(tempDir, "limit.txt"), "data\n");
			snapshotManager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await invokeChannelHandler(manager, "file-snapshot", {
				method: "snapshot.enforceLimit",
				params: { maxBytes: 1 }, // Very small limit
				context: ctx,
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
