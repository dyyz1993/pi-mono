/**
 * Test for approve-then-modify bug in file-review extension.
 *
 * Scenario:
 * 1. Turn 0: Agent creates file → appears in pending
 * 2. User approves file
 * 3. Turn 1: Agent modifies same file → should re-appear in pending
 *
 * Bug: file does NOT re-appear in pending after approve + modify.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TurnEndEvent } from "@dyyz1993/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import fileReview from "../../extensions/file-review/index.ts";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import { createLocalFileSystemCapability } from "../../src/core/filesystem-capability.ts";
import type { ExtensionAPI, ExtensionContext } from "../../src/index.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	tempDirs.length = 0;
});

function makeTempDir(): string {
	const d = `/tmp/pi-review-reapprove-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	tempDirs.push(d);
	return d;
}

/**
 * Mock channel that properly wires call() → onReceive() → handle() → send() response.
 * This simulates the real channel communication used by ServerChannel.
 */
function createMockChannel(name: string) {
	let receiveHandler: ((data: unknown) => void) | null = null;
	let invokeCounter = 0;
	const pendingInvokes = new Map<number, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

	const channel = {
		name,
		send: (data: unknown) => {
			// Server sends response back — match by invokeId
			const record = data as Record<string, unknown>;
			if (record.invokeId !== undefined) {
				const pending = pendingInvokes.get(Number(record.invokeId));
				if (pending) {
					pending.resolve(record);
					pendingInvokes.delete(Number(record.invokeId));
				}
			}
		},
		onReceive: (handler: (data: unknown) => void) => {
			receiveHandler = handler;
			return () => {
				receiveHandler = null;
			};
		},
		invoke: async (_data: unknown) => undefined,
		call: async (method: string, params: Record<string, unknown>) => {
			const invokeId = ++invokeCounter;
			const callMsg = { __call: method, invokeId, ...params };
			if (receiveHandler) {
				const promise = new Promise((resolve, reject) => {
					const timer = setTimeout(() => {
						pendingInvokes.delete(invokeId);
						reject(new Error(`invoke ${method} timeout`));
					}, 5000);
					pendingInvokes.set(invokeId, { resolve, timer });
				});
				receiveHandler(callMsg);
				return await promise;
			}
			return undefined;
		},
		/**
		 * Directly invoke a channel method synchronously.
		 * Routes through onReceive → ServerChannel.handle → send (response is captured).
		 */
		async _invokeAsync(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
			const invokeId = ++invokeCounter;
			const callMsg = { __call: method, invokeId, ...params };
			return await new Promise<unknown>((resolve, reject) => {
				const origSend = channel.send;
				const timer = setTimeout(() => {
					channel.send = origSend;
					reject(new Error(`Method ${method} timeout`));
				}, 5000);
				channel.send = (data: unknown) => {
					const record = data as Record<string, unknown>;
					if (record.invokeId === invokeId) {
						clearTimeout(timer);
						channel.send = origSend;
						const { invokeId: _, result: arrResult, ...rest } = record;
						resolve(arrResult !== undefined ? arrResult : rest);
					}
				};
				receiveHandler?.(callMsg);
			});
		},
	};
	return channel;
}

/**
 * Mock ExtensionAPI that supports channel registration via createTypedChannel.
 */
function createChannelMockExtensionAPI() {
	const entries: Array<{ type: string; data: unknown }> = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
	const mockChannels = new Map<string, ReturnType<typeof createMockChannel>>();

	const api = {
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) => {
			handlers.set(event, handler);
		},
		appendEntry: (type: string, data: unknown) => {
			entries.push({ type, data });
			return `${type}-${entries.length}`;
		},
		registerChannel: (name: string) => {
			const ch = createMockChannel(name);
			mockChannels.set(name, ch);
			return ch;
		},
	} as unknown as ExtensionAPI;

	return { api, entries, handlers, mockChannels };
}

