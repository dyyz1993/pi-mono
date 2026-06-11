import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager, type StepSnapshotData } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

function customSnapshotEntry(
	id: string,
	parentId: string | null,
	timestamp: string,
	data: StepSnapshotData,
): SessionEntry {
	return {
		type: "custom",
		id,
		parentId,
		timestamp,
		customType: "step-snapshot",
		data,
	};
}

describe("FileSnapshotManager", () => {
	let testDir: string;
	let storeDir: string;

	beforeEach(() => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		testDir = join(tmpdir(), `pi-fsm-unit-${suffix}`);
		storeDir = join(tmpdir(), `pi-fsm-store-${suffix}`);
		mkdirSync(testDir, { recursive: true });
		mkdirSync(storeDir, { recursive: true });
	});

	describe("restoreFiles snapshotIndex cleanup", () => {
		it("full rollback removes entries after target from snapshotIndex", async () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["file.txt", "v1\n"]]));
			const tree2 = git.writeTree(new Map([["file.txt", "v2\n"]]));
			const tree3 = git.writeTree(new Map([["file.txt", "v3\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["file.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["file.txt"], deleted: [] },
					turnIndex: 1,
				}),
				customSnapshotEntry("snap-3", "p3", "2026-01-01T00:02:00.000Z", {
					baselineTreeHash: tree2.treeHash,
					snapshotTreeHash: tree3.treeHash,
					diff: { added: [], modified: ["file.txt"], deleted: [] },
					turnIndex: 2,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);
			writeFileSync(join(testDir, "file.txt"), "v3\n");

			// Before rollback: 3 snapshots
			expect(mgr.getModifiedFiles()).toHaveLength(1);

			// Rollback to snap-1 (v1)
			const result = await mgr.restoreFiles(testDir, {
				targetEntryId: "snap-1",
				entries,
				preview: false,
			});
			expect(result.restored).toContain("file.txt");
			expect(readFileSync(join(testDir, "file.txt"), "utf-8")).toBe("v1\n");

			// After rollback: snap-2 and snap-3 are gone from snapshotIndex
			const afterRollback = mgr.getModifiedFiles();
			expect(afterRollback).toHaveLength(0);
		});

		it("full rollback to root (sessionStart) clears all entries", async () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["file.txt", "v1\n"]]));
			const tree2 = git.writeTree(new Map([["file.txt", "v2\n"]]));

			// Simulate: session starts files in tree1, then modified in tree2
			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["file.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["file.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);
			writeFileSync(join(testDir, "file.txt"), "v2\n");

			// Rollback to root — pass targetEntryId that points to session start
			const result = await mgr.restoreFiles(testDir, {
				targetEntryId: "root",
				entries,
				preview: false,
			});

			// After rollback to root, snapshotIndex should be cleared
			const afterRollback = mgr.getModifiedFiles();
			expect(afterRollback).toHaveLength(0);
		});

		it("subset restore (options.files) does NOT clean snapshotIndex", async () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(
				new Map([
					["a.txt", "a1\n"],
					["b.txt", "b1\n"],
				]),
			);
			const tree2 = git.writeTree(
				new Map([
					["a.txt", "a2\n"],
					["b.txt", "b2\n"],
				]),
			);

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt", "b.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["a.txt", "b.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			writeFileSync(join(testDir, "a.txt"), "a2\n");
			writeFileSync(join(testDir, "b.txt"), "b2\n");

			// Subset restore — only a.txt, not b.txt
			await mgr.restoreFiles(testDir, {
				targetEntryId: "snap-1",
				files: ["a.txt"],
				entries,
				preview: false,
			});

			// getModifiedFiles returns both files from snapshotIndex (which wasn't cleaned)
			// because subset restore intentionally preserves all history for non-restored files
			const modified = mgr.getModifiedFiles();
			expect(modified.find((f) => f.path === "a.txt")).toBeDefined();
			expect(modified.find((f) => f.path === "b.txt")).toBeDefined();

			// Verify on-disk state: a.txt was restored to v1, b.txt still at v2
			expect(readFileSync(join(testDir, "a.txt"), "utf-8")).toBe("a1\n");
			expect(readFileSync(join(testDir, "b.txt"), "utf-8")).toBe("b2\n");
		});
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		rmSync(storeDir, { recursive: true, force: true });
	});

	describe("initialize", () => {
		it("creates session start baseline from working dir", () => {
			writeFileSync(join(testDir, "a.txt"), "hello\n");
			writeFileSync(join(testDir, "b.txt"), "world\n");

			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			const changes = mgr.getLiveChanges(testDir);
			expect(changes).toEqual([]);
		});

		it("is idempotent once snapshots exist (second call is no-op)", () => {
			writeFileSync(join(testDir, "a.txt"), "first\n");

			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			writeFileSync(join(testDir, "a.txt"), "second\n");
			mgr.onTurnEnd(testDir, 0, () => "snap-0");

			writeFileSync(join(testDir, "a.txt"), "changed-after-snap\n");

			mgr.initialize(testDir);

			const changes = mgr.getLiveChanges(testDir);
			expect(changes).toHaveLength(1);
			expect(changes[0]!.path).toBe("a.txt");
			expect(changes[0]!.status).toBe("modified");
		});
	});

	describe("getLiveChanges", () => {
		it("returns empty array when no files changed", () => {
			writeFileSync(join(testDir, "a.txt"), "content\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			expect(mgr.getLiveChanges(testDir)).toEqual([]);
		});

		it("detects added files", () => {
			writeFileSync(join(testDir, "a.txt"), "original\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			writeFileSync(join(testDir, "b.txt"), "new file\n");

			const changes = mgr.getLiveChanges(testDir);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({ path: "b.txt", status: "added" });
		});

		it("detects modified files", () => {
			writeFileSync(join(testDir, "a.txt"), "original\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			writeFileSync(join(testDir, "a.txt"), "modified\n");

			const changes = mgr.getLiveChanges(testDir);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({ path: "a.txt", status: "modified" });
		});

		it("detects deleted files", () => {
			writeFileSync(join(testDir, "a.txt"), "original\n");
			writeFileSync(join(testDir, "b.txt"), "keep\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			unlinkSync(join(testDir, "a.txt"));

			const changes = mgr.getLiveChanges(testDir);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({ path: "a.txt", status: "deleted" });
		});

		it("detects mixed add+modify+delete", () => {
			writeFileSync(join(testDir, "a.txt"), "original-a\n");
			writeFileSync(join(testDir, "b.txt"), "original-b\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			writeFileSync(join(testDir, "a.txt"), "changed-a\n");
			unlinkSync(join(testDir, "b.txt"));
			writeFileSync(join(testDir, "c.txt"), "new-c\n");

			const changes = mgr.getLiveChanges(testDir);
			expect(changes).toHaveLength(3);

			const byPath = new Map(changes.map((c) => [c.path, c]));
			expect(byPath.get("a.txt")?.status).toBe("modified");
			expect(byPath.get("b.txt")?.status).toBe("deleted");
			expect(byPath.get("c.txt")?.status).toBe("added");
		});

		it("returns changes relative to lastCommittedTreeHash, not sessionStart", () => {
			writeFileSync(join(testDir, "a.txt"), "v1\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			const entries: SessionEntry[] = [];
			writeFileSync(join(testDir, "a.txt"), "v2\n");
			mgr.onTurnEnd(testDir, 0, (_type, data) => {
				const id = `snap-${entries.length}`;
				entries.push(customSnapshotEntry(id, "parent-0", new Date().toISOString(), data as StepSnapshotData));
				return id;
			});

			expect(mgr.getLiveChanges(testDir)).toEqual([]);

			writeFileSync(join(testDir, "a.txt"), "v3\n");
			const changes = mgr.getLiveChanges(testDir);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({ path: "a.txt", status: "modified" });
		});

		it("ignores files larger than 1MB", () => {
			writeFileSync(join(testDir, "small.txt"), "small\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			const big = "x".repeat(1024 * 1024 + 100);
			writeFileSync(join(testDir, "big.txt"), big);
			writeFileSync(join(testDir, "small.txt"), "changed\n");

			const changes = mgr.getLiveChanges(testDir);
			const paths = changes.map((c) => c.path);
			expect(paths).not.toContain("big.txt");
			expect(paths).toContain("small.txt");
		});
	});

	describe("onTurnEnd", () => {
		it("writes step-snapshot entry when there are changes", () => {
			writeFileSync(join(testDir, "a.txt"), "initial\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			writeFileSync(join(testDir, "a.txt"), "changed\n");

			const entries: SessionEntry[] = [];
			mgr.onTurnEnd(testDir, 0, (_type, data) => {
				expect(_type).toBe("step-snapshot");
				const id = `snap-0`;
				entries.push(customSnapshotEntry(id, "parent-0", new Date().toISOString(), data as StepSnapshotData));
				return id;
			});

			expect(entries).toHaveLength(1);
			const snap = (entries[0] as { data: unknown }).data as StepSnapshotData;
			expect(snap.diff!.modified).toContain("a.txt");
			expect(snap.turnIndex).toBe(0);
		});

		it("skips entry when no changes", () => {
			writeFileSync(join(testDir, "a.txt"), "initial\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			const entries: SessionEntry[] = [];
			mgr.onTurnEnd(testDir, 0, () => {
				throw new Error("should not be called");
			});

			expect(entries).toHaveLength(0);
		});

		it("updates lastCommittedTreeHash after writing", () => {
			writeFileSync(join(testDir, "a.txt"), "initial\n");
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir);

			writeFileSync(join(testDir, "a.txt"), "v2\n");
			mgr.onTurnEnd(testDir, 0, (_type, _data) => "snap-0");

			expect(mgr.getLiveChanges(testDir)).toEqual([]);

			writeFileSync(join(testDir, "a.txt"), "v3\n");
			const changes = mgr.getLiveChanges(testDir);
			expect(changes).toHaveLength(1);
			expect(changes[0]).toMatchObject({ path: "a.txt", status: "modified" });
		});
	});

	describe("rebuildIndex", () => {
		it("rebuilds from step-snapshot entries", () => {
			const git = new InternalGit(storeDir);
			const firstTree = git.writeTree(new Map([["file.txt", "content-1\n"]]));
			const secondTree = git.writeTree(new Map([["file.txt", "content-2\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "assistant-1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: firstTree.treeHash,
					diff: { added: ["file.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "assistant-2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: firstTree.treeHash,
					snapshotTreeHash: secondTree.treeHash,
					diff: { added: [], modified: ["file.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const modified = mgr.getModifiedFiles();
			expect(modified).toHaveLength(1);
			expect(modified[0]).toMatchObject({ path: "file.txt", status: "added" });
		});

		it("clears existing index first", () => {
			const git = new InternalGit(storeDir);
			const treeA = git.writeTree(new Map([["a.txt", "a\n"]]));
			const treeB = git.writeTree(new Map([["b.txt", "b\n"]]));

			const firstEntries: SessionEntry[] = [
				customSnapshotEntry("snap-a", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: treeA.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(firstEntries);
			expect(mgr.getModifiedFiles()).toHaveLength(1);

			const secondEntries: SessionEntry[] = [
				customSnapshotEntry("snap-b", "p2", "2026-01-02T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: treeB.treeHash,
					diff: { added: ["b.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];
			mgr.rebuildIndex(secondEntries);

			const modified = mgr.getModifiedFiles();
			expect(modified).toHaveLength(1);
			expect(modified[0]!.path).toBe("b.txt");
		});
	});

	describe("getModifiedFiles", () => {
		it("returns files from all snapshots when no range specified", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "1\n"]]));
			const tree2 = git.writeTree(
				new Map([
					["a.txt", "1\n"],
					["b.txt", "2\n"],
				]),
			);

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: ["b.txt"], modified: [], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const modified = mgr.getModifiedFiles();
			expect(modified).toHaveLength(2);
			const paths = modified.map((m) => m.path).sort();
			expect(paths).toEqual(["a.txt", "b.txt"]);
		});

		it("returns empty when no snapshots", () => {
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			expect(mgr.getModifiedFiles()).toEqual([]);
		});
	});

	describe("getFileDiff", () => {
		it("returns diff for a modified file", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "line1\n"]]));
			const tree2 = git.writeTree(new Map([["a.txt", "line1\nline2\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["a.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const diff = mgr.getFileDiff({ filePath: "a.txt", fromEntryId: "snap-1", toEntryId: "snap-2" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("line1\n");
			expect(diff!.newContent).toBe("line1\nline2\n");
			expect(diff!.unifiedDiff).toContain("+line2");
			expect(diff!.unifiedDiff).toContain("--- a.txt");
			expect(diff!.unifiedDiff).toContain("+++ a.txt");
		});

		it("returns diff for an added file", () => {
			const git = new InternalGit(storeDir);
			const tree = git.writeTree(new Map([["new.txt", "new content\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree.treeHash,
					diff: { added: ["new.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const diff = mgr.getFileDiff({ filePath: "new.txt", toEntryId: "snap-1" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBeNull();
			expect(diff!.newContent).toBe("new content\n");
		});

		it("returns diff for a deleted file", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["rm.txt", "to be deleted\n"]]));
			const tree2 = git.writeTree(new Map());

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["rm.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: [], deleted: ["rm.txt"] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const diff = mgr.getFileDiff({ filePath: "rm.txt", fromEntryId: "snap-1", toEntryId: "snap-2" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("to be deleted\n");
			expect(diff!.newContent).toBeNull();
		});

		it("returns null for nonexistent file", () => {
			const git = new InternalGit(storeDir);
			const tree = git.writeTree(new Map([["exists.txt", "yes\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree.treeHash,
					diff: { added: ["exists.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const diff = mgr.getFileDiff({ filePath: "nope.txt" });
			expect(diff).toBeNull();
		});

		it("without fromEntryId oldContent is null (deterministic, no fallback)", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["f.txt", "v1\n"]]));
			const tree2 = git.writeTree(new Map([["f.txt", "v2\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["f.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["f.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// No fromEntryId → uses sessionStartTreeHash (= empty/null since session started empty)
			// No fallback — oldContent is deterministically null
			const diff = mgr.getFileDiff({ filePath: "f.txt" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBeNull();
			expect(diff!.newContent).toBe("v2\n");

			// With explicit fromEntryId, oldContent IS found
			const diffWithId = mgr.getFileDiff({ filePath: "f.txt", fromEntryId: "snap-1", toEntryId: "snap-2" });
			expect(diffWithId).not.toBeNull();
			expect(diffWithId!.oldContent).toBe("v1\n");
		});
	});

	describe("getBatchDiffs", () => {
		it("returns diffs for all modified files", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "v1\n"]]));
			const tree2 = git.writeTree(
				new Map([
					["a.txt", "v2\n"],
					["b.txt", "new\n"],
				]),
			);

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: ["b.txt"], modified: ["a.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const batch = mgr.getBatchDiffs({ cwd: testDir });
			expect(batch.files).toHaveLength(2);
			const byPath = new Map(batch.files.map((f) => [f.path, f]));
			expect(byPath.get("a.txt")?.status).toBe("added");
			expect(byPath.get("a.txt")?.diff).not.toBeNull();
			expect(byPath.get("b.txt")?.status).toBe("added");
			expect(byPath.get("b.txt")?.diff).not.toBeNull();
		});

		it("includes summary counts", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(
				new Map([
					["a.txt", "v1\n"],
					["b.txt", "v1\n"],
				]),
			);
			const tree2 = git.writeTree(
				new Map([
					["a.txt", "v2\n"],
					["c.txt", "new\n"],
				]),
			);

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt", "b.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: ["c.txt"], modified: ["a.txt"], deleted: ["b.txt"] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const batch = mgr.getBatchDiffs({ cwd: testDir });
			expect(batch.summary.totalFiles).toBe(3);
			expect(batch.summary.added + batch.summary.modified + batch.summary.deleted).toBe(3);
		});

		it("newContent reads from disk, not from snapshot", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "snapshot-v1\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// Write different content to disk than what's in the snapshot
			writeFileSync(join(testDir, "a.txt"), "disk-content\n");

			const batch = mgr.getBatchDiffs({ fromEntryId: "snap-1", cwd: testDir });
			expect(batch.files).toHaveLength(1);
			expect(batch.files[0]!.diff).not.toBeNull();
			// oldContent comes from snapshot
			expect(batch.files[0]!.diff!.oldContent).toBe("snapshot-v1\n");
			// newContent comes from disk (not snapshot)
			expect(batch.files[0]!.diff!.newContent).toBe("disk-content\n");
		});

		it("newContent is null when file does not exist on disk", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["ghost.txt", "only-in-snapshot\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["ghost.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// File exists in snapshot but NOT on disk
			const batch = mgr.getBatchDiffs({ fromEntryId: "snap-1", cwd: testDir });
			expect(batch.files).toHaveLength(1);
			const fileDiff = batch.files[0]!.diff;
			expect(fileDiff).not.toBeNull();
			expect(fileDiff!.oldContent).toBe("only-in-snapshot\n");
			expect(fileDiff!.newContent).toBeNull();
		});
	});

	describe("getFileHistory", () => {
		it("returns history entries for a file", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "v1\n"]]));
			const tree2 = git.writeTree(new Map([["a.txt", "v2\n"]]));
			const tree3 = git.writeTree(new Map([["a.txt", "v3\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["a.txt"], deleted: [] },
					turnIndex: 1,
				}),
				customSnapshotEntry("snap-3", "p3", "2026-01-01T00:02:00.000Z", {
					baselineTreeHash: tree2.treeHash,
					snapshotTreeHash: tree3.treeHash,
					diff: { added: [], modified: ["a.txt"], deleted: [] },
					turnIndex: 2,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const history = mgr.getFileHistory({ filePath: "a.txt" });
			expect(history).toHaveLength(3);
			expect(history[0]!.status).toBe("added");
			expect(history[0]!.entryId).toBe("snap-1");
			expect(history[1]!.status).toBe("modified");
			expect(history[2]!.status).toBe("modified");
		});

		it("returns empty for unchanged file", () => {
			const git = new InternalGit(storeDir);
			const tree = git.writeTree(new Map([["a.txt", "content\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const history = mgr.getFileHistory({ filePath: "other.txt" });
			expect(history).toEqual([]);
		});
	});

	describe("restoreFiles", () => {
		it("restores files to a previous snapshot state", async () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "v1\n"]]));
			const tree2 = git.writeTree(new Map([["a.txt", "v2\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["a.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);
			writeFileSync(join(testDir, "a.txt"), "v2\n");

			const result = await mgr.restoreFiles(testDir, {
				targetEntryId: "snap-1",
				entries,
				preview: false,
			});

			expect(result.restored).toContain("a.txt");
			const content = require("node:fs").readFileSync(join(testDir, "a.txt"), "utf-8");
			expect(content).toBe("v1\n");
		});
	});

	describe("getActiveTreeHashes", () => {
		it("returns all active tree hashes", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "1\n"]]));
			const tree2 = git.writeTree(new Map([["a.txt", "2\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["a.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const hashes = mgr.getActiveTreeHashes();
			expect(hashes.has(tree1.treeHash)).toBe(true);
			expect(hashes.has(tree2.treeHash)).toBe(true);
		});
	});

	describe("getRollbackPreviewFiles", () => {
		it("returns files that would change on rollback", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "v1\n"]]));
			const tree2 = git.writeTree(
				new Map([
					["a.txt", "v2\n"],
					["b.txt", "new\n"],
				]),
			);

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: ["b.txt"], modified: ["a.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			const files = mgr.getRollbackPreviewFiles({ targetEntryId: "snap-1", entries });
			expect(files).toHaveLength(2);
			const byPath = new Map(files.map((f) => [f.path, f]));
			expect(byPath.get("a.txt")?.status).toBe("modified");
			expect(byPath.get("b.txt")?.status).toBe("added");
		});
	});

	describe("resolveSnapshotEntryIdForTarget", () => {
		it("returns the entry id if it is a snapshot", () => {
			const git = new InternalGit(storeDir);
			const tree = git.writeTree(new Map([["a.txt", "content\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			expect(mgr.resolveSnapshotEntryIdForTarget("snap-1", entries)).toBe("snap-1");
		});

		it("returns null for unknown target", () => {
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			expect(mgr.resolveSnapshotEntryIdForTarget("nonexistent", [])).toBeNull();
		});
	});

	// === MISSING METHODS (should show as PENDING in test report) ===

	describe("getSnapshotAtEntry [IMPLEMENTED]", () => {
		it("should return snapshot data for a given entry ID", () => {
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			expect(typeof (mgr as unknown as Record<string, unknown>).getSnapshotAtEntry).toBe("function");
		});

		it("returns null for unknown entry ID", () => {
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			const result = mgr.getSnapshotAtEntry("nonexistent");
			expect(result).toBeNull();
		});
	});

	describe("restoreFiles with snapshotHash [IMPLEMENTED]", () => {
		it("should accept snapshotHash option for direct hash-based restore", async () => {
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			const result = await mgr.restoreFiles(testDir, {
				entries: [],
				snapshotHash: "abc",
			});
			expect(result).toBeDefined();
		});
	});

	describe("getBatchDiffs oldContent", () => {
		it("oldContent is null when no fromEntryId and session starts empty", () => {
			// When sessionStartTreeHash is null (empty working dir) and no
			// fromEntryId is provided, oldContent is null — no guessing.
			const git = new InternalGit(storeDir);
			// Simulate: first snapshot creates the file, second modifies it
			const tree1 = git.writeTree(new Map([["Cargo.toml", 'version = "0.1.0"\n']]));
			const tree2 = git.writeTree(new Map([["Cargo.toml", 'version = "0.2.0"\nedition = "2021"\n']]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["Cargo.toml"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["Cargo.toml"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// Write the file to disk so getBatchFileContents can read newContent
			writeFileSync(join(testDir, "Cargo.toml"), 'version = "0.2.0"\nedition = "2021"\n');

			const batch = mgr.getBatchDiffs({ cwd: testDir });
			expect(batch.files).toHaveLength(1);
			const fileDiff = batch.files[0]!.diff;
			expect(fileDiff).not.toBeNull();
			// No fromEntryId + empty session start → oldContent is null
			expect(fileDiff!.oldContent).toBeNull();
			expect(fileDiff!.newContent).toBe('version = "0.2.0"\nedition = "2021"\n');
		});

		it("should return valid diff when fromEntryId is provided to getBatchDiffs", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "original\n"]]));
			const tree2 = git.writeTree(new Map([["a.txt", "modified\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["a.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// Write the file to disk so getBatchFileContents can read newContent
			writeFileSync(join(testDir, "a.txt"), "modified\n");

			// When using fromEntryId, oldContent should come from that snapshot's tree
			const batch = mgr.getBatchDiffs({ fromEntryId: "snap-1", toEntryId: "snap-2", cwd: testDir });
			expect(batch.files).toHaveLength(1);
			const fileDiff = batch.files[0]!.diff;
			expect(fileDiff).not.toBeNull();
			expect(fileDiff!.oldContent).toBe("original\n");
			expect(fileDiff!.newContent).toBe("modified\n");
			expect(fileDiff!.unifiedDiff).toContain("-original");
			expect(fileDiff!.unifiedDiff).toContain("+modified");
		});

		it("unifiedDiff should contain removed lines when oldContent is non-null", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["config.yaml", "key: old\nother: value\n"]]));
			const tree2 = git.writeTree(new Map([["config.yaml", "key: new\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["config.yaml"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["config.yaml"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// getFileDiff with explicit fromEntryId should give proper diff
			const diff = mgr.getFileDiff({ filePath: "config.yaml", fromEntryId: "snap-1", toEntryId: "snap-2" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("key: old\nother: value\n");
			expect(diff!.newContent).toBe("key: new\n");
			expect(diff!.unifiedDiff).toContain("-key: old");
			expect(diff!.unifiedDiff).toContain("-other: value");
			expect(diff!.unifiedDiff).toContain("+key: new");
		});
	});

	describe("getFileDiff with explicit fromEntryId", () => {
		it("returns correct oldContent when fromEntryId is provided", () => {
			// Session starts empty, file created in turn 0, modified in turn 1.
			// with explicit fromEntryId, oldContent comes from that snapshot's tree.
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["file.txt", "V1 content\n"]]));
			const tree2 = git.writeTree(new Map([["file.txt", "V2 content\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["file.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: [], modified: ["file.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// With explicit fromEntryId, oldContent comes from snap-1's tree
			const diff = mgr.getFileDiff({ filePath: "file.txt", fromEntryId: "snap-1", toEntryId: "snap-2" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("V1 content\n");
			expect(diff!.newContent).toBe("V2 content\n");
		});
	});

	describe("restoreFiles with files subset", () => {
		it("restores only specified files when options.files is provided", async () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(
				new Map([
					["a.txt", "v1\n"],
					["b.txt", "v1\n"],
				]),
			);
			const tree2 = git.writeTree(
				new Map([
					["a.txt", "v2\n"],
					["b.txt", "v2\n"],
					["c.txt", "new\n"],
				]),
			);

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt", "b.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
				customSnapshotEntry("snap-2", "p2", "2026-01-01T00:01:00.000Z", {
					baselineTreeHash: tree1.treeHash,
					snapshotTreeHash: tree2.treeHash,
					diff: { added: ["c.txt"], modified: ["a.txt", "b.txt"], deleted: [] },
					turnIndex: 1,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// Both files exist on disk
			writeFileSync(join(testDir, "a.txt"), "v2\n");
			writeFileSync(join(testDir, "b.txt"), "v2\n");
			writeFileSync(join(testDir, "c.txt"), "new\n");

			// Restore only a.txt to snap-1 state
			const result = await mgr.restoreFiles(testDir, {
				targetEntryId: "snap-1",
				files: ["a.txt"],
				entries,
				preview: false,
			});

			expect(result.restored).toEqual(["a.txt"]);
			expect(result.deleted).toEqual([]);
			expect(result.restored).not.toContain("b.txt");

			const content1 = require("node:fs").readFileSync(join(testDir, "a.txt"), "utf-8");
			expect(content1).toBe("v1\n");
			// b.txt should still be v2 (not restored)
			const content2 = require("node:fs").readFileSync(join(testDir, "b.txt"), "utf-8");
			expect(content2).toBe("v2\n");
		});
	});

	describe("getBatchFileContents large file filtering", () => {
		it("returns null newContent for files over FILE_SIZE_LIMIT (1MB)", () => {
			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["big.txt", "small-in-snapshot\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-1", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["big.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(entries);

			// Write a file larger than FILE_SIZE_LIMIT (1024 * 1024 = 1MB)
			const largeContent = "x".repeat(1024 * 1024 + 100);
			writeFileSync(join(testDir, "big.txt"), largeContent);

			const result = mgr.getBatchFileContents([{ filePath: "big.txt", fromEntryId: "snap-1" }], testDir);
			const content = result.get("big.txt");
			expect(content).toBeDefined();
			// oldContent from snapshot (small file in tree)
			expect(content!.oldContent).toBe("small-in-snapshot\n");
			// newContent from disk — should be null because file exceeds limit
			expect(content!.newContent).toBeNull();
		});
	});
});
