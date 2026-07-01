/**
 * Integration tests for file-review extension full workflow.
 *
 * Tests the complete lifecycle:
 * 1. Agent creates file → pending shows correct diff with +N/-0
 * 2. Agent modifies file → pending shows correct diff with +N/-M
 * 3. Agent deletes file → pending shows correct diff with +0/-N
 * 4. Approve → file disappears from pending
 * 5. Reject → file rolled back + disappears from pending
 * 6. Reject then read-only turn → file does NOT reappear in pending
 * 7. Phantom entries (file in turnLog but not on disk/snapshot) are skipped
 * 8. Approve then modify → file re-appears with correct baseline
 */

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TurnEndEvent } from "@dyyz1993/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import fileReview from "../../extensions/file-review/index.ts";
import { createLocalFileSystemCapability } from "../../src/core/filesystem-capability.ts";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
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
	const d = `/tmp/pi-review-workflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	tempDirs.push(d);
	return d;
}

// ─── Mock infrastructure (from file-review-reapprove.test.ts) ───────

let invokeCounter = 0;

function createMockChannel(name: string) {
	let receiveHandler: ((data: unknown) => void) | null = null;
	const channel = {
		name,
		send: (_data: unknown) => {},
		onReceive(handler: (data: unknown) => void) {
			receiveHandler = handler;
		},
		handle(_method: string, _handler: (params: Record<string, unknown>) => unknown) {},
		on(_event: string, _handler: (data: unknown) => void) {
			return () => {};
		},
		call(method: string, params: Record<string, unknown> = {}, _timeoutMs?: number): Promise<unknown> {
			const invokeId = ++invokeCounter;
			const callMsg = { __call: method, invokeId, ...params };
			receiveHandler?.(callMsg);
			return Promise.resolve({});
		},
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
			if (mockChannels.has(name)) return mockChannels.get(name)!;
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

interface PendingItem {
	path: string;
	fileStatus: string;
	status: string;
	oldContent: string | null;
	newContent: string | null;
	addedLines: number;
	deletedLines: number;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("file-review full workflow", () => {
	it("Agent creates file → pending shows +N/-0", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("turn_start")!({}, ctx);

		// Simulate agent creating a file
		writeFileSync(join(cwd, "new-file.txt"), "line 1\nline 2\nline 3\n");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		// Check pending
		const reviewChannel = mockChannels.get("file-review")!;
		const pending = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];

		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("new-file.txt");
		expect(pending[0]!.fileStatus).toBe("added");
		expect(pending[0]!.addedLines).toBe(3);
		expect(pending[0]!.deletedLines).toBe(0);
		expect(pending[0]!.oldContent).toBeNull();
		expect(pending[0]!.newContent).toBeTruthy();
	});

	it("Agent modifies file → pending shows +N/-M", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "line 1\nline 2\nline 3\n");
		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("turn_start")!({}, ctx);

		// Modify: replace line 2, add line 4
		writeFileSync(join(cwd, "file.txt"), "line 1\nline 2 modified\nline 3\nline 4\n");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		const reviewChannel = mockChannels.get("file-review")!;
		const pending = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];

		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("file.txt");
		expect(pending[0]!.fileStatus).toBe("modified");
		expect(pending[0]!.addedLines).toBeGreaterThan(0);
		expect(pending[0]!.deletedLines).toBeGreaterThan(0);
	});

	it("Agent deletes file → pending shows +0/-N", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "doomed.txt"), "line 1\nline 2\nline 3\n");
		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("turn_start")!({}, ctx);

		unlinkSync(join(cwd, "doomed.txt"));
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		const reviewChannel = mockChannels.get("file-review")!;
		const pending = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];

		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("doomed.txt");
		expect(pending[0]!.fileStatus).toBe("deleted");
		expect(pending[0]!.deletedLines).toBe(3);
		expect(pending[0]!.addedLines).toBe(0);
		expect(pending[0]!.oldContent).toBeTruthy();
		expect(pending[0]!.newContent).toBeNull();
	});

	it("Approve → file disappears from pending", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		// Turn 0: create file
		await handlers.get("turn_start")!({}, ctx);
		writeFileSync(join(cwd, "to-approve.txt"), "content");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		const reviewChannel = mockChannels.get("file-review")!;

		// Verify it's in pending
		const before = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];
		expect(before).toHaveLength(1);

		// Approve
		const result = await reviewChannel._invokeAsync("review.approve", { path: "to-approve.txt" }) as { ok: boolean };
		expect(result.ok).toBe(true);

		// Verify it's gone
		const after = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];
		expect(after).toHaveLength(0);
	});

	it("Reject modified file → content restored + disappears from pending", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "original content");
		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		// Turn 0: modify file
		await handlers.get("turn_start")!({}, ctx);
		writeFileSync(join(cwd, "file.txt"), "modified content");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		const reviewChannel = mockChannels.get("file-review")!;

		// Reject
		const result = await reviewChannel._invokeAsync("review.reject", { path: "file.txt" }) as {
			ok: boolean;
			rolledBack?: boolean;
		};
		expect(result.ok).toBe(true);
		expect(result.rolledBack).toBe(true);

		// File content should be restored
		const content = readFileSync(join(cwd, "file.txt"), "utf-8");
		expect(content).toBe("original content");

		// Pending should be empty
		const after = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];
		expect(after).toHaveLength(0);
	});

	it("Reject deleted file → file restored + disappears from pending", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "to-restore.txt"), "important content\nline 2\n");
		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		// Turn 0: delete file
		await handlers.get("turn_start")!({}, ctx);
		unlinkSync(join(cwd, "to-restore.txt"));
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		const reviewChannel = mockChannels.get("file-review")!;

		// Verify file is deleted
		expect(existsSync(join(cwd, "to-restore.txt"))).toBe(false);

		// Reject (should restore)
		const result = await reviewChannel._invokeAsync("review.reject", { path: "to-restore.txt" }) as {
			ok: boolean;
			rolledBack?: boolean;
		};
		expect(result.ok).toBe(true);

		// File should be restored
		expect(existsSync(join(cwd, "to-restore.txt"))).toBe(true);
		const content = readFileSync(join(cwd, "to-restore.txt"), "utf-8");
		expect(content).toBe("important content\nline 2\n");

		// Pending should be empty
		const after = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];
		expect(after).toHaveLength(0);
	});

	it("Reject added file → file deleted + disappears from pending", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		// Turn 0: create file
		await handlers.get("turn_start")!({}, ctx);
		writeFileSync(join(cwd, "new-file.txt"), "should be removed");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		const reviewChannel = mockChannels.get("file-review")!;

		// Verify file exists
		expect(existsSync(join(cwd, "new-file.txt"))).toBe(true);

		// Reject (should delete)
		const result = await reviewChannel._invokeAsync("review.reject", { path: "new-file.txt" }) as {
			ok: boolean;
			rolledBack?: boolean;
		};
		expect(result.ok).toBe(true);

		// File should be deleted
		expect(existsSync(join(cwd, "new-file.txt"))).toBe(false);

		// Pending should be empty
		const after = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];
		expect(after).toHaveLength(0);
	});

	it("Reject then read-only turn → file does NOT reappear in pending", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "original");
		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		// Turn 0: modify + commit
		await handlers.get("turn_start")!({}, ctx);
		writeFileSync(join(cwd, "file.txt"), "modified");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		const reviewChannel = mockChannels.get("file-review")!;

		// Reject
		const result = await reviewChannel._invokeAsync("review.reject", { path: "file.txt" }) as {
			ok: boolean;
			rolledBack?: boolean;
		};
		expect(result.ok).toBe(true);
		expect(result.rolledBack).toBe(true);

		// File restored to original
		expect(readFileSync(join(cwd, "file.txt"), "utf-8")).toBe("original");

		// Turn 1: read-only (no file changes)
		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 1 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 1, (type, data) => api.appendEntry(type, data) ?? "");

		// Pending should NOT contain file.txt
		const pending = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];
		const fileEntry = pending.find((p) => p.path === "file.txt");
		expect(fileEntry).toBeUndefined();
	});

	it("Net-zero: file added then deleted → not in pending (without approval)", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		// Turn 0: create file
		await handlers.get("turn_start")!({}, ctx);
		writeFileSync(join(cwd, "temp.txt"), "temp content");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		// Turn 1: delete the file
		await handlers.get("turn_start")!({}, ctx);
		unlinkSync(join(cwd, "temp.txt"));
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 1 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 1, (type, data) => api.appendEntry(type, data) ?? "");

		// Pending: file was added then deleted without approval → net-zero skip
		const reviewChannel = mockChannels.get("file-review")!;
		const pending = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];

		const tempEntry = pending.find((p) => p.path === "temp.txt");
		expect(tempEntry).toBeUndefined();
	});

	it("Approve then modify → file re-appears with correct baseline", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		// Turn 0: create file
		await handlers.get("turn_start")!({}, ctx);
		writeFileSync(join(cwd, "file.txt"), "version 1");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => api.appendEntry(type, data) ?? "");

		const reviewChannel = mockChannels.get("file-review")!;

		// Approve
		const approveResult = await reviewChannel._invokeAsync("review.approve", { path: "file.txt" }) as { ok: boolean };
		expect(approveResult.ok).toBe(true);

		// Turn 1: modify file
		await handlers.get("turn_start")!({}, ctx);
		writeFileSync(join(cwd, "file.txt"), "version 2");
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 1 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 1, (type, data) => api.appendEntry(type, data) ?? "");

		// Should re-appear
		const pending = await reviewChannel._invokeAsync("review.pending", {}) as PendingItem[];
		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("file.txt");
		// oldContent should be version 1 (approved baseline), newContent version 2
		expect(pending[0]!.oldContent).toBe("version 1");
		expect(pending[0]!.newContent).toBe("version 2");
		expect(pending[0]!.addedLines).toBeGreaterThan(0);
	});
});