function createMockContext(
	cwd: string,
	mgr: FileSnapshotManager,
	entries: Array<{ type: string; data: unknown; customType?: string; id?: string }>,
): ExtensionContext {
	return {
		cwd,
		fs: createLocalFileSystemCapability(),
		fileSnapshotManager: mgr,
		sessionManager: {
			getEntries: () =>
				entries.map((e, i) => ({
					type: "custom",
					customType: e.type,
					data: e.data,
					id: e.id ?? `${e.type}-${i + 1}`,
					timestamp: new Date().toISOString(),
				})),
			getSessionDir: () => cwd,
		},
	} as unknown as ExtensionContext;
}

describe("file-review approve-then-modify re-approval", () => {
	it("file re-appears in pending after approve then modify in next turn", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);
		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		const reviewChannel = mockChannels.get("file-review")!;

		// ── Turn 0: Create file ──
		writeFileSync(join(cwd, "test.txt"), "hello world");

		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		await mgr.onTurnEndAsync(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		// Check pending — should have test.txt
		const pending0 = (await reviewChannel._invokeAsync("review.pending", {})) as Array<{
			path: string;
			status: string;
			fileStatus: string;
		}>;
		expect(pending0).toHaveLength(1);
		expect(pending0[0]!.path).toBe("test.txt");
		expect(pending0[0]!.status).toBe("pending");
		expect(pending0[0]!.fileStatus).toBe("added");

		// ── Approve the file ──
		await reviewChannel._invokeAsync("review.approve", { path: "test.txt" });

		// Check pending — should be empty (approved)
		const pending1 = (await reviewChannel._invokeAsync("review.pending", {})) as unknown[];
		expect(pending1).toHaveLength(0);

		// ── Turn 1: Modify file ──
		writeFileSync(join(cwd, "test.txt"), "hello modified world");

		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 1 } as TurnEndEvent, ctx);
		await mgr.onTurnEndAsync(cwd, 1, (type, data) => api.appendEntry(type, data) ?? "");

		// ── Check pending — should re-appear as "modified" ──
		const pending2 = (await reviewChannel._invokeAsync("review.pending", {})) as Array<{
			path: string;
			status: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
			addedLines: number;
			deletedLines: number;
		}>;

		// This is where the bug manifests — file should appear but doesn't
		expect(pending2).toHaveLength(1);
		expect(pending2[0]!.path).toBe("test.txt");
		expect(pending2[0]!.status).toBe("pending");
		expect(pending2[0]!.fileStatus).toBe("modified");
		expect(pending2[0]!.oldContent).toBe("hello world");
		expect(pending2[0]!.newContent).toBe("hello modified world");
	});

	it("file re-appears with correct diff after approve then modify", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);
		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		const reviewChannel = mockChannels.get("file-review")!;

		// Turn 0: create multiline file
		writeFileSync(join(cwd, "code.ts"), "line 1\nline 2\nline 3\n");
		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		await mgr.onTurnEndAsync(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		// Approve
		await reviewChannel._invokeAsync("review.approve", { path: "code.ts" });

		// Turn 1: modify — replace line 2, add line 4
		writeFileSync(join(cwd, "code.ts"), "line 1\nline 2 modified\nline 3\nline 4\n");
		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 1 } as TurnEndEvent, ctx);
		await mgr.onTurnEndAsync(cwd, 1, (type, data) => api.appendEntry(type, data) ?? "");

		const pending = (await reviewChannel._invokeAsync("review.pending", {})) as Array<{
			path: string;
			oldContent: string | null;
			newContent: string | null;
			addedLines: number;
			deletedLines: number;
		}>;

		expect(pending).toHaveLength(1);
		expect(pending[0]!.oldContent).toBe("line 1\nline 2\nline 3\n");
		expect(pending[0]!.newContent).toBe("line 1\nline 2 modified\nline 3\nline 4\n");
		expect(pending[0]!.addedLines).toBe(2); // line 2 modified + line 4
		expect(pending[0]!.deletedLines).toBe(1); // line 2
	});
});
