/**
 * Tests for file-review extension diff accuracy.
 *
 * Verifies:
 * 1. FileSnapshotManager.getLiveChanges() returns correct diff data
 * 2. FileSnapshotManager.getBatchFileContents() returns correct oldContent/newContent
 * 3. file-review extension captures correct changes via event handlers
 * 4. Net-zero filtering (added then deleted without approval)
 * 5. Diff data is suitable for frontend red/green rendering
 */

import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TurnEndEvent } from "@dyyz1993/pi-coding-agent";
// Re-import computeDiffInfo for direct testing
import * as Diff from "diff";
import { afterEach, describe, expect, it } from "vitest";
import fileReview from "../../extensions/file-review/index.ts";
import { FileSnapshotManager, type LiveChange } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import type { ExtensionAPI, ExtensionContext } from "../../src/index.ts";

function computeDiffInfo(oldContent: string | null, newContent: string | null) {
	if (oldContent === null && newContent === null) {
		return { unifiedDiff: "", addedLines: 0, deletedLines: 0 };
	}

	const oldText = oldContent ?? "";
	const newText = newContent ?? "";

	if (oldContent === null) {
		const lines = newText.split("\n");
		const trailing = newText.endsWith("\n") ? 1 : 0;
		return {
			unifiedDiff: Diff.createTwoFilesPatch("", "", "", newText, undefined, undefined, { context: 3 }),
			addedLines: lines.length - trailing,
			deletedLines: 0,
		};
	}

	if (newContent === null) {
		const lines = oldText.split("\n");
		const trailing = oldText.endsWith("\n") ? 1 : 0;
		return {
			unifiedDiff: Diff.createTwoFilesPatch("", "", oldText, "", undefined, undefined, { context: 3 }),
			addedLines: 0,
			deletedLines: lines.length - trailing,
		};
	}

	const changes = Diff.diffLines(oldText, newText);
	let addedLines = 0;
	let deletedLines = 0;

	for (const part of changes) {
		if (part.added) {
			const lines = part.value.split("\n");
			addedLines += lines.length - (part.value.endsWith("\n") ? 1 : 0);
		} else if (part.removed) {
			const lines = part.value.split("\n");
			deletedLines += lines.length - (part.value.endsWith("\n") ? 1 : 0);
		}
	}

	const unifiedDiff = Diff.createTwoFilesPatch("", "", oldText, newText, undefined, undefined, { context: 3 });

	return { unifiedDiff, addedLines, deletedLines };
}

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
	const d = `/tmp/pi-file-review-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	tempDirs.push(d);
	return d;
}

// ─── FileSnapshotManager diff accuracy tests ─────────────────────────

describe("FileSnapshotManager.getLiveChanges - diff accuracy", () => {
	it("detects added file with null oldContent and correct newContent", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		writeFileSync(join(cwd, "new-file.txt"), "hello world");

		const changes = mgr.getLiveChanges(cwd);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("new-file.txt");
		expect(changes[0]!.status).toBe("added");
		expect(changes[0]!.diff).not.toBeNull();
		expect(changes[0]!.diff!.oldContent).toBeNull();
		expect(changes[0]!.diff!.newContent).toBe("hello world");
	});

	it("detects modified file with correct oldContent and newContent", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "original content");
		mgr.initialize(cwd);

		writeFileSync(join(cwd, "file.txt"), "modified content");

		const changes = mgr.getLiveChanges(cwd);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("file.txt");
		expect(changes[0]!.status).toBe("modified");
		expect(changes[0]!.diff).not.toBeNull();
		expect(changes[0]!.diff!.oldContent).toBe("original content");
		expect(changes[0]!.diff!.newContent).toBe("modified content");
	});

	it("detects deleted file with correct oldContent and null newContent", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "to-delete.txt"), "will be deleted");
		mgr.initialize(cwd);

		unlinkSync(join(cwd, "to-delete.txt"));

		const changes = mgr.getLiveChanges(cwd);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.path).toBe("to-delete.txt");
		expect(changes[0]!.status).toBe("deleted");
		expect(changes[0]!.diff).not.toBeNull();
		expect(changes[0]!.diff!.oldContent).toBe("will be deleted");
		expect(changes[0]!.diff!.newContent).toBeNull();
	});

	it("detects multiple changes across different files", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "keep.txt"), "keep");
		writeFileSync(join(cwd, "modify.txt"), "old");
		mgr.initialize(cwd);

		writeFileSync(join(cwd, "modify.txt"), "new");
		writeFileSync(join(cwd, "added.txt"), "brand new");
		unlinkSync(join(cwd, "keep.txt"));

		const changes = mgr.getLiveChanges(cwd);
		const byPath = new Map(changes.map((c) => [c.path, c]));

		expect(byPath.size).toBe(3);

		const modifyChange = byPath.get("modify.txt");
		expect(modifyChange!.status).toBe("modified");
		expect(modifyChange!.diff!.oldContent).toBe("old");
		expect(modifyChange!.diff!.newContent).toBe("new");

		const addedChange = byPath.get("added.txt");
		expect(addedChange!.status).toBe("added");
		expect(addedChange!.diff!.oldContent).toBeNull();
		expect(addedChange!.diff!.newContent).toBe("brand new");

		const deletedChange = byPath.get("keep.txt");
		expect(deletedChange!.status).toBe("deleted");
		expect(deletedChange!.diff!.oldContent).toBe("keep");
		expect(deletedChange!.diff!.newContent).toBeNull();
	});

	it("returns empty array when no changes", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "unchanged");
		mgr.initialize(cwd);

		const changes = mgr.getLiveChanges(cwd);
		expect(changes).toHaveLength(0);
	});

	it("correctly diffs multiline content with additions and deletions", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		const oldContent = ["line 1: keep", "line 2: keep", "line 3: remove", "line 4: keep", "line 5: keep"].join("\n");

		writeFileSync(join(cwd, "multiline.txt"), oldContent);
		mgr.initialize(cwd);

		const newContent = ["line 1: keep", "line 2: keep", "line 4: keep", "line 5: keep", "line 6: added"].join("\n");

		writeFileSync(join(cwd, "multiline.txt"), newContent);

		const changes = mgr.getLiveChanges(cwd);
		expect(changes).toHaveLength(1);
		expect(changes[0]!.status).toBe("modified");
		expect(changes[0]!.diff!.oldContent).toBe(oldContent);
		expect(changes[0]!.diff!.newContent).toBe(newContent);
	});
});

// ─── getBatchFileContents accuracy tests ─────────────────────────────

describe("FileSnapshotManager.getBatchFileContents - diff accuracy", () => {
	it("compares session start to last committed tree (no fromEntryId)", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		// Initial file
		writeFileSync(join(cwd, "file.txt"), "original");
		mgr.initialize(cwd);

		// Turn 0: modify file and commit snapshot
		writeFileSync(join(cwd, "file.txt"), "after-turn-0");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		// Without fromEntryId, getBatchFileContents compares
		// sessionStartTreeHash -> lastCommittedTreeHash
		const result = mgr.getBatchFileContents([{ filePath: "file.txt" }]);
		const content = result.get("file.txt");

		expect(content).toBeDefined();
		// oldContent = from sessionStartTreeHash (original)
		expect(content!.oldContent).toBe("original");
		// newContent = from lastCommittedTreeHash (after-turn-0)
		expect(content!.newContent).toBe("after-turn-0");
	});

	it("does NOT reflect uncommitted disk changes", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "original");
		mgr.initialize(cwd);

		writeFileSync(join(cwd, "file.txt"), "committed");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		// Uncommitted change on disk
		writeFileSync(join(cwd, "file.txt"), "uncommitted");

		const result = mgr.getBatchFileContents([{ filePath: "file.txt" }]);
		const content = result.get("file.txt");

		// getBatchFileContents compares trees, not disk
		expect(content!.oldContent).toBe("original");
		expect(content!.newContent).toBe("committed");
		// NOT "uncommitted" - this is important!
	});

	it("returns null oldContent for newly added file", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		writeFileSync(join(cwd, "new.txt"), "brand new");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		const result = mgr.getBatchFileContents([{ filePath: "new.txt" }]);
		const content = result.get("new.txt");

		expect(content).toBeDefined();
		expect(content!.oldContent).toBeNull();
		expect(content!.newContent).toBe("brand new");
	});

	it("returns null newContent for deleted file", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "to-delete.txt"), "will be deleted");
		mgr.initialize(cwd);

		unlinkSync(join(cwd, "to-delete.txt"));
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		const result = mgr.getBatchFileContents([{ filePath: "to-delete.txt" }]);
		const content = result.get("to-delete.txt");

		expect(content).toBeDefined();
		expect(content!.oldContent).toBe("will be deleted");
		expect(content!.newContent).toBeNull();
	});

	it("handles batch request for multiple files efficiently", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "a.txt"), "original-a");
		writeFileSync(join(cwd, "b.txt"), "original-b");
		mgr.initialize(cwd);

		writeFileSync(join(cwd, "a.txt"), "modified-a");
		writeFileSync(join(cwd, "c.txt"), "new-c");
		unlinkSync(join(cwd, "b.txt"));
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		const result = mgr.getBatchFileContents([{ filePath: "a.txt" }, { filePath: "b.txt" }, { filePath: "c.txt" }]);

		expect(result.get("a.txt")).toEqual({ oldContent: "original-a", newContent: "modified-a" });
		expect(result.get("b.txt")).toEqual({ oldContent: "original-b", newContent: null });
		expect(result.get("c.txt")).toEqual({ oldContent: null, newContent: "new-c" });
	});

	it("returns empty map for empty file list", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);
		const result = mgr.getBatchFileContents([]);
		expect(result.size).toBe(0);
	});
});

// ─── file-review extension logic tests ───────────────────────────────

describe("file-review extension - diff and count accuracy", () => {
	function createMockExtensionAPI() {
		const entries: Array<{ type: string; data: unknown }> = [];
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();

		const api = {
			on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) => {
				handlers.set(event, handler);
			},
			appendEntry: (type: string, data: unknown) => {
				entries.push({ type, data });
				return `${type}-${entries.length}`;
			},
			registerChannel: () => {
				throw new Error("registerChannel only available in RPC mode");
			},
		} as unknown as ExtensionAPI;

		return { api, entries, handlers };
	}

	function createMockContext(cwd: string, mgr: FileSnapshotManager): ExtensionContext {
		return {
			cwd,
			fileSnapshotManager: mgr,
			sessionManager: {
				getEntries: () => [],
				getSessionDir: () => cwd,
			},
		} as unknown as ExtensionContext;
	}

	it("captures changes from turn_end and produces correct summary counts", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "original");
		mgr.initialize(cwd);

		const { api, entries, handlers } = createMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr);
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("turn_start")!({}, ctx);

		// tool_result: modify + add
		writeFileSync(join(cwd, "file.txt"), "modified");
		writeFileSync(join(cwd, "new.txt"), "added");
		await handlers.get("tool_result")!({}, ctx);

		// turn_end
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);

		const turnEntries = entries.filter((e) => e.type === "file-review-turn");
		expect(turnEntries).toHaveLength(1);

		const turnData = turnEntries[0]!.data as {
			turnIndex: number;
			timestamp: number;
			changes: Array<{ path: string; status: string }>;
		};
		expect(turnData.turnIndex).toBe(0);

		const changesByPath = new Map(turnData.changes.map((c: { path: string; status: string }) => [c.path, c.status]));
		expect(changesByPath.get("file.txt")).toBe("modified");
		expect(changesByPath.get("new.txt")).toBe("added");
	});

	it("captures deletion in turn_end changes", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "to-delete.txt"), "delete me");
		writeFileSync(join(cwd, "keep.txt"), "keep me");
		mgr.initialize(cwd);

		unlinkSync(join(cwd, "to-delete.txt"));

		const { api, entries, handlers } = createMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr);
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);

		const turnEntries = entries.filter((e) => e.type === "file-review-turn");
		expect(turnEntries).toHaveLength(1);

		const turnData = turnEntries[0]!.data as {
			changes: Array<{ path: string; status: string }>;
		};
		const changesByPath = new Map(turnData.changes.map((c: { path: string; status: string }) => [c.path, c.status]));
		expect(changesByPath.get("to-delete.txt")).toBe("deleted");
		expect(changesByPath.get("keep.txt")).toBeUndefined();
	});

	it("aggregates across multiple turns", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		const { api, entries, handlers } = createMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr);
		await handlers.get("session_start")!({}, ctx);

		// Turn 0: add file
		writeFileSync(join(cwd, "file.txt"), "v1");

		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);

		// Simulate file-snapshot extension committing the snapshot
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		// Turn 1: modify file
		writeFileSync(join(cwd, "file.txt"), "v2");

		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 1 } as TurnEndEvent, ctx);

		// Simulate file-snapshot extension committing the snapshot
		mgr.onTurnEnd(cwd, 1, (type, _data) => `${type}-1`);

		const turnEntries = entries.filter((e) => e.type === "file-review-turn");
		expect(turnEntries).toHaveLength(2);

		const turn0Changes = (turnEntries[0]!.data as { changes: Array<{ path: string; status: string }> }).changes;
		const turn1Changes = (turnEntries[1]!.data as { changes: Array<{ path: string; status: string }> }).changes;

		expect(turn0Changes.some((c) => c.path === "file.txt" && c.status === "added")).toBe(true);
		expect(turn1Changes.some((c) => c.path === "file.txt" && c.status === "modified")).toBe(true);
	});

	it("does not record a turn entry when no changes occurred", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "unchanged");
		mgr.initialize(cwd);

		const { api, entries, handlers } = createMockExtensionAPI();
		fileReview(api);

		const ctx = createMockContext(cwd, mgr);
		await handlers.get("session_start")!({}, ctx);
		await handlers.get("turn_start")!({}, ctx);
		await handlers.get("tool_result")!({}, ctx);
		await handlers.get("turn_end")!({ turnIndex: 0 } as TurnEndEvent, ctx);

		const turnEntries = entries.filter((e) => e.type === "file-review-turn");
		expect(turnEntries).toHaveLength(0);
	});
});

// ─── PendingChange data accuracy (simulated) ────────────────────────

describe("file-review pending change - diff data accuracy", () => {
	it("getBatchFileContents returns correct content for pending changes scenario", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "existing.txt"), "original");
		mgr.initialize(cwd);

		writeFileSync(join(cwd, "existing.txt"), "modified");
		writeFileSync(join(cwd, "new.txt"), "brand new");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		const result = mgr.getBatchFileContents([{ filePath: "existing.txt" }, { filePath: "new.txt" }]);

		const existing = result.get("existing.txt");
		expect(existing!.oldContent).toBe("original");
		expect(existing!.newContent).toBe("modified");

		const newFile = result.get("new.txt");
		expect(newFile!.oldContent).toBeNull();
		expect(newFile!.newContent).toBe("brand new");
	});

	it("getBatchFileContents handles deleted file correctly", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "doomed.txt"), "about to be deleted");
		mgr.initialize(cwd);

		unlinkSync(join(cwd, "doomed.txt"));
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		const result = mgr.getBatchFileContents([{ filePath: "doomed.txt" }]);
		const content = result.get("doomed.txt");

		expect(content!.oldContent).toBe("about to be deleted");
		expect(content!.newContent).toBeNull();
	});

	it("getLiveChanges produces content suitable for unified diff generation", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		const oldLines = ["function foo() {", "  return 1;", "}"];
		const newLines = ["function foo() {", "  return 2;", "}", "// added comment"];

		writeFileSync(join(cwd, "code.ts"), oldLines.join("\n"));
		mgr.initialize(cwd);

		writeFileSync(join(cwd, "code.ts"), newLines.join("\n"));

		const changes = mgr.getLiveChanges(cwd);
		expect(changes).toHaveLength(1);

		const change = changes[0]!;
		expect(change.diff).not.toBeNull();

		expect(change.diff!.oldContent).toBe(oldLines.join("\n"));
		expect(change.diff!.newContent).toBe(newLines.join("\n"));
		expect(change.diff!.oldContent).not.toBe(change.diff!.newContent);
	});

	it("getBatchFileContents mismatch with getLiveChanges - uncommitted changes not reflected", () => {
		// This test documents a potential issue: review.pending uses getBatchFileContents
		// which compares committed trees, but the turnLog is populated from getLiveChanges
		// which compares disk vs committed tree. If there are uncommitted changes on disk,
		// the turnLog may list changes that getBatchFileContents doesn't reflect.
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		writeFileSync(join(cwd, "file.txt"), "original");
		mgr.initialize(cwd);

		// Commit turn 0
		writeFileSync(join(cwd, "file.txt"), "v1");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		// Uncommitted disk change
		writeFileSync(join(cwd, "file.txt"), "v2-uncommitted");

		// getLiveChanges sees the disk change
		const liveChanges = mgr.getLiveChanges(cwd);
		expect(liveChanges).toHaveLength(1);
		expect(liveChanges[0]!.diff!.newContent).toBe("v2-uncommitted");

		// But getBatchFileContents only sees committed trees
		const batchResult = mgr.getBatchFileContents([{ filePath: "file.txt" }]);
		expect(batchResult.get("file.txt")!.newContent).toBe("v1");
		// ^ This is "v1", NOT "v2-uncommitted"
	});
});

// ─── Net-zero filtering scenario ─────────────────────────────────────

describe("file-review net-zero scenario", () => {
	it("getLiveChanges detects added-then-deleted file correctly across turns", () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		// Turn 0: add file
		writeFileSync(join(cwd, "temp.txt"), "temporary");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		const changesAfterAdd = mgr.getLiveChanges(cwd);
		expect(changesAfterAdd).toHaveLength(0);

		// Turn 1: delete the file
		unlinkSync(join(cwd, "temp.txt"));
		mgr.onTurnEnd(cwd, 1, (type, _data) => `${type}-1`);

		const changesAfterDelete = mgr.getLiveChanges(cwd);
		expect(changesAfterDelete).toHaveLength(0);
	});
});

// ─── Multi-turn diff accuracy (V1→V2 without approval) ──────────────

describe("file-review multi-turn diff without approval", () => {
	it("shows V1→V2 diff when file created then modified without approval", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		// Turn 0: agent creates file with V1 content
		writeFileSync(join(cwd, "file.txt"), "V1 content\n");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		// Turn 1: agent modifies to V2 (still no approval)
		writeFileSync(join(cwd, "file.txt"), "V2 content\n");
		mgr.onTurnEnd(cwd, 1, (type, _data) => `${type}-1`);

		// Now simulate what review.pending does: getLiveChanges for newContent
		const liveChanges = mgr.getLiveChanges(cwd);
		expect(liveChanges).toHaveLength(0); // V2 is committed, no live diff

		// The file was committed as V2 in turn 1.
		// For the pending diff, we need V1→V2.
		// approvedSnapshotEntry is empty (never approved), so fromEntryId=undefined.
		// getBatchFileContents with no fromEntryId uses sessionStartTreeHash (no file.txt).
		// But the fallback walks snapshots to find oldContent.
		const batchResult = mgr.getBatchFileContents([{ filePath: "file.txt" }]);
		const content = batchResult.get("file.txt");

		// With fallback, oldContent should be V1 (found in turn 0's snapshot)
		// and newContent should be V2 (from last committed tree)
		expect(content!.newContent).toBe("V2 content\n");
		// This is the key assertion: oldContent should be V1, NOT null
		expect(content!.oldContent).toBe("V1 content\n");
	});

	it("shows correct diff when file is modified but turn hasn't ended yet", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		// Turn 0: create file with V1
		writeFileSync(join(cwd, "file.txt"), "V1 content\n");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		// Turn 1: modify to V2 but DON'T commit yet
		writeFileSync(join(cwd, "file.txt"), "V2 content\n");

		// getLiveChanges sees the uncommitted V2
		const liveChanges = mgr.getLiveChanges(cwd);
		expect(liveChanges).toHaveLength(1);
		expect(liveChanges[0]!.diff!.newContent).toBe("V2 content\n");
		expect(liveChanges[0]!.diff!.oldContent).toBe("V1 content\n");

		// getBatchFileContents does NOT see V2 (only committed trees)
		const batchResult = mgr.getBatchFileContents([{ filePath: "file.txt" }]);
		expect(batchResult.get("file.txt")!.newContent).toBe("V1 content\n");
		// ^ This confirms the bug: batch only sees committed data.
		// The fix uses getLiveChanges for newContent to capture uncommitted changes.
	});

	it("after approval, diff shows approved-snapshot vs live", async () => {
		const cwd = makeTempDir();
		const storeDir = makeTempDir();
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		mgr.initialize(cwd);

		// Turn 0: create V1
		writeFileSync(join(cwd, "file.txt"), "V1 content\n");
		mgr.onTurnEnd(cwd, 0, (type, _data) => `${type}-0`);

		// Turn 1: modify to V2
		writeFileSync(join(cwd, "file.txt"), "V2 content\n");

		// getLiveChanges correctly shows V1→V2
		const liveChanges = mgr.getLiveChanges(cwd);
		expect(liveChanges).toHaveLength(1);
		expect(liveChanges[0]!.diff!.oldContent).toBe("V1 content\n");
		expect(liveChanges[0]!.diff!.newContent).toBe("V2 content\n");
	});
});

describe("computeDiffInfo - unifiedDiff and line counts", () => {
	it("returns empty diff for null vs null", () => {
		const result = computeDiffInfo(null, null);
		expect(result.unifiedDiff).toBe("");
		expect(result.addedLines).toBe(0);
		expect(result.deletedLines).toBe(0);
	});

	it("counts all lines as added for new file", () => {
		const result = computeDiffInfo(null, "line 1\nline 2\nline 3\n");
		expect(result.addedLines).toBe(3);
		expect(result.deletedLines).toBe(0);
		expect(result.unifiedDiff).toContain("+line 1");
		expect(result.unifiedDiff).toContain("+line 2");
		expect(result.unifiedDiff).toContain("+line 3");
	});

	it("counts all lines as deleted for deleted file", () => {
		const result = computeDiffInfo("line 1\nline 2\n", null);
		expect(result.addedLines).toBe(0);
		expect(result.deletedLines).toBe(2);
		expect(result.unifiedDiff).toContain("-line 1");
		expect(result.unifiedDiff).toContain("-line 2");
	});

	it("counts added and deleted lines for modification", () => {
		const oldContent = "line 1\nline 2\nline 3\n";
		const newContent = "line 1\nline 2 modified\nline 3\nline 4\n";
		const result = computeDiffInfo(oldContent, newContent);

		expect(result.addedLines).toBe(2); // "line 2 modified" + "line 4"
		expect(result.deletedLines).toBe(1); // "line 2"
		expect(result.unifiedDiff).toContain("+line 2 modified");
		expect(result.unifiedDiff).toContain("-line 2");
		expect(result.unifiedDiff).toContain("+line 4");
	});

	it("handles single line change", () => {
		const result = computeDiffInfo("old", "new");
		expect(result.addedLines).toBe(1);
		expect(result.deletedLines).toBe(1);
		expect(result.unifiedDiff).toContain("+new");
		expect(result.unifiedDiff).toContain("-old");
	});

	it("returns zero counts when content is identical", () => {
		const result = computeDiffInfo("same content\n", "same content\n");
		expect(result.addedLines).toBe(0);
		expect(result.deletedLines).toBe(0);
	});

	it("handles empty string content", () => {
		const result = computeDiffInfo("", "added line\n");
		expect(result.addedLines).toBe(1);
		expect(result.deletedLines).toBe(0);
	});

	it("produces standard unified diff format with +++ and --- headers", () => {
		const result = computeDiffInfo("old\n", "new\n");
		expect(result.unifiedDiff).toContain("---");
		expect(result.unifiedDiff).toContain("+++");
		expect(result.unifiedDiff).toContain("@@");
	});
});
