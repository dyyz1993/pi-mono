/**
 * Tests for extension channel handlers — file-review and file-snapshot.
 *
 * These tests load the actual built-in extensions and verify their channel
 * handler registration and behavior.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ChannelManager } from "../src/core/extensions/channel-manager.ts";
import type { ChannelDataMessage, ChannelOutputFn } from "../src/core/extensions/channel-types.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions, ProviderConfig } from "../src/core/extensions/types.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
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
		// These methods require a real fileSnapshotManager wired via
		// runner.setFileSnapshotManagerFn() to function.

		it.todo("snapshot.list returns list of modified files — requires fileSnapshotManager via ExtensionContext");

		it.todo("snapshot.get returns snapshot by entry ID — requires getSnapshotAtEntry() and ExtensionContext");

		it.todo("snapshot.restoreByHash restores from hash — requires fileSnapshotManager.restoreFiles()");

		it.todo("snapshot.restoreByEntry restores from entry ID — requires fileSnapshotManager.restoreFiles()");

		it.todo("snapshot.rollback restores files to a previous state — requires fileSnapshotManager");

		it.todo("snapshot.unrevert restores to pre-rollback state — requires fileSnapshotManager + session entries");

		it.todo("snapshot.gc runs garbage collection — requires GitApi from fileSnapshotManager");

		it.todo("snapshot.prune removes old objects — requires GitApi from fileSnapshotManager");

		it.todo("snapshot.stats returns git object store statistics — requires GitApi");

		it.todo("snapshot.enforceLimit removes objects exceeding size limit — requires GitApi");
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
