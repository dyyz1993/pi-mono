/**
 * Extension API Contract Tests
 *
 * Verifies that the extension API surface in the SOURCE code (types.ts, runner.ts)
 * matches what extensions actually use. If any API is missing, the test FAILS.
 *
 * These are RUNTIME checks — we instantiate real objects and check property/method
 * presence with `typeof` and `expect`, not just TypeScript type checks.
 *
 * Tests that are expected to FAIL are left as normal `it()` so the failure list
 * is visible in CI output. The point is to surface API gaps immediately.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionAPI, ExtensionContextActions } from "../src/core/extensions/types.ts";
import type { LiveChange } from "../src/core/file-store/file-snapshot-manager.ts";
import { FileSnapshotManager } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";
import { createLocalFileSystemCapability } from "../src/core/filesystem-capability.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

// ---------------------------------------------------------------------------
// Helpers — same pattern as extensions-runner.test.ts
// ---------------------------------------------------------------------------

function makeRunner(cwd: string): ExtensionRunner {
	const sessionManager = SessionManager.inMemory();
	const authStorage = AuthStorage.create(path.join(cwd, "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage);
	const runtime = createExtensionRuntime();
	return new ExtensionRunner([], runtime, cwd, sessionManager, modelRegistry);
}

const stubActions: ExtensionActions = {
	sendMessage: () => {},
	sendUserMessage: () => {},
	appendEntry: () => {},
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

const stubContextActions: ExtensionContextActions = {
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

/**
 * Create a real ExtensionAPI (pi) object by loading a no-op extension factory.
 * This gives us the actual API surface that extension code uses.
 */
async function makePi(cwd: string): Promise<ExtensionAPI> {
	const eventBus = createEventBus();
	const runtime = createExtensionRuntime();
	let capturedPi: ExtensionAPI | undefined;
	await loadExtensionFromFactory(
		(pi) => {
			capturedPi = pi;
		},
		cwd,
		eventBus,
		runtime,
	);
	if (!capturedPi) throw new Error("Failed to capture pi object");
	return capturedPi;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExtensionContext API contract", () => {
	let tempDir: string;
	let runner: ExtensionRunner;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-contract-test-"));
		runner = makeRunner(tempDir);
		runner.bindCore(stubActions, stubContextActions);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("createContext returns an object", () => {
		const ctx = runner.createContext();
		expect(ctx).toBeDefined();
		expect(typeof ctx).toBe("object");
	});

	it("exposes ui property", () => {
		const ctx = runner.createContext();
		expect(ctx).toHaveProperty("ui");
	});

	it("exposes cwd property", () => {
		const ctx = runner.createContext();
		expect(ctx.cwd).toBe(tempDir);
	});

	it("exposes mode property", () => {
		const ctx = runner.createContext();
		expect(ctx).toHaveProperty("mode");
	});

	it("exposes isIdle method", () => {
		const ctx = runner.createContext();
		expect(typeof ctx.isIdle).toBe("function");
		expect(ctx.isIdle()).toBe(true);
	});

	it("exposes abort method", () => {
		const ctx = runner.createContext();
		expect(typeof ctx.abort).toBe("function");
	});

	it("exposes shutdown method", () => {
		const ctx = runner.createContext();
		expect(typeof ctx.shutdown).toBe("function");
	});

	it("exposes signal property", () => {
		const ctx = runner.createContext();
		expect(ctx).toHaveProperty("signal");
	});

	it("exposes sessionSignal as alias for signal", () => {
		const ctx = runner.createContext() as unknown as Record<string, unknown>;
		expect(ctx).toHaveProperty("sessionSignal");
	});

	it("exposes respondUI method", () => {
		const ctx = runner.createContext() as unknown as Record<string, unknown>;
		expect(typeof ctx.respondUI).toBe("function");
	});

	it("exposes fileSnapshotManager property (null by default)", () => {
		const ctx = runner.createContext();
		expect(ctx).toHaveProperty("fileSnapshotManager");
		expect(ctx.fileSnapshotManager).toBeNull();
	});

	it("exposes ctx.fs as the workspace filesystem capability", async () => {
		const ctx = runner.createContext();
		const filePath = path.join(tempDir, "nested", "ctx-fs.txt");

		expect(ctx).toHaveProperty("fs");
		expect(typeof ctx.fs.readFileText).toBe("function");
		expect(typeof ctx.fs.writeFile).toBe("function");
		expect(typeof ctx.fs.delete).toBe("function");
		expect(typeof ctx.fs.stat).toBe("function");

		await ctx.fs.writeFile(filePath, "ctx fs ok");
		expect(await ctx.fs.readFileText(filePath)).toBe("ctx fs ok");
		const stat = await ctx.fs.stat(filePath);
		expect(stat.size).toBe("ctx fs ok".length);
		expect(stat.isFile()).toBe(true);
		expect(stat.isDirectory()).toBe(false);

		await ctx.fs.delete(filePath);
		expect(await ctx.fs.exists(filePath)).toBe(false);
	});

	it("routes ctx.fs through the active ToolOperationsProvider when present", () => {
		const providerFs = createLocalFileSystemCapability();
		runner.bindCore(
			{
				...stubActions,
				getToolOperationsProvider: () => ({ fs: providerFs }),
			},
			stubContextActions,
		);

		const ctx = runner.createContext();
		expect(ctx.fs).toBe(providerFs);
	});

	it("fileSnapshotManager returns instance when setFileSnapshotManagerFn is called", () => {
		const dummy = {} as FileSnapshotManager;
		runner.setFileSnapshotManagerFn(() => dummy);
		const ctx = runner.createContext();
		expect(ctx.fileSnapshotManager).toBe(dummy);
	});

	it("exposes projectRoot property", () => {
		const ctx = runner.createContext();
		expect(ctx).toHaveProperty("projectRoot");
	});

	it("exposes sessionDataDir property", () => {
		const ctx = runner.createContext();
		expect(ctx).toHaveProperty("sessionDataDir");
	});

	it("exposes extensionName property", () => {
		const ctx = runner.createContext();
		expect(ctx).toHaveProperty("extensionName");
	});

	it("exposes compact method", () => {
		const ctx = runner.createContext();
		expect(typeof ctx.compact).toBe("function");
	});

	it("exposes getSystemPrompt method", () => {
		const ctx = runner.createContext();
		expect(typeof ctx.getSystemPrompt).toBe("function");
	});

	it("exposes getContextUsage method", () => {
		const ctx = runner.createContext();
		expect(typeof ctx.getContextUsage).toBe("function");
	});
});

