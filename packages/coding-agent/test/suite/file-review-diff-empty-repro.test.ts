/**
 * TDD test to reproduce: "审核列表能看到文件但点击查看 diff 为空"
 *
 * Root cause hypothesis: after a turn creates/modifies files,
 * review.pending lists the files but getFileDiff returns null.
 */
import { mkdirSync, rmSync } from "node:fs";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import type { Channel } from "@dyyz1993/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import fileReviewFactory from "../../extensions/file-review/index.js";
import fileSnapshotFactory from "../../extensions/file-snapshot/index.js";
import { createHarness, type Harness } from "./harness.js";

const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
});

// ── Loopback channel for testing RPC without real transport ──

interface PendingInvoke {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
}

function createLoopbackChannel(name: string): {
	channel: Channel;
	callMethod: (method: string, params: Record<string, unknown>) => Promise<unknown>;
} {
	const handlers: ((data: unknown) => void)[] = [];
	const pendingInvokes = new Map<string, PendingInvoke>();

	const channel: Channel = {
		name,
		send: (data: unknown) => {
			const msg = data as Record<string, unknown>;
			if (msg && typeof msg.invokeId === "string") {
				const pending = pendingInvokes.get(msg.invokeId);
				if (pending) {
					clearTimeout(pending.timer);
					pendingInvokes.delete(msg.invokeId);
					pending.resolve(msg);
					return;
				}
			}
			for (const handler of handlers) {
				try {
					handler(data);
				} catch {}
			}
		},
		onReceive: (handler: (data: unknown) => void) => {
			handlers.push(handler);
			return () => {
				const idx = handlers.indexOf(handler);
				if (idx >= 0) handlers.splice(idx, 1);
			};
		},
		invoke: () => Promise.reject(new Error("not implemented")),
		call: () => Promise.reject(new Error("not implemented")),
	};

	const callMethod = (method: string, params: Record<string, unknown>): Promise<unknown> => {
		return new Promise((resolve, reject) => {
			const invokeId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			const timer = setTimeout(() => {
				pendingInvokes.delete(invokeId);
				reject(new Error(`Channel call "${method}" timed out`));
			}, 5000);

			pendingInvokes.set(invokeId, { resolve, reject, timer });

			const payload = { ...params, __call: method, invokeId };
			for (const handler of handlers) {
				try {
					handler(payload);
				} catch {}
			}
		});
	};

	return { channel, callMethod };
}

function createChannelRegistry() {
	const channels = new Map<string, ReturnType<typeof createLoopbackChannel>>();

	const registerChannel = (name: string): Channel => {
		let entry = channels.get(name);
		if (!entry) {
			entry = createLoopbackChannel(name);
			channels.set(name, entry);
		}
		return entry.channel;
	};

	const call = async (channelName: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
		const entry = channels.get(channelName);
		if (!entry) throw new Error(`Channel "${channelName}" not registered`);
		return entry.callMethod(method, params);
	};

	return { registerChannel, call };
}

async function createHarnessWithReview() {
	const channelRegistry = createChannelRegistry();

	const harness = await createHarness({
		extensionFactories: [fileSnapshotFactory, fileReviewFactory],
	});
	harnesses.push(harness);

	await harness.session.bindExtensions({
		registerChannel: channelRegistry.registerChannel,
	});

	const reviewCall = (method: string, params: Record<string, unknown> = {}) =>
		channelRegistry.call("file-review", method, params);

	return { harness, reviewCall };
}

interface PendingChange {
	turnIndex: number;
	path: string;
	fileStatus: string;
	status: string;
	oldContent: string | null;
	newContent: string | null;
}

async function getPending(
	reviewCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): Promise<PendingChange[]> {
	const raw = await reviewCall("review.pending");
	const data = raw as Record<string, unknown>;
	const result = data?.result ?? data;
	if (Array.isArray(result)) {
		return result as PendingChange[];
	}
	if (result && typeof result === "object") {
		return Object.values(result as Record<string, unknown>) as PendingChange[];
	}
	return [];
}

describe("file-review diff-empty bug reproduction", () => {
	it("after creating a file in turn 0, review.pending should show the file WITH non-null diff content", async () => {
		const { harness, reviewCall } = await createHarnessWithReview();

		// Turn 0: agent creates a file
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "app.ts", content: "// hello world" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("create app.ts");

		// Now check review.pending — this is what the UI calls to populate the review list
		const pending = await getPending(reviewCall);

		console.log("[REPRO] pending changes:", JSON.stringify(pending, null, 2));

		// File should be in the list
		expect(pending.length).toBeGreaterThan(0);
		const appChange = pending.find((c) => c.path === "app.ts");
		expect(appChange).toBeDefined();

		// THIS is the bug: newContent should NOT be null
		console.log("[REPRO] app.ts oldContent:", appChange!.oldContent);
		console.log("[REPRO] app.ts newContent:", appChange!.newContent);

		expect(appChange!.newContent).not.toBeNull();
		expect(appChange!.newContent).toBe("// hello world");
	});

	it("after modifying a file, review.pending should show updated diff", async () => {
		const { harness, reviewCall } = await createHarnessWithReview();

		// Turn 0: create file
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "config.ts", content: "export const x = 1;" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create config");

		// Turn 1: modify file
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "config.ts", content: "export const x = 2;" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("modify config");

		const pending = await getPending(reviewCall);
		console.log("[REPRO-MODIFY] pending:", JSON.stringify(pending, null, 2));

		const configChange = pending.find((c) => c.path === "config.ts");
		expect(configChange).toBeDefined();

		// Should show the LATEST content, and the original content
		expect(configChange!.newContent).not.toBeNull();
		expect(configChange!.newContent).toBe("export const x = 2;");
		// oldContent should be null (didn't exist at session start)
		expect(configChange!.oldContent).toBeNull();
	});

	it("BUG REPRO: subagent GC deletes main session blobs → review.pending shows file but diff is null", async () => {
		const { harness, reviewCall } = await createHarnessWithReview();

		// Main session creates files in turn 0
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "main.ts", content: "// main file" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("create main file");

		// Verify diff works before any GC
		const pendingBefore = await getPending(reviewCall);
		const mainBefore = pendingBefore.find((c) => c.path === "main.ts");
		expect(mainBefore).toBeDefined();
		expect(mainBefore!.newContent).toBe("// main file");

		// Simulate subagent GC: subagent only has its own active hashes (no overlap with main)
		const mgr = harness.session.fileSnapshotManager;
		const git = (mgr as any).git;

		// Run GC with EMPTY active set — simulates a subagent whose hashes don't overlap with main
		const gcResult = await git.gc(new Set<string>());
		console.log("[REPRO-GC] GC deleted:", gcResult.deletedObjects, "objects");

		// Now check review.pending — the bug manifests here
		const pendingAfter = await getPending(reviewCall);
		const mainAfter = pendingAfter.find((c) => c.path === "main.ts");
		expect(mainAfter).toBeDefined(); // File still shows in list (turnLog is in-memory)

		// EXPECTED (after fix): newContent should still be "// main file"
		// BUG (before fix): newContent is null because blob was GC'd
		console.log("[REPRO-GC] main.ts newContent after GC:", mainAfter!.newContent);
		expect(mainAfter!.newContent).toBe("// main file");
	});
});
