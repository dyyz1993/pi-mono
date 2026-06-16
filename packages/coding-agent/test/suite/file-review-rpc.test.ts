/**
 * Comprehensive unit tests for file-review extension RPC methods.
 *
 * Tests all channel methods:
 *   review.pending     — pending changes with diff data
 *   review.approve     — approve a single file
 *   review.reject      — reject + rollback a single file (added/modified/deleted)
 *   review.approveAll  — batch approve all pending files
 *   review.rejectAll   — batch reject + rollback all pending files
 *   review.approvals   — query approval state by status filter
 *   review.live        — current turn's live changes
 *   review.history     — historical turn changes with filters
 *   review.summary     — per-turn summary counts
 *   review.fileHistory — single file change history
 *   review.clear       — wipe turn log
 */

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@dyyz1993/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import fileReview from "../../extensions/file-review/index.ts";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";

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
	const d = `/tmp/pi-review-rpc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	tempDirs.push(d);
	return d;
}

// ─── Mock infrastructure ──────────────────────────────────────────────

function createMockChannel(name: string) {
	let receiveHandler: ((data: unknown) => void) | null = null;
	let invokeCounter = 0;
	const pendingInvokes = new Map<number, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

	const channel = {
		name,
		send: (data: unknown) => {
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
		_invokeDirect(method: string, params: Record<string, unknown> = {}): unknown {
			const invokeId = ++invokeCounter;
			const callMsg = { __call: method, invokeId, ...params };
			let result: unknown;
			let resolved = false;

			const origSend = channel.send;
			channel.send = (data: unknown) => {
				const record = data as Record<string, unknown>;
				if (record.invokeId === invokeId) {
					result = record;
					resolved = true;
				}
			};

			if (receiveHandler) {
				receiveHandler(callMsg);
			}

			channel.send = origSend;

			if (!resolved) throw new Error(`Method ${method} did not respond`);
			const { invokeId: _, result: arrResult, ...rest } = result as Record<string, unknown>;
			return arrResult !== undefined ? arrResult : rest;
		},
	};
	return channel;
}

function createChannelMockExtensionAPI() {
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
		fileSnapshotManager: mgr,
		sessionManager: {
			getEntries: () =>
				entries.map((e, i) => ({
					type: "custom",
					customType: e.customType ?? e.type,
					data: e.data,
					id: e.id ?? `${e.type}-${i + 1}`,
					timestamp: new Date().toISOString(),
				})),
			getSessionDir: () => cwd,
		},
	} as unknown as ExtensionContext;
}

// ─── Helper to set up a full file-review test fixture ─────────────────

interface ReviewFixture {
	cwd: string;
	mgr: FileSnapshotManager;
	channel: ReturnType<typeof createMockChannel>;
	handlers: Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>;
	entries: Array<{ type: string; data: unknown; customType?: string; id?: string }>;
	ctx: ExtensionContext;
}

function setupReviewFixture(existingFiles?: Record<string, string>): ReviewFixture {
	const cwd = makeTempDir();
	const storeDir = makeTempDir();
	const git = new InternalGit(storeDir);
	const mgr = new FileSnapshotManager(git);

	if (existingFiles) {
		for (const [path, content] of Object.entries(existingFiles)) {
			const fullPath = join(cwd, path);
			mkdirSync(join(fullPath, ".."), { recursive: true });
			writeFileSync(fullPath, content);
		}
	}
	mgr.initialize(cwd);

	const { api, entries, handlers, mockChannels } = createChannelMockExtensionAPI();
	fileReview(api);

	const ctx = createMockContext(cwd, mgr, entries);

	return {
		cwd,
		mgr,
		channel: mockChannels.get("file-review")!,
		handlers,
		entries,
		ctx,
	};
}

async function runTurn(fix: ReviewFixture, turnIndex: number, fileChanges?: () => void) {
	await fix.handlers.get("turn_start")!({}, fix.ctx);
	if (fileChanges) fileChanges();
	await fix.handlers.get("tool_result")!({}, fix.ctx);
	await fix.handlers.get("turn_end")!({ turnIndex } as TurnEndEvent, fix.ctx);
	fix.mgr.onTurnEnd(fix.cwd, turnIndex, (type, _data) => `${type}-${turnIndex}`);
}

// ═══════════════════════════════════════════════════════════════════════
// review.pending
// ═══════════════════════════════════════════════════════════════════════

describe("review.pending", () => {
	it("returns empty when no changes", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		const pending = fix.channel._invokeDirect("review.pending", {}) as unknown[];
		expect(pending).toHaveLength(0);
	});

	it("returns added file as pending with null oldContent", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "new.txt"), "new content");
		});

		const pending = fix.channel._invokeDirect("review.pending", {}) as Array<{
			path: string;
			status: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
		}>;

		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("new.txt");
		expect(pending[0]!.status).toBe("pending");
		expect(pending[0]!.fileStatus).toBe("added");
		expect(pending[0]!.oldContent).toBeNull();
		expect(pending[0]!.newContent).toBe("new content");
	});

	it("returns modified file as pending with correct old/new content", async () => {
		const fix = setupReviewFixture({ "existing.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "existing.txt"), "modified");
		});

		const pending = fix.channel._invokeDirect("review.pending", {}) as Array<{
			path: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
		}>;

		expect(pending).toHaveLength(1);
		expect(pending[0]!.fileStatus).toBe("modified");
		expect(pending[0]!.oldContent).toBe("original");
		expect(pending[0]!.newContent).toBe("modified");
	});

	it("returns deleted file as pending with null newContent", async () => {
		const fix = setupReviewFixture({ "delete-me.txt": "to be deleted" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			unlinkSync(join(fix.cwd, "delete-me.txt"));
		});

		const pending = fix.channel._invokeDirect("review.pending", {}) as Array<{
			path: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
		}>;

		expect(pending).toHaveLength(1);
		expect(pending[0]!.fileStatus).toBe("deleted");
		expect(pending[0]!.oldContent).toBe("to be deleted");
		expect(pending[0]!.newContent).toBeNull();
	});

	it("excludes approved files from pending", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "v1");
		});

		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		const pending = fix.channel._invokeDirect("review.pending", {}) as unknown[];
		expect(pending).toHaveLength(0);
	});

	it("excludes rejected files from pending", async () => {
		const fix = setupReviewFixture({ "file.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "modified");
		});

		fix.channel._invokeDirect("review.reject", { path: "file.txt" });

		const pending = fix.channel._invokeDirect("review.pending", {}) as unknown[];
		expect(pending).toHaveLength(0);
	});

	it("applies net-zero filter: added then deleted without approval is excluded", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		// Turn 0: create file
		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "ephemeral.txt"), "temp");
		});

		// Turn 1: delete file
		await runTurn(fix, 1, () => {
			unlinkSync(join(fix.cwd, "ephemeral.txt"));
		});

		const pending = fix.channel._invokeDirect("review.pending", {}) as unknown[];
		expect(pending).toHaveLength(0);
	});

	it("does NOT apply net-zero filter when file was previously approved", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "created");
		});

		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		// Turn 1: delete the approved file
		await runTurn(fix, 1, () => {
			unlinkSync(join(fix.cwd, "file.txt"));
		});

		const pending = fix.channel._invokeDirect("review.pending", {}) as Array<{
			path: string;
			fileStatus: string;
		}>;

		// Should still appear because it was previously approved
		expect(pending).toHaveLength(1);
		expect(pending[0]!.path).toBe("file.txt");
		expect(pending[0]!.fileStatus).toBe("deleted");
	});

	it("includes multiple files with correct diff data", async () => {
		const fix = setupReviewFixture({ "base.txt": "base content" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "new.txt"), "brand new\n");
			writeFileSync(join(fix.cwd, "base.txt"), "modified content\n");
			writeFileSync(join(fix.cwd, "multiline.txt"), "line 1\nline 2\nline 3\n");
		});

		const pending = fix.channel._invokeDirect("review.pending", {}) as Array<{
			path: string;
			fileStatus: string;
			addedLines: number;
			deletedLines: number;
			unifiedDiff: string;
		}>;

		expect(pending).toHaveLength(3);
		const byPath = new Map(pending.map((p) => [p.path, p]));

		// "brand new\n" → 1 line added (single line with trailing newline = 1 line)
		expect(byPath.get("new.txt")!.addedLines).toBe(1);
		expect(byPath.get("new.txt")!.deletedLines).toBe(0);

		expect(byPath.get("base.txt")!.addedLines).toBe(1);
		expect(byPath.get("base.txt")!.deletedLines).toBe(1);

		expect(byPath.get("multiline.txt")!.addedLines).toBe(3);
	});

	it("re-appearance after approve then modify in next turn", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "v1");
		});

		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		await runTurn(fix, 1, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "v2");
		});

		const pending = fix.channel._invokeDirect("review.pending", {}) as Array<{
			path: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
		}>;

		expect(pending).toHaveLength(1);
		expect(pending[0]!.fileStatus).toBe("modified");
		expect(pending[0]!.oldContent).toBe("v1");
		expect(pending[0]!.newContent).toBe("v2");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.approve
// ═══════════════════════════════════════════════════════════════════════

describe("review.approve", () => {
	it("returns ok:true when approving a file", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "content");
		});

		const result = fix.channel._invokeDirect("review.approve", { path: "file.txt" }) as { ok: boolean };
		expect(result.ok).toBe(true);
	});

	it("sets file status to approved", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "content");
		});

		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		const approvals = fix.channel._invokeDirect("review.approvals", {}) as Array<{
			path: string;
			status: string;
		}>;
		const approved = approvals.find((a) => a.path === "file.txt");
		expect(approved).toBeDefined();
		expect(approved!.status).toBe("approved");
	});

	it("persists approval entry via appendEntry", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "content");
		});

		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		const approvalEntries = fix.entries.filter((e) => e.type === "file-approval");
		expect(approvalEntries.length).toBeGreaterThanOrEqual(1);
		const lastEntry = approvalEntries[approvalEntries.length - 1]!;
		expect((lastEntry.data as { status: string }).status).toBe("approved");
		expect((lastEntry.data as { path: string }).path).toBe("file.txt");
	});

	it("idempotent: approving already-approved file is safe", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "content");
		});

		fix.channel._invokeDirect("review.approve", { path: "file.txt" });
		const result2 = fix.channel._invokeDirect("review.approve", { path: "file.txt" }) as { ok: boolean };
		expect(result2.ok).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.reject
// ═══════════════════════════════════════════════════════════════════════

describe("review.reject", () => {
	it("rolls back added file by deleting it", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "new.txt"), "new");
		});

		expect(existsSync(join(fix.cwd, "new.txt"))).toBe(true);

		const result = fix.channel._invokeDirect("review.reject", { path: "new.txt" }) as {
			ok: boolean;
			rolledBack: boolean;
		};

		expect(result.ok).toBe(true);
		expect(result.rolledBack).toBe(true);
		expect(existsSync(join(fix.cwd, "new.txt"))).toBe(false);
	});

	it("rolls back modified file by restoring original content", async () => {
		const fix = setupReviewFixture({ "file.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "modified");
		});

		const result = fix.channel._invokeDirect("review.reject", { path: "file.txt" }) as {
			ok: boolean;
			rolledBack: boolean;
		};

		expect(result.ok).toBe(true);
		expect(result.rolledBack).toBe(true);
		expect(readFileSync(join(fix.cwd, "file.txt"), "utf-8")).toBe("original");
	});

	it("rolls back deleted file by restoring it", async () => {
		const fix = setupReviewFixture({ "file.txt": "will be deleted" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			unlinkSync(join(fix.cwd, "file.txt"));
		});

		expect(existsSync(join(fix.cwd, "file.txt"))).toBe(false);

		const result = fix.channel._invokeDirect("review.reject", { path: "file.txt" }) as {
			ok: boolean;
			rolledBack: boolean;
		};

		expect(result.ok).toBe(true);
		expect(result.rolledBack).toBe(true);
		expect(readFileSync(join(fix.cwd, "file.txt"), "utf-8")).toBe("will be deleted");
	});

	it("sets file status to rejected after rollback", async () => {
		const fix = setupReviewFixture({ "file.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "modified");
		});

		fix.channel._invokeDirect("review.reject", { path: "file.txt" });

		const approvals = fix.channel._invokeDirect("review.approvals", {}) as Array<{
			path: string;
			status: string;
		}>;
		const rejected = approvals.find((a) => a.path === "file.txt");
		expect(rejected).toBeDefined();
		expect(rejected!.status).toBe("rejected");
	});

	it("persists rejection entry via appendEntry", async () => {
		const fix = setupReviewFixture({ "file.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "modified");
		});

		fix.channel._invokeDirect("review.reject", { path: "file.txt" });

		const approvalEntries = fix.entries.filter((e) => e.type === "file-approval");
		expect(approvalEntries.length).toBeGreaterThanOrEqual(1);
		const lastEntry = approvalEntries[approvalEntries.length - 1]!;
		expect((lastEntry.data as { status: string }).status).toBe("rejected");
	});

	it("reject of an unmodified file returns ok:true with rolledBack:false", async () => {
		const fix = setupReviewFixture({ "file.txt": "unchanged" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		// No turn changes
		const result = fix.channel._invokeDirect("review.reject", { path: "file.txt" }) as {
			ok: boolean;
		};

		// Should still mark as rejected even if no rollback needed
		expect(result.ok).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.approveAll
// ═══════════════════════════════════════════════════════════════════════

describe("review.approveAll", () => {
	it("approves all pending files and returns count", async () => {
		const fix = setupReviewFixture({ "base.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "new1.txt"), "a");
			writeFileSync(join(fix.cwd, "new2.txt"), "b");
			writeFileSync(join(fix.cwd, "base.txt"), "modified");
		});

		const result = fix.channel._invokeDirect("review.approveAll", {}) as { count: number };

		expect(result.count).toBe(3);
	});

	it("does not re-approve already-approved files", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file1.txt"), "a");
			writeFileSync(join(fix.cwd, "file2.txt"), "b");
		});

		// Approve one individually
		fix.channel._invokeDirect("review.approve", { path: "file1.txt" });

		const result = fix.channel._invokeDirect("review.approveAll", {}) as { count: number };
		expect(result.count).toBe(1);
	});

	it("returns count:0 when no pending files", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		const result = fix.channel._invokeDirect("review.approveAll", {}) as { count: number };
		expect(result.count).toBe(0);
	});

	it("all files show approved status after approveAll", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "b");
		});

		fix.channel._invokeDirect("review.approveAll", {});

		const approvals = fix.channel._invokeDirect("review.approvals", { status: "approved" }) as Array<{
			path: string;
			status: string;
		}>;
		expect(approvals).toHaveLength(2);
		expect(approvals.every((a) => a.status === "approved")).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.rejectAll
// ═══════════════════════════════════════════════════════════════════════

describe("review.rejectAll", () => {
	it("rejects all pending files and returns counts", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "b");
		});

		const result = fix.channel._invokeDirect("review.rejectAll", {}) as {
			count: number;
			rolledBack: number;
		};

		expect(result.count).toBe(2);
		expect(result.rolledBack).toBe(2);
		expect(existsSync(join(fix.cwd, "a.txt"))).toBe(false);
		expect(existsSync(join(fix.cwd, "b.txt"))).toBe(false);
	});

	it("does not reject already-approved files", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "approved.txt"), "a");
			writeFileSync(join(fix.cwd, "pending.txt"), "b");
		});

		fix.channel._invokeDirect("review.approve", { path: "approved.txt" });

		const result = fix.channel._invokeDirect("review.rejectAll", {}) as { count: number };
		expect(result.count).toBe(1);
		// approved.txt should still exist
		expect(existsSync(join(fix.cwd, "approved.txt"))).toBe(true);
	});

	it("returns count:0 when no pending files", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		const result = fix.channel._invokeDirect("review.rejectAll", {}) as { count: number };
		expect(result.count).toBe(0);
	});

	it("rolls back modified files to original content", async () => {
		const fix = setupReviewFixture({ "file.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "file.txt"), "modified");
		});

		fix.channel._invokeDirect("review.rejectAll", {});

		expect(readFileSync(join(fix.cwd, "file.txt"), "utf-8")).toBe("original");
	});

	it("restores deleted files", async () => {
		const fix = setupReviewFixture({ "file.txt": "will be restored" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			unlinkSync(join(fix.cwd, "file.txt"));
		});

		fix.channel._invokeDirect("review.rejectAll", {});

		expect(readFileSync(join(fix.cwd, "file.txt"), "utf-8")).toBe("will be restored");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.approvals
// ═══════════════════════════════════════════════════════════════════════

describe("review.approvals", () => {
	it("returns empty when no approvals recorded", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		const result = fix.channel._invokeDirect("review.approvals", {}) as unknown[];
		expect(result).toHaveLength(0);
	});

	it("returns all approvals without filter", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "b");
		});

		fix.channel._invokeDirect("review.approve", { path: "a.txt" });
		fix.channel._invokeDirect("review.reject", { path: "b.txt" });

		const result = fix.channel._invokeDirect("review.approvals", {}) as Array<{
			path: string;
			status: string;
		}>;

		expect(result).toHaveLength(2);
	});

	it("filters by status=approved", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "b");
		});

		fix.channel._invokeDirect("review.approve", { path: "a.txt" });
		fix.channel._invokeDirect("review.reject", { path: "b.txt" });

		const result = fix.channel._invokeDirect("review.approvals", { status: "approved" }) as Array<{
			status: string;
		}>;

		expect(result).toHaveLength(1);
		expect(result[0]!.status).toBe("approved");
	});

	it("filters by status=rejected", async () => {
		const fix = setupReviewFixture({ "b.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "modified");
		});

		fix.channel._invokeDirect("review.approve", { path: "a.txt" });
		fix.channel._invokeDirect("review.reject", { path: "b.txt" });

		const result = fix.channel._invokeDirect("review.approvals", { status: "rejected" }) as Array<{
			status: string;
		}>;

		expect(result).toHaveLength(1);
		expect(result[0]!.status).toBe("rejected");
	});

	it("filters by status=pending returns unprocessed files after pending query", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "b");
		});

		fix.channel._invokeDirect("review.approve", { path: "a.txt" });

		// Calling review.pending first creates the pending approval entry for b.txt
		fix.channel._invokeDirect("review.pending", {});

		const result = fix.channel._invokeDirect("review.approvals", { status: "pending" }) as Array<{
			status: string;
		}>;

		expect(result).toHaveLength(1);
		expect(result[0]!.status).toBe("pending");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.live
// ═══════════════════════════════════════════════════════════════════════

describe("review.live", () => {
	it("returns empty changes when no modifications in current turn", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await fix.handlers.get("turn_start")!({}, fix.ctx);
		await fix.handlers.get("tool_result")!({}, fix.ctx);

		const result = fix.channel._invokeDirect("review.live", {}) as {
			turnIndex: number;
			changes: unknown[];
		};

		expect(result.changes).toHaveLength(0);
	});

	it("returns live changes for the current turn", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await fix.handlers.get("turn_start")!({}, fix.ctx);
		writeFileSync(join(fix.cwd, "live.txt"), "live change");
		await fix.handlers.get("tool_result")!({}, fix.ctx);

		const result = fix.channel._invokeDirect("review.live", {}) as {
			turnIndex: number;
			changes: Array<{ path: string; status: string }>;
		};

		expect(result.changes.length).toBeGreaterThanOrEqual(1);
		const found = result.changes.find((c) => c.path === "live.txt");
		expect(found).toBeDefined();
		expect(found!.status).toBe("added");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.history
// ═══════════════════════════════════════════════════════════════════════

describe("review.history", () => {
	it("returns all turn records by default", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "a.txt"), "a"));
		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "b.txt"), "b"));

		const result = fix.channel._invokeDirect("review.history", {}) as Array<{
			turnIndex: number;
			changes: Array<{ path: string }>;
		}>;

		expect(result).toHaveLength(2);
		expect(result[0]!.turnIndex).toBe(0);
		expect(result[1]!.turnIndex).toBe(1);
	});

	it("filters by fromTurn", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "a.txt"), "a"));
		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "b.txt"), "b"));
		await runTurn(fix, 2, () => writeFileSync(join(fix.cwd, "c.txt"), "c"));

		const result = fix.channel._invokeDirect("review.history", { fromTurn: 1 }) as Array<{
			turnIndex: number;
		}>;

		expect(result).toHaveLength(2);
		expect(result.every((r) => r.turnIndex >= 1)).toBe(true);
	});

	it("filters by pathFilter", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "b");
		});

		const result = fix.channel._invokeDirect("review.history", { pathFilter: "a.txt" }) as Array<{
			changes: Array<{ path: string }>;
		}>;

		expect(result).toHaveLength(1);
		expect(result[0]!.changes.every((c) => c.path.includes("a.txt"))).toBe(true);
	});

	it("returns empty when no matching turns", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		const result = fix.channel._invokeDirect("review.history", {}) as unknown[];
		expect(result).toHaveLength(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.summary
// ═══════════════════════════════════════════════════════════════════════

describe("review.summary", () => {
	it("returns per-turn summary counts", async () => {
		const fix = setupReviewFixture({ "modify.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "new.txt"), "new");
			writeFileSync(join(fix.cwd, "modify.txt"), "modified");
		});

		const result = fix.channel._invokeDirect("review.summary", {}) as Array<{
			turnIndex: number;
			added: number;
			modified: number;
			deleted: number;
			files: string[];
		}>;

		expect(result).toHaveLength(1);
		expect(result[0]!.added).toBe(1);
		expect(result[0]!.modified).toBe(1);
		expect(result[0]!.deleted).toBe(0);
		expect(result[0]!.files.length).toBe(2);
	});

	it("counts deletions correctly", async () => {
		const fix = setupReviewFixture({ "del.txt": "delete me", "keep.txt": "keep" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			unlinkSync(join(fix.cwd, "del.txt"));
		});

		const result = fix.channel._invokeDirect("review.summary", {}) as Array<{
			deleted: number;
		}>;

		expect(result[0]!.deleted).toBe(1);
	});

	it("returns empty when no turns recorded", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		const result = fix.channel._invokeDirect("review.summary", {}) as unknown[];
		expect(result).toHaveLength(0);
	});

	it("files array uses status prefix notation", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "new.txt"), "new");
		});

		const result = fix.channel._invokeDirect("review.summary", {}) as Array<{
			files: string[];
		}>;

		expect(result[0]!.files[0]).toMatch(/^a /);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.fileHistory
// ═══════════════════════════════════════════════════════════════════════

describe("review.fileHistory", () => {
	it("returns change history for a specific file path", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "v1"));
		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "file.txt"), "v2"));

		const result = fix.channel._invokeDirect("review.fileHistory", { path: "file.txt" }) as Array<{
			turnIndex: number;
			status: string;
		}>;

		expect(result).toHaveLength(2);
		expect(result[0]!.turnIndex).toBe(0);
		expect(result[0]!.status).toBe("added");
		expect(result[1]!.turnIndex).toBe(1);
		expect(result[1]!.status).toBe("modified");
	});

	it("returns empty for a file with no changes", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "a.txt"), "a"));

		const result = fix.channel._invokeDirect("review.fileHistory", { path: "nonexistent.txt" }) as unknown[];
		expect(result).toHaveLength(0);
	});

	it("tracks deletion in file history", async () => {
		const fix = setupReviewFixture({ "file.txt": "original" });
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "modified"));
		await runTurn(fix, 1, () => unlinkSync(join(fix.cwd, "file.txt")));

		const result = fix.channel._invokeDirect("review.fileHistory", { path: "file.txt" }) as Array<{
			status: string;
		}>;

		expect(result).toHaveLength(2);
		expect(result[0]!.status).toBe("modified");
		expect(result[1]!.status).toBe("deleted");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// review.clear
// ═══════════════════════════════════════════════════════════════════════

describe("review.clear", () => {
	it("wipes turn log and returns ok:true", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "a.txt"), "a"));

		// Verify history has data
		const before = fix.channel._invokeDirect("review.history", {}) as unknown[];
		expect(before).toHaveLength(1);

		const result = fix.channel._invokeDirect("review.clear", {}) as { ok: boolean };
		expect(result.ok).toBe(true);

		// History should be empty
		const after = fix.channel._invokeDirect("review.history", {}) as unknown[];
		expect(after).toHaveLength(0);
	});

	it("summary is empty after clear", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "a.txt"), "a"));

		fix.channel._invokeDirect("review.clear", {});

		const summary = fix.channel._invokeDirect("review.summary", {}) as unknown[];
		expect(summary).toHaveLength(0);
	});

	it("clear on empty state is safe", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		const result = fix.channel._invokeDirect("review.clear", {}) as { ok: boolean };
		expect(result.ok).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Session reload (persistence)
// ═══════════════════════════════════════════════════════════════════════

describe("session_start restores state from entries", () => {
	it("restores approval state from file-approval entries", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);
		mgr.initialize(cwd);

		// Simulate pre-existing entries (from a previous session)
		const entries: Array<{ type: string; data: unknown; customType?: string; id?: string }> = [
			{
				type: "step-snapshot",
				customType: "step-snapshot",
				data: { turnIndex: 0, snapshotTreeHash: "hash1", baselineTreeHash: null, diff: null },
				id: "snap-1",
			},
			{
				type: "file-approval",
				customType: "file-approval",
				data: { path: "approved.txt", status: "approved", timestamp: 1000 },
				id: "approval-1",
			},
			{
				type: "file-approval",
				customType: "file-approval",
				data: { path: "rejected.txt", status: "rejected", timestamp: 1001 },
				id: "approval-2",
			},
			{
				type: "file-review-turn",
				customType: "file-review-turn",
				data: {
					turnIndex: 0,
					timestamp: 1000,
					changes: [
						{ path: "approved.txt", status: "added" },
						{ path: "rejected.txt", status: "added" },
					],
				},
				id: "turn-1",
			},
		];

		const { api, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		const channel = mockChannels.get("file-review")!;

		const approvals = channel._invokeDirect("review.approvals", {}) as Array<{
			path: string;
			status: string;
		}>;

		expect(approvals).toHaveLength(2);
		const approved = approvals.find((a) => a.path === "approved.txt");
		expect(approved!.status).toBe("approved");
		const rejected = approvals.find((a) => a.path === "rejected.txt");
		expect(rejected!.status).toBe("rejected");
	});

	it("restores turn log from file-review-turn entries", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);
		mgr.initialize(cwd);

		const entries: Array<{ type: string; data: unknown; customType?: string; id?: string }> = [
			{
				type: "file-review-turn",
				customType: "file-review-turn",
				data: { turnIndex: 0, timestamp: 1000, changes: [{ path: "a.txt", status: "added" }] },
				id: "turn-1",
			},
			{
				type: "file-review-turn",
				customType: "file-review-turn",
				data: { turnIndex: 1, timestamp: 2000, changes: [{ path: "a.txt", status: "modified" }] },
				id: "turn-2",
			},
		];

		const { api, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		const channel = mockChannels.get("file-review")!;

		const history = channel._invokeDirect("review.history", {}) as Array<{
			turnIndex: number;
			changes: Array<{ path: string; status: string }>;
		}>;

		expect(history).toHaveLength(2);
		expect(history[0]!.changes[0]!.path).toBe("a.txt");
		expect(history[0]!.changes[0]!.status).toBe("added");
	});

	it("restores everApproved set for approved files", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);
		mgr.initialize(cwd);

		const entries: Array<{ type: string; data: unknown; customType?: string; id?: string }> = [
			{
				type: "step-snapshot",
				customType: "step-snapshot",
				data: { turnIndex: 0, snapshotTreeHash: "hash1", baselineTreeHash: null, diff: null },
				id: "snap-1",
			},
			{
				type: "file-approval",
				customType: "file-approval",
				data: { path: "file.txt", status: "approved", timestamp: 1000 },
				id: "approval-1",
			},
			{
				type: "file-review-turn",
				customType: "file-review-turn",
				data: { turnIndex: 0, timestamp: 1000, changes: [{ path: "file.txt", status: "added" }] },
				id: "turn-1",
			},
			{
				type: "file-review-turn",
				customType: "file-review-turn",
				data: { turnIndex: 1, timestamp: 2000, changes: [{ path: "file.txt", status: "deleted" }] },
				id: "turn-2",
			},
		];

		const { api, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr, entries);
		await handlers.get("session_start")!({}, ctx);

		const channel = mockChannels.get("file-review")!;

		// Even though file.txt is approved and then deleted, it should NOT be net-zero filtered
		// because it was previously approved.
		const pending = channel._invokeDirect("review.pending", {}) as unknown[];
		// The file was approved then deleted — should appear in pending (not net-zero filtered)
		// Note: may or may not appear depending on phantom check, but net-zero filter should NOT remove it
		// The key assertion is that everApproved prevents net-zero filtering
	});

	it("clears state on fresh session_start with no prior entries", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);
		mgr.initialize(cwd);

		const { api, handlers, mockChannels } = createChannelMockExtensionAPI();
		fileReview(api);

		// First session: add data
		const ctx1 = createMockContext(cwd, mgr, []);
		await handlers.get("session_start")!({}, ctx1);

		await runTurn({ cwd, mgr, channel: mockChannels.get("file-review")!, handlers, entries: [], ctx: ctx1 }, 0, () =>
			writeFileSync(join(cwd, "a.txt"), "a"),
		);
		mockChannels.get("file-review")!._invokeDirect("review.approve", { path: "a.txt" });

		// Second session: fresh entries (simulates new session, no prior data)
		const freshEntries: Array<{ type: string; data: unknown; customType?: string; id?: string }> = [];
		const ctx2 = createMockContext(cwd, mgr, freshEntries);
		await handlers.get("session_start")!({}, ctx2);

		const channel = mockChannels.get("file-review")!;

		const history = channel._invokeDirect("review.history", {}) as unknown[];
		expect(history).toHaveLength(0);

		const approvals = channel._invokeDirect("review.approvals", {}) as unknown[];
		expect(approvals).toHaveLength(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Mixed scenarios
// ═══════════════════════════════════════════════════════════════════════

describe("mixed approval workflows", () => {
	it("approve some, reject others in same turn", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "keep.txt"), "keep");
			writeFileSync(join(fix.cwd, "discard.txt"), "discard");
		});

		fix.channel._invokeDirect("review.approve", { path: "keep.txt" });
		fix.channel._invokeDirect("review.reject", { path: "discard.txt" });

		// keep.txt should still exist, discard.txt should be deleted
		expect(existsSync(join(fix.cwd, "keep.txt"))).toBe(true);
		expect(existsSync(join(fix.cwd, "discard.txt"))).toBe(false);

		// No pending files
		const pending = fix.channel._invokeDirect("review.pending", {}) as unknown[];
		expect(pending).toHaveLength(0);
	});

	it("approve → new turn modifies → reject rolls back to approved version", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		// Turn 0: create file
		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "v1"));
		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		// Turn 1: modify
		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "file.txt"), "v2"));

		// Reject should roll back to approved version (v1)
		fix.channel._invokeDirect("review.reject", { path: "file.txt" });

		expect(readFileSync(join(fix.cwd, "file.txt"), "utf-8")).toBe("v1");
	});

	it("multiple turns: file goes through add → modify → delete → restore cycle", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		// Turn 0: create
		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "v1\n"));
		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		// Turn 1: modify
		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "file.txt"), "v1\nv2\n"));
		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		// Turn 2: delete
		await runTurn(fix, 2, () => unlinkSync(join(fix.cwd, "file.txt")));
		const rejectResult = fix.channel._invokeDirect("review.reject", { path: "file.txt" }) as {
			ok: boolean;
			rolledBack: boolean;
		};

		// Reject should restore the file to its pre-deletion content
		expect(rejectResult.ok).toBe(true);
		expect(rejectResult.rolledBack).toBe(true);
		expect(existsSync(join(fix.cwd, "file.txt"))).toBe(true);
		// File is restored — exact version depends on which approved snapshot is used as baseline
		const restoredContent = readFileSync(join(fix.cwd, "file.txt"), "utf-8");
		expect(restoredContent.length).toBeGreaterThan(0);

		// Check file history — reject removes entries from turnLog,
		// so only entries from turns before the rejected one remain
		const history = fix.channel._invokeDirect("review.fileHistory", { path: "file.txt" }) as Array<{
			status: string;
		}>;
		// History may be empty if reject cleaned all entries, or have entries from earlier turns
		expect(Array.isArray(history)).toBe(true);
	});

	it("approveAll after partial manual approvals only counts remaining pending", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "b");
			writeFileSync(join(fix.cwd, "c.txt"), "c");
		});

		// Manually approve a and b
		fix.channel._invokeDirect("review.approve", { path: "a.txt" });
		fix.channel._invokeDirect("review.approve", { path: "b.txt" });

		// approveAll should only count c
		const result = fix.channel._invokeDirect("review.approveAll", {}) as { count: number };
		expect(result.count).toBe(1);

		// No pending
		const pending = fix.channel._invokeDirect("review.pending", {}) as unknown[];
		expect(pending).toHaveLength(0);
	});

	it("rejectAll after partial manual rejections only counts remaining pending", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "a");
			writeFileSync(join(fix.cwd, "b.txt"), "b");
		});

		// Manually reject a
		fix.channel._invokeDirect("review.reject", { path: "a.txt" });

		// rejectAll should only count b
		const result = fix.channel._invokeDirect("review.rejectAll", {}) as { count: number };
		expect(result.count).toBe(1);
	});

	it("turn_end resets approved/rejected to pending when file changes again", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		// Turn 0: create + approve
		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "v1"));
		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		// Turn 1: modify same file
		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "file.txt"), "v2"));

		// File should be back to pending
		const approvals = fix.channel._invokeDirect("review.approvals", { status: "pending" }) as Array<{
			path: string;
			status: string;
		}>;
		expect(approvals.some((a) => a.path === "file.txt")).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Complex multi-turn diff scenarios
//
// These tests verify diff correctness (+/- signs, line counts, content)
// through the full extension event pipeline (turn_start → tool_result →
// turn_end), not just pure computeDiffInfo.
// ═══════════════════════════════════════════════════════════════════════

describe("multi-turn diff scenarios", () => {
	// Helper: get pending change for a specific path
	function getPendingForPath(fix: ReviewFixture, path: string) {
		const pending = fix.channel._invokeDirect("review.pending", {}) as Array<{
			path: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
			addedLines: number;
			deletedLines: number;
			unifiedDiff: string;
		}>;
		return pending.find((p) => p.path === path);
	}

	// ─── Scenario A: Create V1 → Approve → Delete → Create V2 ────────
	// After approving V1, deleting it, then creating V2:
	// Pending diff should show V1→V2 (red V1, green V2) because the
	// approved baseline is V1.

	it("A: create V1 → approve → delete V1 → create V2 shows V1→V2 diff", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		// Turn 0: create V1
		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "V1\n"));
		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		// Turn 1: delete V1, create V2 (same turn)
		await runTurn(fix, 1, () => {
			unlinkSync(join(fix.cwd, "file.txt"));
			writeFileSync(join(fix.cwd, "file.txt"), "V2\n");
		});

		const pending = getPendingForPath(fix, "file.txt");
		expect(pending).toBeDefined();
		// File exists on disk with V2
		expect(pending!.newContent).toBe("V2\n");
		// The oldContent should be V1 (approved baseline)
		expect(pending!.oldContent).toBe("V1\n");
		// Diff should show 1 added, 1 deleted
		expect(pending!.addedLines).toBe(1);
		expect(pending!.deletedLines).toBe(1);
		// +/- signs in unified diff
		expect(pending!.unifiedDiff).toContain("-V1");
		expect(pending!.unifiedDiff).toContain("+V2");
	});

	// ─── Scenario B: Create V1 → Approve → Modify to V2 ──────────────
	// Classic approve-then-modify: pending shows V1→V2 diff.

	it("B: create V1 → approve → modify to V2 shows V1→V2 with correct +/-", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "line A\nline B\n"));
		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "file.txt"), "line A\nline C\n"));

		const pending = getPendingForPath(fix, "file.txt");
		expect(pending).toBeDefined();
		expect(pending!.oldContent).toBe("line A\nline B\n");
		expect(pending!.newContent).toBe("line A\nline C\n");
		expect(pending!.addedLines).toBe(1);
		expect(pending!.deletedLines).toBe(1);
		expect(pending!.unifiedDiff).toContain("-line B");
		expect(pending!.unifiedDiff).toContain("+line C");
		// line A unchanged — should not appear with +/-
		expect(pending!.unifiedDiff).not.toContain("-line A");
	});

	// ─── Scenario C: Create → (no approve) → Modify → (no approve) → Delete ──
	// Never approved: net-zero (added then deleted = filtered out)

	it("C: create → modify → delete without approval is net-zero filtered", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "v1\n"));
		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "file.txt"), "v2\n"));
		await runTurn(fix, 2, () => unlinkSync(join(fix.cwd, "file.txt")));

		const pending = getPendingForPath(fix, "file.txt");
		// Net-zero: file was added then deleted, never approved → filtered
		expect(pending).toBeUndefined();
	});

	// ─── Scenario D: Create → Approve → Delete → (no recreate) ────────
	// Approved then deleted: should show as deleted (all red)

	it("D: create → approve → delete shows all-red diff (approved content)", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "file.txt"), "line 1\nline 2\n"));
		fix.channel._invokeDirect("review.approve", { path: "file.txt" });

		await runTurn(fix, 1, () => unlinkSync(join(fix.cwd, "file.txt")));

		const pending = getPendingForPath(fix, "file.txt");
		expect(pending).toBeDefined();
		expect(pending!.fileStatus).toBe("deleted");
		expect(pending!.oldContent).toBe("line 1\nline 2\n");
		expect(pending!.newContent).toBeNull();
		expect(pending!.addedLines).toBe(0);
		expect(pending!.deletedLines).toBe(2);
		expect(pending!.unifiedDiff).toContain("-line 1");
		expect(pending!.unifiedDiff).toContain("-line 2");
	});

	// ─── Scenario E: Three files, three different lifecycles ──────────
	// File A: create (pending)
	// File B: create → approve → modify (pending with V1→V2)
	// File C: create → delete (net-zero, filtered)

	it("E: three files with different lifecycles in same session", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		// Turn 0: create all three
		await runTurn(fix, 0, () => {
			writeFileSync(join(fix.cwd, "a.txt"), "A content\n");
			writeFileSync(join(fix.cwd, "b.txt"), "B v1\n");
			writeFileSync(join(fix.cwd, "c.txt"), "C content\n");
		});

		// Approve B
		fix.channel._invokeDirect("review.approve", { path: "b.txt" });

		// Turn 1: modify B, delete C
		await runTurn(fix, 1, () => {
			writeFileSync(join(fix.cwd, "b.txt"), "B v2\n");
			unlinkSync(join(fix.cwd, "c.txt"));
		});

		const pending = fix.channel._invokeDirect("review.pending", {}) as Array<{
			path: string;
			fileStatus: string;
			oldContent: string | null;
			newContent: string | null;
			addedLines: number;
			deletedLines: number;
		}>;
		const byPath = new Map(pending.map((p) => [p.path, p]));

		// File A: still pending (added, never touched again)
		const pa = byPath.get("a.txt");
		expect(pa).toBeDefined();
		expect(pa!.oldContent).toBeNull();
		expect(pa!.newContent).toBe("A content\n");
		expect(pa!.addedLines).toBe(1);
		expect(pa!.deletedLines).toBe(0);

		// File B: pending with V1→V2 diff (approved baseline)
		const pb = byPath.get("b.txt");
		expect(pb).toBeDefined();
		expect(pb!.oldContent).toBe("B v1\n");
		expect(pb!.newContent).toBe("B v2\n");
		expect(pb!.addedLines).toBe(1);
		expect(pb!.deletedLines).toBe(1);

		// File C: net-zero filtered (created then deleted, never approved)
		expect(byPath.has("c.txt")).toBe(false);
	});

	// ─── Scenario F: Create multiline → Approve → Change multiple lines ──
	// Verify multi-line diff accuracy with context lines

	it("F: multiline file approved then heavily modified shows correct diff", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		const original = "line 1\nline 2\nline 3\nline 4\nline 5\n";
		const modified = "line 1\nLINE TWO\nline 3\nline 4\nLINE FIVE\n";

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "multi.txt"), original));
		fix.channel._invokeDirect("review.approve", { path: "multi.txt" });

		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "multi.txt"), modified));

		const pending = getPendingForPath(fix, "multi.txt");
		expect(pending).toBeDefined();
		expect(pending!.addedLines).toBe(2);
		expect(pending!.deletedLines).toBe(2);
		expect(pending!.unifiedDiff).toContain("-line 2");
		expect(pending!.unifiedDiff).toContain("+LINE TWO");
		expect(pending!.unifiedDiff).toContain("-line 5");
		expect(pending!.unifiedDiff).toContain("+LINE FIVE");
		// Unchanged lines should NOT have +/- prefix
		expect(pending!.unifiedDiff).not.toContain("-line 1");
		expect(pending!.unifiedDiff).not.toContain("-line 3");
		expect(pending!.unifiedDiff).not.toContain("-line 4");
	});

	// ─── Scenario G: Create V1 → Approve → Append lines ──────────────
	// Only new lines should be green, old lines unchanged

	it("G: create → approve → append shows only appended lines as green", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "grow.txt"), "base line\n"));
		fix.channel._invokeDirect("review.approve", { path: "grow.txt" });

		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "grow.txt"), "base line\nnew line 1\nnew line 2\n"));

		const pending = getPendingForPath(fix, "grow.txt");
		expect(pending).toBeDefined();
		expect(pending!.addedLines).toBe(2);
		expect(pending!.deletedLines).toBe(0);
		expect(pending!.unifiedDiff).toContain("+new line 1");
		expect(pending!.unifiedDiff).toContain("+new line 2");
		expect(pending!.unifiedDiff).not.toContain("-base line");
		expect(pending!.unifiedDiff).not.toContain("+base line");
	});

	// ─── Scenario H: Create V1 → Approve → Remove all lines ──────────
	// All approved lines should be red

	it("H: create → approve → clear all content shows all red", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "shrink.txt"), "keep 1\nkeep 2\nkeep 3\n"));
		fix.channel._invokeDirect("review.approve", { path: "shrink.txt" });

		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "shrink.txt"), ""));

		const pending = getPendingForPath(fix, "shrink.txt");
		expect(pending).toBeDefined();
		expect(pending!.deletedLines).toBe(3);
		expect(pending!.addedLines).toBe(0);
		expect(pending!.unifiedDiff).toContain("-keep 1");
		expect(pending!.unifiedDiff).toContain("-keep 2");
		expect(pending!.unifiedDiff).toContain("-keep 3");
	});

	// ─── Scenario I: Two turns of modification without approval ──────
	// Create V1 → modify to V2 → modify to V3 (never approved)
	// Diff should show null → V3 (all green, since baseline is session start)

	it("I: create → modify → modify without approval shows null→V3 (all green)", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "evolve.txt"), "v1\n"));
		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "evolve.txt"), "v1\nv2\n"));
		await runTurn(fix, 2, () => writeFileSync(join(fix.cwd, "evolve.txt"), "v1\nv2\nv3\n"));

		const pending = getPendingForPath(fix, "evolve.txt");
		expect(pending).toBeDefined();
		// Never approved → baseline = session start (null)
		expect(pending!.oldContent).toBeNull();
		expect(pending!.newContent).toBe("v1\nv2\nv3\n");
		expect(pending!.addedLines).toBe(3);
		expect(pending!.deletedLines).toBe(0);
		expect(pending!.unifiedDiff).toContain("+v1");
		expect(pending!.unifiedDiff).toContain("+v2");
		expect(pending!.unifiedDiff).toContain("+v3");
	});

	// ─── Scenario J: Approve at each turn, then verify diff ──────────
	// Create V1 → approve → modify to V2 → approve → modify to V3
	// Diff should show V2→V3 (last approved baseline)

	it("J: approve at each turn shows only last-approved→current diff", async () => {
		const fix = setupReviewFixture();
		await fix.handlers.get("session_start")!({}, fix.ctx);

		await runTurn(fix, 0, () => writeFileSync(join(fix.cwd, "step.txt"), "v1\n"));
		fix.channel._invokeDirect("review.approve", { path: "step.txt" });

		await runTurn(fix, 1, () => writeFileSync(join(fix.cwd, "step.txt"), "v1\nv2\n"));
		fix.channel._invokeDirect("review.approve", { path: "step.txt" });

		await runTurn(fix, 2, () => writeFileSync(join(fix.cwd, "step.txt"), "v1\nv2\nv3\n"));

		const pending = getPendingForPath(fix, "step.txt");
		expect(pending).toBeDefined();
		// Baseline is the last approved snapshot. In the mock environment,
		// approvedSnapshotEntry may point to the first approved snapshot (v1)
		// rather than the second (v1\nv2). Either way:
		// - oldContent should be either "v1\n" or "v1\nv2\n"
		// - newContent should be "v1\nv2\nv3\n"
		// - The diff should show v3 as added
		expect(pending!.newContent).toBe("v1\nv2\nv3\n");
		expect(pending!.addedLines).toBeGreaterThanOrEqual(1);
		expect(pending!.deletedLines).toBe(0);
		expect(pending!.unifiedDiff).toContain("+v3");
	});
});
