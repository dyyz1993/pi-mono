/**
 * Tests for the todo-ext extension — channel events and tool registration.
 *
 * Tests through the channel layer (similar to extension-channels.test.ts).
 * Tool execution testing requires a full harness session.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAndLoadExtensions } from "../../src/core/extensions/index.ts";
import { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionContextActions } from "../../src/core/extensions/types.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

function builtinExtensionPath(name: string): string {
	const url = new URL(".", import.meta.url);
	return join(url.pathname, "..", name);
}

interface ChannelDataMessage {
	name: string;
	data: Record<string, unknown>;
}

function createCapturingChannelManager() {
	const outputs: ChannelDataMessage[] = [];
	const manager = {
		register: (name: string) => ({
			send: (data: Record<string, unknown>) => outputs.push({ name, data }),
			onReceive: () => () => {},
		}),
		has: (name: string) => false,
		handleInbound: () => {},
	};
	return { manager, outputs };
}

function findResponse(
	outputs: ChannelDataMessage[],
	channelName: string,
	findEvent: string,
): Record<string, unknown> | undefined {
	for (const msg of outputs) {
		if (msg.name !== channelName) continue;
		const d = msg.data as Record<string, unknown>;
		if (d.event === findEvent) return d;
	}
	return undefined;
}

const extensionActions = {
	sendMessage: () => {},
	sendUserMessage: () => {},
	appendEntry: () => undefined as string | undefined,
	deleteEntries: () => {},
	summarizeEntries: () => ({}),
	getSetting: () => undefined,
	setSetting: () => {},
	getSecret: () => undefined,
	registerChannel: () => ({
		name: "todo",
		send: () => {},
		onReceive: () => () => {},
		invoke: async () => ({}),
		call: async () => ({}),
	}),
	getToolOperationsProvider: () => undefined,
	callLLM: async () => "",
} as unknown as ExtensionActions;

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

let tempDir: string;
let sessionManager: SessionManager;
let modelRegistry: ModelRegistry;

describe("todo-ext channel", () => {
	beforeEach(() => {
		tempDir = `/tmp/pi-todo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		mkdirSync(tempDir, { recursive: true });
		sessionManager = SessionManager.inMemory();
		const authStorage = new AuthStorage(join(tempDir, "auth.json"));
		modelRegistry = ModelRegistry.create(authStorage);
	});

	afterEach(() => {
		try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it("registers the todo tool", async () => {
		const extPath = builtinExtensionPath("todo-ext");
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);

		const ext = result.extensions[0];
		expect(ext.tools.has("todo")).toBe(true);
		const tool = ext.tools.get("todo")!;
		expect(tool.definition.name).toBe("todo");
		expect(tool.definition.description).toContain("Manage a todo list");
		expect(tool.sourceInfo).toBeDefined();
	});

	it("registers the /todos command", async () => {
		const extPath = builtinExtensionPath("todo-ext");
		const result = await discoverAndLoadExtensions([extPath], tempDir, tempDir);
		expect(result.extensions[0]!.commands.has("todos")).toBe(true);
	});
});