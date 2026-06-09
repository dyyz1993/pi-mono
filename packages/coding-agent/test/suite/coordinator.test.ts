/**
 * Harness integration tests for the coordinator extension.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelManager } from "../../src/core/extensions/channel-manager.ts";
import type { ChannelDataMessage } from "../../src/core/extensions/channel-types.ts";
import type { ExtensionFactory } from "../../src/core/extensions/index.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const coordinatorFactory: ExtensionFactory = (await import("../../extensions/coordinator/index.ts")).default;

const harnesses: Harness[] = [];
const tempDirs: string[] = [];

afterEach(() => {
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
	while (tempDirs.length > 0) {
		const d = tempDirs.pop();
		if (d)
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {}
	}
	// Clean up coordinator-tasks.json that TaskStore may write to CWD
	// (harness uses SessionManager.inMemory() with empty sessionDir)
	const tasksFile = join(process.cwd(), "coordinator-tasks.json");
	if (existsSync(tasksFile)) {
		try {
			rmSync(tasksFile);
		} catch {}
	}
});

function createLoopbackChannelManager(): ChannelManager {
	let mgr: ChannelManager;
	const outputFn = (msg: ChannelDataMessage) => {
		setImmediate(() => mgr.handleInbound(msg));
	};
	mgr = new ChannelManager(outputFn);
	return mgr;
}

async function createCoordinatorHarness(): Promise<{ harness: Harness; channelManager: ChannelManager }> {
	const channelManager = createLoopbackChannelManager();
	const harness = await createHarness({
		extensionFactories: [coordinatorFactory],
	});
	harnesses.push(harness);
	await harness.session.bindExtensions({
		registerChannel: channelManager.register.bind(channelManager),
	});
	return { harness, channelManager };
}

// ── Tool registration ──

describe("coordinator tool registration", () => {
	const expectedTools = [
		"session_delegate",
		"session_delegate_send",
		"session_delegate_status",
		"session_delegate_fork",
		"session_delegate_stop",
		"session_delegate_remove",
		"session_delegate_clear_stopped",
		"session_delegate_sync",
	];

	for (const toolName of expectedTools) {
		it(`registers ${toolName} tool`, async () => {
			const { harness } = await createCoordinatorHarness();
			const tool = harness.session.getToolDefinition(toolName);
			expect(tool).toBeDefined();
			expect(tool!.name).toBe(toolName);
		});
	}
});

// ── Context hook ──

describe("coordinator context hook", () => {
	it("injects delegated tasks prompt when store has tasks", async () => {
		const { harness } = await createCoordinatorHarness();
		const runner = harness.session["_extensionRunner"];

		// Write a task into the coordinator-tasks.json via the session dir
		const tasksFile = join(harness.sessionManager.getSessionDir(), "coordinator-tasks.json");
		const task = {
			sessionId: "sess-ctx-1",
			title: "Test task",
			task: "Do something",
			projectPath: "/tmp",
			dispatchedAt: Date.now(),
			status: "idle",
		};
		writeFileSync(tasksFile, JSON.stringify([task]), "utf-8");

		// Reload the session to re-initialize the store from disk
		await harness.session.bindExtensions({});

		const messages = [{ role: "user" as const, content: "hello", timestamp: Date.now() }];
		const transformed = await runner.emitContext(messages);
		const texts = transformed.map((m) => getMessageText(m));

		const injected = texts.some((t) => t.includes("Delegated Tasks") || t.includes("sess-ctx-1"));
		expect(injected).toBe(true);
	});

	it("does not inject when store is empty", async () => {
		const { harness } = await createCoordinatorHarness();
		const runner = harness.session["_extensionRunner"];

		const messages = [{ role: "user" as const, content: "hello", timestamp: Date.now() }];
		const transformed = await runner.emitContext(messages);

		// No message should contain "Delegated Tasks" since the store is empty
		const allTexts = transformed.map((m) => getMessageText(m));
		expect(allTexts.some((t) => t.includes("Delegated Tasks"))).toBe(false);
	});
});