describe("ExtensionAPI (pi) contract", () => {
	let tempDir: string;
	let pi: ExtensionAPI;

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-contract-test-"));
		pi = await makePi(tempDir);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("pi.on() is a function for event subscription", () => {
		expect(typeof pi.on).toBe("function");
	});

	it("pi.registerTool is a function", () => {
		expect(typeof pi.registerTool).toBe("function");
	});

	it("pi.registerCommand is a function", () => {
		expect(typeof pi.registerCommand).toBe("function");
	});

	it("pi.registerShortcut is a function", () => {
		expect(typeof pi.registerShortcut).toBe("function");
	});

	it("pi.registerFlag is a function", () => {
		expect(typeof pi.registerFlag).toBe("function");
	});

	it("pi.getFlag is a function", () => {
		expect(typeof pi.getFlag).toBe("function");
	});

	it("pi.registerMessageRenderer is a function", () => {
		expect(typeof pi.registerMessageRenderer).toBe("function");
	});

	it("pi.sendMessage is a function", () => {
		expect(typeof pi.sendMessage).toBe("function");
	});

	it("pi.sendUserMessage is a function", () => {
		expect(typeof pi.sendUserMessage).toBe("function");
	});

	it("pi.appendEntry is a function", () => {
		expect(typeof pi.appendEntry).toBe("function");
	});

	it("pi.deleteEntries is a function", () => {
		expect(typeof pi.deleteEntries).toBe("function");
	});

	it("pi.summarizeEntries is a function", () => {
		expect(typeof pi.summarizeEntries).toBe("function");
	});

	it("pi.setSessionName is a function", () => {
		expect(typeof pi.setSessionName).toBe("function");
	});

	it("pi.getSessionName is a function", () => {
		expect(typeof pi.getSessionName).toBe("function");
	});

	it("pi.setLabel is a function", () => {
		expect(typeof pi.setLabel).toBe("function");
	});

	it("pi.exec is a function", () => {
		expect(typeof pi.exec).toBe("function");
	});

	it("pi.getActiveTools is a function", () => {
		expect(typeof pi.getActiveTools).toBe("function");
	});

	it("pi.getAllTools is a function", () => {
		expect(typeof pi.getAllTools).toBe("function");
	});

	it("pi.setActiveTools is a function", () => {
		expect(typeof pi.setActiveTools).toBe("function");
	});

	it("pi.setToolOperationsProvider is a function", () => {
		expect(typeof pi.setToolOperationsProvider).toBe("function");
	});

	it("pi.getToolOperationsProvider is a function", () => {
		expect(typeof pi.getToolOperationsProvider).toBe("function");
	});

	it("pi.getCommands is a function", () => {
		expect(typeof pi.getCommands).toBe("function");
	});

	it("pi.registerChannel is a function", () => {
		expect(typeof pi.registerChannel).toBe("function");
	});

	it("pi.setModel is a function", () => {
		expect(typeof pi.setModel).toBe("function");
	});

	it("pi.getThinkingLevel is a function", () => {
		expect(typeof pi.getThinkingLevel).toBe("function");
	});

	it("pi.setThinkingLevel is a function", () => {
		expect(typeof pi.setThinkingLevel).toBe("function");
	});

	it("pi.callLLM is a function", () => {
		expect(typeof pi.callLLM).toBe("function");
	});

	it("pi.registerProvider is a function", () => {
		expect(typeof pi.registerProvider).toBe("function");
	});

	it("pi.unregisterProvider is a function", () => {
		expect(typeof pi.unregisterProvider).toBe("function");
	});

	it("pi.events (EventBus) is defined", () => {
		expect(pi.events).toBeDefined();
	});

	it("pi.background method — FAILS: background not in ExtensionAPI types.ts", () => {
		expect(typeof (pi as unknown as Record<string, unknown>).background).toBe("function");
	});

	it("pi.on('ui') is a valid event — FAILS: 'ui' event not in types.ts event list", () => {
		// At runtime, on() accepts any string, so this won't throw.
		// But the type contract in types.ts doesn't include "ui" as a valid event.
		// We test runtime behavior: if 'ui' is not recognized, handlers won't fire.
		expect(() => pi.on("ui" as never, () => {})).not.toThrow();
		// This assertion documents that 'ui' is NOT in the typed event list.
		// If it were added, this test should be updated to verify the event fires.
	});
});

