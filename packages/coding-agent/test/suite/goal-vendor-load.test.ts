/**
 * Load test for the goal-vendor extension (vendored from misunders2d/pi-goal).
 *
 * Verifies that the extension:
 * 1. Loads without errors from source (not dist).
 * 2. Registers all 9 expected tools.
 * 3. Registers the /goal command.
 * 4. Survives session_start without throwing.
 *
 * This mirrors the experiment-4 finding that the vendored source loads
 * cleanly on this fork (@dyyz1993/pi-coding-agent 0.78) after the import
 * scope and two 0.82-only event APIs were adapted.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions } from "../../src/core/extensions/types.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function goalVendorSourcePath(): string {
	return path.resolve(__dirname, "../../extensions/goal-vendor/index.ts");
}

// Minimal stub actions sufficient for load + registration (matches the
// builtin-extensions.test.ts harness shape, trimmed to what goal-vendor needs).
function makeExtensionActions(): ExtensionActions {
	return {
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
		callLLM: async () => "",
	};
}

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

const EXPECTED_TOOLS = [
	"pi_goal_submit_contract",
	"pi_goal_update_plan",
	"pi_goal_request_authority_amendment",
	"pi_goal_record_evidence",
	"pi_goal_apply_steering",
	"pi_goal_request_interrupt",
	"pi_goal_submit_completion_candidate",
	"pi_goal_run_check",
	"pi_goal_status",
] as const;

describe("goal-vendor (vendored misunders2d/pi-goal)", () => {
	let tempDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-vendor-load-"));
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads from source without errors", async () => {
		const extPath = goalVendorSourcePath();
		expect(fs.existsSync(extPath)).toBe(true);

		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.extensions.length).toBe(1);
	});

	it("registers all 9 pi_goal_* tools", async () => {
		const extPath = goalVendorSourcePath();
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(makeExtensionActions(), extensionContextActions);
		runner.setContextDirFns({
			getProjectRoot: () => tempDir,
			getSessionDataDir: () => tempDir,
			getProjectDataDir: () => tempDir,
			getCwdDataDir: () => tempDir,
			getGlobalDataDir: () => tempDir,
		});

		await runner.emit({ type: "session_start", reason: "startup" });

		const names = runner.getAllRegisteredTools().map((t) => t.definition.name);
		for (const expected of EXPECTED_TOOLS) {
			expect(names, `missing tool: ${expected}`).toContain(expected);
		}
		expect(names.length).toBeGreaterThanOrEqual(EXPECTED_TOOLS.length);
	});

	it("registers the /goal command", async () => {
		const extPath = goalVendorSourcePath();
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(makeExtensionActions(), extensionContextActions);
		runner.setContextDirFns({
			getProjectRoot: () => tempDir,
			getSessionDataDir: () => tempDir,
			getProjectDataDir: () => tempDir,
			getCwdDataDir: () => tempDir,
			getGlobalDataDir: () => tempDir,
		});

		await runner.emit({ type: "session_start", reason: "startup" });

		const commands = runner.getRegisteredCommands().map((c) => c.invocationName);
		expect(commands).toContain("goal");
	});

	it("survives session_start then session_shutdown without throwing", async () => {
		const extPath = goalVendorSourcePath();
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);

		const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(makeExtensionActions(), extensionContextActions);
		runner.setContextDirFns({
			getProjectRoot: () => tempDir,
			getSessionDataDir: () => tempDir,
			getProjectDataDir: () => tempDir,
			getCwdDataDir: () => tempDir,
			getGlobalDataDir: () => tempDir,
		});

		await runner.emit({ type: "session_start", reason: "startup" });
		await runner.emit({ type: "session_shutdown", reason: "quit" });
		// No throw == pass.
	});
});
