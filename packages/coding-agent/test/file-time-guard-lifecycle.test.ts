/**
 * Lifecycle tests for the file-time-guard extension.
 *
 * Reproduces two bugs via the ExtensionRunner event flow:
 *  1. Record is never refreshed after a successful edit/write/bash in-place edit,
 *     so the second edit on the same file is wrongly blocked as "externally modified".
 *  2. ignorePatterns are matched against absolute paths, so relative patterns like
 *     "node_modules/**" never match and ignored files are still guarded.
 *
 * Drives the runner directly (no faux provider) for deterministic control over the
 * tool_call / tool_result event sequence and filesystem mtime.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fileTimeGuardFactory from "../extensions/file-time-guard/index.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions } from "../src/core/extensions/types.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTestExtensionsResult } from "./utilities.ts";

const extensionActions: ExtensionActions = {
	sendMessage: () => {},
	sendUserMessage: () => {},
	appendEntry: (() => "entry") as unknown as ExtensionActions["appendEntry"],
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
	getSettings: () => ({}),
};

async function loadRunner(tempDir: string, sessionManager: SessionManager): Promise<ExtensionRunner> {
	const result = await createTestExtensionsResult([fileTimeGuardFactory], tempDir);
	expect(result.errors).toEqual([]);

	const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage);
	const runner = new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
	runner.bindCore(extensionActions, extensionContextActions);
	await runner.emit({ type: "session_start", reason: "startup" });
	return runner;
}

/** Set a file's mtime/atime to a fixed point in the past so later writes reliably advance it. */
function ageFile(filePath: string, secondsAgo = 3600): void {
	const past = (Date.now() - secondsAgo * 1000) / 1000;
	utimesSync(filePath, past, past);
}

const TEXT_RESULT = [{ type: "text" as const, text: "ok" }];

describe("file-time-guard lifecycle", () => {
	let tempDir: string;
	let sessionManager: SessionManager;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-ftg-life-"));
		sessionManager = SessionManager.inMemory(tempDir);
		sessionManager.newSession();
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("allows a second edit on the same file after the first edit succeeds", async () => {
		const filePath = join(tempDir, "target.txt");
		writeFileSync(filePath, "v1");
		ageFile(filePath);

		const runner = await loadRunner(tempDir, sessionManager);

		// 1. read → records mtime (old)
		const readResult = await runner.emitToolCall({
			type: "tool_call",
			toolName: "read",
			toolCallId: "r1",
			input: { path: "target.txt" },
		});
		expect(readResult?.block).toBeFalsy();
		await runner.emitToolResult({
			type: "tool_result",
			toolName: "read",
			toolCallId: "r1",
			input: { path: "target.txt" },
			content: TEXT_RESULT,
			details: undefined,
			isError: false,
		});

		// 2. first edit → must pass (mtime unchanged since read)
		const edit1 = await runner.emitToolCall({
			type: "tool_call",
			toolName: "edit",
			toolCallId: "e1",
			input: { path: "target.txt" },
		});
		expect(edit1?.block).toBeFalsy();

		// Simulate the edit actually executing: file content + mtime change.
		writeFileSync(filePath, "v2");
		await runner.emitToolResult({
			type: "tool_result",
			toolName: "edit",
			toolCallId: "e1",
			input: { path: "target.txt" },
			content: TEXT_RESULT,
			details: undefined,
			isError: false,
		});

		// 3. second edit → must NOT be blocked (record refreshed by tool_result).
		const edit2 = await runner.emitToolCall({
			type: "tool_call",
			toolName: "edit",
			toolCallId: "e2",
			input: { path: "target.txt" },
		});
		expect(edit2?.block).not.toBe(true);
	});

	it("allows an edit on a file that was just written", async () => {
		const filePath = join(tempDir, "created.txt");

		const runner = await loadRunner(tempDir, sessionManager);

		// write creates the file (skips read-before-edit check), then tool_result records it.
		const write1 = await runner.emitToolCall({
			type: "tool_call",
			toolName: "write",
			toolCallId: "w1",
			input: { path: "created.txt" },
		});
		expect(write1?.block).toBeFalsy();
		writeFileSync(filePath, "first");
		await runner.emitToolResult({
			type: "tool_result",
			toolName: "write",
			toolCallId: "w1",
			input: { path: "created.txt" },
			content: TEXT_RESULT,
			details: undefined,
			isError: false,
		});

		// edit on the just-written file: without record refresh this is blocked ("not read").
		const edit1 = await runner.emitToolCall({
			type: "tool_call",
			toolName: "edit",
			toolCallId: "e1",
			input: { path: "created.txt" },
		});
		expect(edit1?.block).not.toBe(true);
	});

	it("ignores files under node_modules even without a prior read", async () => {
		const runner = await loadRunner(tempDir, sessionManager);

		mkdirSync(join(tempDir, "node_modules", "pkg"), { recursive: true });
		const ignoredFile = join(tempDir, "node_modules", "pkg", "index.js");
		writeFileSync(ignoredFile, "module.exports = 1");

		// Editing an unread node_modules file must not be blocked (matches node_modules/**).
		const editResult = await runner.emitToolCall({
			type: "tool_call",
			toolName: "edit",
			toolCallId: "e1",
			input: { path: "node_modules/pkg/index.js" },
		});
		expect(editResult?.block).not.toBe(true);
	});

	it("allows repeated bash sed -i on the same file after each succeeds", async () => {
		const filePath = join(tempDir, "data.txt");
		writeFileSync(filePath, "a\n");
		ageFile(filePath);

		const runner = await loadRunner(tempDir, sessionManager);

		// read records the file.
		await runner.emitToolCall({
			type: "tool_call",
			toolName: "read",
			toolCallId: "r1",
			input: { path: "data.txt" },
		});

		// first sed -i passes.
		const bash1 = await runner.emitToolCall({
			type: "tool_call",
			toolName: "bash",
			toolCallId: "b1",
			input: { command: "sed -i 's/a/b/' data.txt" },
		});
		expect(bash1?.block).toBeFalsy();
		// simulate execution + refresh.
		writeFileSync(filePath, "b\n");
		await runner.emitToolResult({
			type: "tool_result",
			toolName: "bash",
			toolCallId: "b1",
			input: { command: "sed -i 's/a/b/' data.txt" },
			content: TEXT_RESULT,
			details: undefined,
			isError: false,
		});

		// second sed -i on the same file must not be blocked.
		const bash2 = await runner.emitToolCall({
			type: "tool_call",
			toolName: "bash",
			toolCallId: "b2",
			input: { command: "sed -i 's/b/c/' data.txt" },
		});
		expect(bash2?.block).not.toBe(true);
	});
});