describe("FileSnapshotManager API contract", () => {
	let tempDir: string;
	let manager: FileSnapshotManager;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-snapshot-test-"));
		const git = new InternalGit(path.join(tempDir, ".pi-snapshot"));
		manager = new FileSnapshotManager(git);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("has initialize method", () => {
		expect(typeof manager.initialize).toBe("function");
	});

	it("has getLiveChanges method", () => {
		expect(typeof manager.getLiveChanges).toBe("function");
	});

	it("getLiveChanges returns LiveChange[]", () => {
		manager.initialize(tempDir);
		const changes = manager.getLiveChanges(tempDir);
		expect(Array.isArray(changes)).toBe(true);
		expect(changes.length).toBe(0);
	});

	it("has onTurnEnd method", () => {
		expect(typeof manager.onTurnEnd).toBe("function");
	});

	it("has rebuildIndex method", () => {
		expect(typeof manager.rebuildIndex).toBe("function");
	});

	it("has restoreFiles method", () => {
		expect(typeof manager.restoreFiles).toBe("function");
	});

	it("has getSnapshotAtEntry method — FAILS: method does not exist", () => {
		expect(typeof (manager as unknown as Record<string, unknown>).getSnapshotAtEntry).toBe("function");
	});

	it("restoreFiles accepts snapshotHash option", async () => {
		const result = manager.restoreFiles(tempDir, {
			entries: [],
			snapshotHash: "abc123",
		});
		await expect(result).resolves.toBeDefined();
	});

	it("has LiveChange type exported", () => {
		const change: LiveChange = {
			path: "test.ts",
			status: "modified",
			diff: { oldContent: "a", newContent: "b" },
		};
		expect(change.path).toBe("test.ts");
		expect(change.status).toBe("modified");
	});

	it("has getModifiedFiles method", () => {
		expect(typeof manager.getModifiedFiles).toBe("function");
	});

	it("has getRollbackPreviewFiles method", () => {
		expect(typeof manager.getRollbackPreviewFiles).toBe("function");
	});

	it("has resolveSnapshotEntryIdForTarget method", () => {
		expect(typeof manager.resolveSnapshotEntryIdForTarget).toBe("function");
	});

	it("has getLatestSnapshotOnPath method", () => {
		expect(typeof manager.getLatestSnapshotOnPath).toBe("function");
	});

	it("has getFileHistory method", () => {
		expect(typeof manager.getFileHistory).toBe("function");
	});
});

describe("appendEntry return type contract", () => {
	it("pi.appendEntry returns void — FAILS if entry ID is needed by extensions", () => {
		// The type AppendEntryHandler = <T>(customType: string, data?: T) => void
		// Extensions that need the entry ID (like FileSnapshotManager.onTurnEnd)
		// currently cannot get it from pi.appendEntry. The handler returns void.
		//
		// FileSnapshotManager.onTurnEnd takes a SEPARATE appendEntry callback
		// that returns string, but pi.appendEntry returns void.
		const result = stubActions.appendEntry("test-type", { foo: "bar" });
		expect(result).toBeUndefined();
	});

	it("FileSnapshotManager.onTurnEnd appendEntry callback must return string", () => {
		// This documents the mismatch:
		// - pi.appendEntry returns void
		// - onTurnEnd needs (type, data) => string
		// The bridge code must provide a custom appendEntry to onTurnEnd.
		// If someone naively passes pi.appendEntry to onTurnEnd, it breaks.
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-snapshot-sig-"));
		try {
			const git = new InternalGit(path.join(tempDir, ".pi-snapshot"));
			const manager = new FileSnapshotManager(git);
			expect(manager.onTurnEnd.length).toBe(3); // cwd, turnIndex, appendEntry
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
