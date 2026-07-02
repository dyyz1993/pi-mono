/**
 * Regression test: modified file shows correct oldContent, not null.
 *
 * Bug: When session starts from an empty directory and a file is created then
 * modified (possibly across turns or within one turn), review.pending returns
 * oldContent: null even though fileStatus is "modified". This makes the diff
 * appear as all-green (all additions) instead of a proper modification diff.
 *
 * Root cause: sessionStartTreeHash is null for empty-dir sessions. When the file
 * is committed (getLiveChanges finds no change), batchDiff falls back to
 * sessionStartTreeHash which returns oldContent: null.
 *
 * Fix: When oldContent is null but fileStatus is "modified", search previous
 * turn snapshots for the pre-modification content.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
	const d = join(tmpdir(), `pi-reg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

async function runTurn(
	cwd: string,
	mgr: FileSnapshotManager,
	turnIndex: number,
	actions: () => void,
	handlers: Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>,
	ctx: ExtensionContext,
	entries: Array<{ type: string; data: unknown; id?: string }>,
) {
	actions();
	// Simulate turn_end + onTurnEnd
	await handlers.get("turn_end")!({ turnIndex } as TurnEndEvent, ctx);
	await mgr.onTurnEndAsync(cwd, turnIndex, (type, data) => {
		const id = `${type}-${turnIndex}`;
		entries.push({ type, data, id });
		return id;
	});
}

describe("regression: modified file oldContent null bug", () => {
	it("create V1 → modify to V2 in turn 1 → pending shows V1→V2 diff", async () => {
		const cwd = makeTempDir(); // empty dir → sessionStartTreeHash = null
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
		await runTurn(
			cwd,
			mgr,
			0,
			() => {
				writeFileSync(join(cwd, "file.txt"), "V1\n");
			},
			handlers,
			ctx,
			entries,
		);

		// Turn 1: modify file.txt = "V2"
		await runTurn(
			cwd,
			mgr,
			1,
			() => {
				writeFileSync(join(cwd, "file.txt"), "V2\n");
			},
			handlers,
			ctx,
			entries,
		);

		// Query pending
		const pending = (await channel._invokeAsync("review.pending", {})) as Array<{
			path: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
			addedLines: number;
			deletedLines: number;
		}>;

		const fileEntry = pending.find((p) => p.path === "file.txt");
		expect(fileEntry).toBeDefined();

		// THE KEY ASSERTION: oldContent should be "V1\n" not null
		expect(fileEntry!.fileStatus).toBe("modified");
		expect(fileEntry!.oldContent).toBe("V1\n");
		expect(fileEntry!.newContent).toBe("V2\n");
		expect(fileEntry!.deletedLines).toBe(1);
		expect(fileEntry!.addedLines).toBe(1);
	});

	it("create V1 only → pending shows all-green (added)", async () => {
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

		// Turn 0: create file only
		await runTurn(
			cwd,
			mgr,
			0,
			() => {
				writeFileSync(join(cwd, "new.txt"), "content\n");
			},
			handlers,
			ctx,
			entries,
		);

		const pending = (await channel._invokeAsync("review.pending", {})) as Array<{
			path: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
		}>;

		const fileEntry = pending.find((p) => p.path === "new.txt");
		expect(fileEntry).toBeDefined();
		// New file should have oldContent: null (correct for "added")
		expect(fileEntry!.fileStatus).toBe("added");
		expect(fileEntry!.oldContent).toBeNull();
	});

	it("create V1 → modify to V2 → modify to V3 → pending shows V2→V3 diff", async () => {
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

		// Turn 0: create
		await runTurn(
			cwd,
			mgr,
			0,
			() => {
				writeFileSync(join(cwd, "multi.txt"), "V1\n");
			},
			handlers,
			ctx,
			entries,
		);

		// Turn 1: modify to V2
		await runTurn(
			cwd,
			mgr,
			1,
			() => {
				writeFileSync(join(cwd, "multi.txt"), "V2\n");
			},
			handlers,
			ctx,
			entries,
		);

		// Turn 2: modify to V3
		await runTurn(
			cwd,
			mgr,
			2,
			() => {
				writeFileSync(join(cwd, "multi.txt"), "V3\n");
			},
			handlers,
			ctx,
			entries,
		);

		const pending = (await channel._invokeAsync("review.pending", {})) as Array<{
			path: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
		}>;

		const fileEntry = pending.find((p) => p.path === "multi.txt");
		expect(fileEntry).toBeDefined();
		expect(fileEntry!.fileStatus).toBe("modified");
		// oldContent should be the previous version (V2), not null
		expect(fileEntry!.oldContent).not.toBeNull();
		expect(fileEntry!.newContent).toBe("V3\n");
	});
});
