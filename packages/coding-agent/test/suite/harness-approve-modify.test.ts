/**
 * Integration tests for file-review approve baselines across follow-up edits.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@dyyz1993/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import fileReview from "../../extensions/file-review/index.ts";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";

interface PendingReviewChange {
	path: string;
	fileStatus: string;
	oldContent: string | null;
	newContent: string | null;
	addedLines: number;
	deletedLines: number;
}

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

function makeTempDir(): string {
	const dir = join(tmpdir(), `pi-review-approve-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

function createMockChannel() {
	let receiveHandler: ((data: unknown) => void) | null = null;
	let invokeCounter = 0;
	const channel = {
		name: "file-review",
		send: (_data: unknown) => {},
		onReceive: (handler: (data: unknown) => void) => {
			receiveHandler = handler;
			return () => {
				receiveHandler = null;
			};
		},
		invoke: async (_data: unknown) => undefined,
		call: async (_method: string, _params: unknown) => undefined,
		async invokeDirect(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
			const invokeId = `inv_${++invokeCounter}`;
			const callMsg = { __call: method, invokeId, ...params };
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 5000);
				const originalSend = channel.send;
				channel.send = (data: unknown) => {
					const response = data as Record<string, unknown>;
					if (response.invokeId !== invokeId) return;
					clearTimeout(timer);
					channel.send = originalSend;
					const { invokeId: _, result, ...rest } = response;
					resolve(result !== undefined ? result : rest);
				};
				receiveHandler?.(callMsg);
			});
		},
	};
	return channel;
}

function createMockExtensionAPI() {
	const entries: Array<{ type: string; data: unknown; id?: string }> = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
	const channel = createMockChannel();
	const api = {
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) => {
			handlers.set(event, handler);
		},
		appendEntry: (type: string, data: unknown) => {
			const id = `${type}-${entries.length + 1}`;
			entries.push({ type, data, id });
			return id;
		},
		registerChannel: () => channel,
	} as unknown as ExtensionAPI;

	return { api, entries, handlers, channel };
}

function createMockContext(
	cwd: string,
	mgr: FileSnapshotManager,
	entries: Array<{ type: string; data: unknown; id?: string }>,
): ExtensionContext {
	return {
		cwd,
		fileSnapshotManager: mgr,
		sessionManager: {
			getEntries: () =>
				entries.map((entry, index) => ({
					type: "custom" as const,
					customType: entry.type,
					data: entry.data,
					id: entry.id ?? `${entry.type}-${index + 1}`,
					timestamp: new Date().toISOString(),
				})),
		},
	} as unknown as ExtensionContext;
}

async function runTurn(
	cwd: string,
	mgr: FileSnapshotManager,
	turnIndex: number,
	ctx: ExtensionContext,
	handlers: Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>,
	entries: Array<{ type: string; data: unknown; id?: string }>,
	action: () => void,
) {
	await handlers.get("turn_start")!({}, ctx);
	action();
	await handlers.get("tool_result")!({}, ctx);
	await handlers.get("turn_end")!({ turnIndex } as TurnEndEvent, ctx);
	mgr.onTurnEnd(cwd, turnIndex, (type, data) => {
		const id = `${type}-${entries.length + 1}`;
		entries.push({ type, data, id });
		return id;
	});
}

async function createFixture() {
	const cwd = makeTempDir();
	const storeDir = makeTempDir();
	const mgr = new FileSnapshotManager(new InternalGit(storeDir));
	mgr.initialize(cwd);

	const { api, entries, handlers, channel } = createMockExtensionAPI();
	fileReview(api);
	const ctx = createMockContext(cwd, mgr, entries);
	await handlers.get("session_start")!({}, ctx);
	return { cwd, mgr, entries, handlers, channel, ctx };
}

describe("file-review approve baselines", () => {
	it("create -> approve -> modify returns V1 to V2 pending diff", async () => {
		const fixture = await createFixture();
		const { cwd, mgr, entries, handlers, channel, ctx } = fixture;

		await runTurn(cwd, mgr, 0, ctx, handlers, entries, () => {
			writeFileSync(join(cwd, "file.txt"), "V1\n");
		});

		const approveResult = (await channel.invokeDirect("review.approve", { path: "file.txt" })) as { ok: boolean };
		expect(approveResult.ok).toBe(true);

		await runTurn(cwd, mgr, 1, ctx, handlers, entries, () => {
			writeFileSync(join(cwd, "file.txt"), "V2\n");
		});

		const pending = (await channel.invokeDirect("review.pending")) as PendingReviewChange[];
		const fileEntry = pending.find((entry) => entry.path === "file.txt");

		expect(fileEntry).toMatchObject({
			fileStatus: "modified",
			oldContent: "V1\n",
			newContent: "V2\n",
			addedLines: 1,
			deletedLines: 1,
		});
	});

	it("create -> reject -> recreate -> approve -> modify returns recreated V1 to V2 pending diff", async () => {
		const fixture = await createFixture();
		const { cwd, mgr, entries, handlers, channel, ctx } = fixture;

		await runTurn(cwd, mgr, 0, ctx, handlers, entries, () => {
			writeFileSync(join(cwd, "file.txt"), "V1\n");
		});

		const rejectResult = (await channel.invokeDirect("review.reject", { path: "file.txt" })) as {
			ok: boolean;
			rolledBack: boolean;
		};
		expect(rejectResult.ok).toBe(true);
		expect(existsSync(join(cwd, "file.txt"))).toBe(false);

		await runTurn(cwd, mgr, 1, ctx, handlers, entries, () => {
			writeFileSync(join(cwd, "file.txt"), "V1\n");
		});

		const approveResult = (await channel.invokeDirect("review.approve", { path: "file.txt" })) as { ok: boolean };
		expect(approveResult.ok).toBe(true);

		await runTurn(cwd, mgr, 2, ctx, handlers, entries, () => {
			writeFileSync(join(cwd, "file.txt"), "V2\n");
		});

		const pending = (await channel.invokeDirect("review.pending")) as PendingReviewChange[];
		const fileEntry = pending.find((entry) => entry.path === "file.txt");

		expect(fileEntry).toMatchObject({
			fileStatus: "modified",
			oldContent: "V1\n",
			newContent: "V2\n",
			addedLines: 1,
			deletedLines: 1,
		});
	});
});
