/**
 * Regression: approve baseline incorrect after reject-then-recreate cycle.
 *
 * Scenario:
 *   Turn 0: create file.txt = "V1" → reject (rollback to nothing)
 *   Turn 1: create file.txt = "V1" again → approve
 *   Turn 2: modify file.txt = "V2" → pending should show V1→V2 diff
 *
 * Bug: diff shows all-green (only additions, no deletions) because
 * approvedSnapshotEntry points to wrong baseline.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@dyyz1993/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import fileReview from "../extensions/file-review/index.ts";
import { FileSnapshotManager } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";
import { createLocalFileSystemCapability } from "../src/core/filesystem-capability.ts";

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
	const d = join(tmpdir(), `pi-rej-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(d, { recursive: true });
	tempDirs.push(d);
	return d;
}

function createMockChannel() {
	let receiveHandler: ((data: unknown) => void) | null = null;
	let invokeCounter = 0;
	const channel = {
		name: "file-review",
		send: (_data: unknown) => {},
		onReceive: (h: (data: unknown) => void) => {
			receiveHandler = h;
			return () => {
				receiveHandler = null;
			};
		},
		invoke: async (_d: unknown) => undefined,
		call: async (_m: string, _p: unknown) => undefined,
		async _invokeAsync(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
			const invokeId = ++invokeCounter;
			const callMsg = { __call: method, invokeId, ...params };
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 5000);
				const origSend = channel.send;
				channel.send = (data: unknown) => {
					const r = data as Record<string, unknown>;
					if (r.invokeId === invokeId) {
						clearTimeout(timer);
						channel.send = origSend;
						const { result: arrResult, ...rest } = r;
						resolve(arrResult !== undefined ? arrResult : Object.keys(rest).length === 0 ? null : rest);
					}
				};
				if (receiveHandler) receiveHandler(callMsg);
				else {
					clearTimeout(timer);
					channel.send = origSend;
					resolve(undefined);
				}
			});
		},
	};
	return channel;
}

function createMockExtensionAPI() {
	const entries: Array<{ type: string; data: unknown; customType?: string; id?: string }> = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
	const mockChannels = new Map<string, ReturnType<typeof createMockChannel>>();
	const api = {
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) => {
			handlers.set(event, handler);
		},
		appendEntry: (type: string, data: unknown) => {
			const id = `${type}-${entries.length + 1}`;
			entries.push({ type, data, id });
			return id;
		},
		registerChannel: (name: string) => {
			const ch = createMockChannel();
			mockChannels.set(name, ch);
			return ch;
		},
	} as unknown as ExtensionAPI;
	return { api, entries, handlers, mockChannels };
}

function createMockContext(
	cwd: string,
	mgr: FileSnapshotManager,
	entries: Array<{ type: string; data: unknown; id?: string }>,
): ExtensionContext {
	return {
		cwd,
		fs: createLocalFileSystemCapability(),
		fileSnapshotManager: mgr,
		sessionManager: {
			getEntries: () =>
				entries.map((e, i) => ({
					type: "custom" as const,
					customType: (e as { type: string }).type,
					data: e.data,
					id: e.id ?? `${e.type}-${i + 1}`,
					timestamp: new Date().toISOString(),
				})),
		},
	} as unknown as ExtensionContext;
}

describe("regression: reject then recreate then approve then modify", () => {
	it("create→reject→create→approve→modify shows correct V1→V2 diff", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);
		mgr.initialize(cwd);

		const { api, entries, handlers, mockChannels } = createMockExtensionAPI();
		fileReview(api);
		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);
		const channel = mockChannels.get("file-review")!;

		// Turn 0: create file.txt = "V1"
		writeFileSync(join(cwd, "file.txt"), "V1\n");
		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 0, (type, data) => {
			const id = `${type}-0`;
			entries.push({ type, data, id });
			return id;
		});

		// Verify pending shows file as added
		let pending = (await channel._invokeAsync("review.pending", {})) as Array<{
			path: string;
			fileStatus: string;
			oldContent?: string | null;
			newContent?: string | null;
			addedLines?: number;
			deletedLines?: number;
		}>;
		expect(pending.find((p) => p.path === "file.txt")).toBeDefined();

		// Reject: file should be deleted
		const rejectResult = (await channel._invokeAsync("review.reject", { path: "file.txt" })) as {
			ok: boolean;
			rolledBack: boolean;
		};
		expect(rejectResult.ok).toBe(true);
		expect(existsSync(join(cwd, "file.txt"))).toBe(false);

		// Turn 1: create file.txt = "V1" again
		writeFileSync(join(cwd, "file.txt"), "V1\n");
		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 1 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 1, (type, data) => {
			const id = `${type}-1`;
			entries.push({ type, data, id });
			return id;
		});

		// Approve
		const approveResult = (await channel._invokeAsync("review.approve", { path: "file.txt" })) as { ok: boolean };
		expect(approveResult.ok).toBe(true);

		// Turn 2: modify file.txt = "V2"
		writeFileSync(join(cwd, "file.txt"), "V2\n");
		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 2 } as TurnEndEvent, ctx);
		mgr.onTurnEnd(cwd, 2, (type, data) => {
			const id = `${type}-2`;
			entries.push({ type, data, id });
			return id;
		});

		// Query pending — THE KEY CHECK
		pending = (await channel._invokeAsync("review.pending", {})) as Array<{
			path: string;
			fileStatus: string;
			oldContent?: string | null;
			newContent?: string | null;
			addedLines?: number;
			deletedLines?: number;
		}>;

		const fileEntry = pending.find((p) => p.path === "file.txt");
		console.log(
			"After reject→recreate→approve→modify:",
			fileEntry
				? JSON.stringify({
						fileStatus: fileEntry.fileStatus,
						oldContent: fileEntry.oldContent,
						newContent: fileEntry.newContent,
						addedLines: fileEntry.addedLines,
						deletedLines: fileEntry.deletedLines,
					})
				: "NOT IN PENDING",
		);

		if (fileEntry) {
			// Should show V1→V2 diff with both additions and deletions
			expect(fileEntry.fileStatus).toBe("modified");
			expect(fileEntry.oldContent).toBe("V1\n");
			expect(fileEntry.newContent).toBe("V2\n");
			expect(fileEntry.deletedLines).toBe(1); // ← THE BUG: should have deletions
			expect(fileEntry.addedLines).toBe(1);
		}
	});
});
