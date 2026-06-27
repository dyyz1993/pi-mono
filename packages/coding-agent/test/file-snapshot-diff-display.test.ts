import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager, type StepSnapshotData } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";
import type { CustomEntry, SessionEntry } from "../src/core/session-manager.ts";

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

describe("Snapshot diff display bug", () => {
	let testDir: string;
	let storeDir: string;

	beforeEach(() => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		testDir = join(tmpdir(), `pi-diff-bug-${suffix}`);
		storeDir = join(tmpdir(), `pi-diff-bug-store-${suffix}`);
		mkdirSync(testDir, { recursive: true });
		mkdirSync(storeDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		rmSync(storeDir, { recursive: true, force: true });
	});

	describe("onTurnEnd diff correctness", () => {
		it("diff is null when no files exist at session start and no changes made", () => {
			// Empty dir, initialize sets sessionStartTreeHash = null
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir); // empty dir → sessionStartTreeHash = null

			// No files written, onTurnEnd should produce no snapshot
			const entries: SessionEntry[] = [];
			mgr.onTurnEnd(testDir, 0, () => {
				throw new Error("should not append entry when no changes");
			});

			expect(entries).toHaveLength(0);
		});

		it("diff shows added files when agent creates files from empty dir", () => {
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir); // empty → sessionStartTreeHash = null

			// Agent creates a file
			writeFileSync(join(testDir, "new.txt"), "content\n");

			const entries: SessionEntry[] = [];
			mgr.onTurnEnd(testDir, 0, (_type, data) => {
				const id = "snap-0";
				entries.push(customSnapshotEntry(id, "p0", new Date().toISOString(), data as StepSnapshotData));
				return id;
			});

			expect(entries).toHaveLength(1);
			const snap = (entries[0]! as CustomEntry).data as StepSnapshotData;
			expect(snap.diff).not.toBeNull();
			expect(snap.diff!.added).toContain("new.txt");
			expect(snap.diff!.modified).toEqual([]);
			expect(snap.diff!.deleted).toEqual([]);
		});

		it("diff shows modified files when agent edits pre-existing files", () => {
			// Pre-existing file
			writeFileSync(join(testDir, "existing.txt"), "original\n");

			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir); // captures existing.txt

			// Agent modifies the file
			writeFileSync(join(testDir, "existing.txt"), "modified\n");

			const entries: SessionEntry[] = [];
			mgr.onTurnEnd(testDir, 0, (_type, data) => {
				const id = "snap-0";
				entries.push(customSnapshotEntry(id, "p0", new Date().toISOString(), data as StepSnapshotData));
				return id;
			});

			expect(entries).toHaveLength(1);
			const snap = (entries[0]! as CustomEntry).data as StepSnapshotData;
			expect(snap.diff).not.toBeNull();
			expect(snap.diff!.modified).toContain("existing.txt");
			expect(snap.diff!.added).toEqual([]);
			expect(snap.diff!.deleted).toEqual([]);
		});

		it("BUG REPRO: first snapshot after session restore has diff=null", () => {
			// Simulate what happens during session restore:
			// 1. Files exist on disk (from previous turns)
			// 2. rebuildIndex is called with existing snapshot entries
			// 3. initialize is NOT called (because snapshotIndex.size > 0)
			// 4. A new turn happens

			writeFileSync(join(testDir, "a.txt"), "v1\n");

			const git = new InternalGit(storeDir);
			const tree1 = git.writeTree(new Map([["a.txt", "v1\n"]]));

			// Simulate existing snapshot from a previous session
			const existingEntries: SessionEntry[] = [
				customSnapshotEntry("snap-old", "p-old", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null,
					snapshotTreeHash: tree1.treeHash,
					diff: { added: ["a.txt"], modified: [], deleted: [] },
					turnIndex: 0,
				}),
			];

			const mgr = new FileSnapshotManager(git);
			mgr.rebuildIndex(existingEntries);
			// initialize() is NOT called — it's skipped because snapshotIndex.size > 0
			// mgr.initialize(testDir); // ← commented out, simulating restore

			// Agent modifies the file
			writeFileSync(join(testDir, "a.txt"), "v2\n");

			const entries: SessionEntry[] = [...existingEntries];
			mgr.onTurnEnd(testDir, 1, (_type, data) => {
				const id = "snap-1";
				entries.push(customSnapshotEntry(id, "p1", new Date().toISOString(), data as StepSnapshotData));
				return id;
			});

			// The new snapshot should have diff with modified: ["a.txt"]
			expect(entries).toHaveLength(2);
			const newSnap = (entries[1]! as CustomEntry).data as StepSnapshotData;
			expect(newSnap.diff, "diff should not be null").not.toBeNull();
			expect(newSnap.diff!.modified, "should show a.txt as modified").toContain("a.txt");
		});

		it("BUG REPRO 2: diff missing when sessionStartTreeHash is null but files changed", () => {
			// Edge case: session starts empty, initialize sets sessionStartTreeHash = null
			// Agent adds a file, but then deletes it and adds a different one
			// The diff between null and current should still work
			const git = new InternalGit(storeDir);
			const mgr = new FileSnapshotManager(git);
			mgr.initialize(testDir); // empty dir → sessionStartTreeHash = null

			// Turn 0: create fileA
			writeFileSync(join(testDir, "fileA.txt"), "A\n");
			const entries: SessionEntry[] = [];
			mgr.onTurnEnd(testDir, 0, (_type, data) => {
				const id = "snap-0";
				entries.push(customSnapshotEntry(id, "p0", new Date().toISOString(), data as StepSnapshotData));
				return id;
			});

			// Turn 1: delete fileA, create fileB
			rmSync(join(testDir, "fileA.txt"));
			writeFileSync(join(testDir, "fileB.txt"), "B\n");
			mgr.onTurnEnd(testDir, 1, (_type, data) => {
				const id = "snap-1";
				entries.push(customSnapshotEntry(id, "p1", new Date().toISOString(), data as StepSnapshotData));
				return id;
			});

			expect(entries).toHaveLength(2);
			const snap0 = (entries[0]! as CustomEntry).data as StepSnapshotData;
			const snap1 = (entries[1]! as CustomEntry).data as StepSnapshotData;

			// Snap 0: fileA added
			expect(snap0.diff!.added).toContain("fileA.txt");

			// Snap 1: fileA deleted, fileB added
			expect(snap1.diff!.deleted).toContain("fileA.txt");
			expect(snap1.diff!.added).toContain("fileB.txt");
		});

		it("BUG REPRO 3: SnapshotBadge totalCount check - diff null returns null", () => {
			// This tests the frontend logic that hides snapshots with null diff.
			// Simulate what happens: a snapshot entry with diff=null
			const git = new InternalGit(storeDir);
			const tree = git.writeTree(new Map([["a.txt", "content\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-null", "p1", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: tree.treeHash,
					snapshotTreeHash: tree.treeHash, // same tree = no changes
					diff: null, // ← THIS IS THE BUG: diff stored as null
					turnIndex: 0,
				}),
			];

			// Frontend SnapshotBadge logic (simulated):
			const snap = (entries[0]! as CustomEntry).data as StepSnapshotData;
			const diff = snap.diff;
			const addedCount = diff?.added?.length ?? 0;
			const modifiedCount = diff?.modified?.length ?? 0;
			const deletedCount = diff?.deleted?.length ?? 0;
			const totalCount = addedCount + modifiedCount + deletedCount;

			// When diff is null, totalCount = 0, badge returns null (hidden)
			expect(totalCount).toBe(0);
			// This is the expected behavior for diff=null, BUT the real question is:
			// WHY is diff null when there ARE file changes?
		});

		it("BUG REPRO 4: diff is null after rebuildIndex when baselineTreeHash is null", () => {
			// This simulates session restore where:
			// 1. Original session had files at start (non-empty)
			// 2. First snapshot recorded diff=null because baseline=itself
			// 3. After restore, the snapshot shows diff=null → badge hidden
			//    BUT there WERE changes vs session start

			const git = new InternalGit(storeDir);
			// Simulate: session started with files, first turn no changes
			const tree1 = git.writeTree(new Map([["a.txt", "v1\n"]]));

			const entries: SessionEntry[] = [
				customSnapshotEntry("snap-0", "p0", "2026-01-01T00:00:00.000Z", {
					baselineTreeHash: null, // ← null baseline
					snapshotTreeHash: tree1.treeHash,
					diff: null, // ← null diff because compareTo was null (no changes detected)
					turnIndex: 0,
				}),
			];

			// Frontend filter: .filter(s => s.data.diff !== null)
			// This snapshot is FILTERED OUT from snapshot.list
			const visibleSnapshots = entries.filter((e) => ((e as CustomEntry).data as StepSnapshotData).diff !== null);
			expect(visibleSnapshots).toHaveLength(0);

			// BUT the snapshot panel list filter also removes it!
			// So the user doesn't even see it in the panel.
			// The real issue: this snapshot SHOULD have diff={added:["a.txt"]}
			// because the file was created from empty baseline.
		});
	});
});

describe("Snapshot diff null bug - precise reproduction", () => {
	let testDir: string;
	let storeDir: string;

	beforeEach(() => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		testDir = join(tmpdir(), `pi-diff-null-${suffix}`);
		storeDir = join(tmpdir(), `pi-diff-null-store-${suffix}`);
		mkdirSync(testDir, { recursive: true });
		mkdirSync(storeDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("BUG: turn 0 diff is null when initialize already captured working dir", () => {
		// Pre-existing file in working dir
		writeFileSync(join(testDir, "existing.txt"), "v1\n");

		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);

		// initialize() captures the working dir state
		mgr.initialize(testDir);
		// Now sessionStartTreeHash = hash of {existing.txt: "v1\n"}
		// lastCommittedTreeHash = null

		// Agent does NOT change anything in this turn
		// (e.g. agent only read files, didn't write)
		// onTurnEnd is called → compareTo = sessionStartTreeHash (not null)
		// oldEntries = the same tree → diff = no changes → diff stored as null
		const entries: SessionEntry[] = [];
		mgr.onTurnEnd(testDir, 0, (_type, data) => {
			const id = "snap-0";
			entries.push(customSnapshotEntry(id, "p0", new Date().toISOString(), data as StepSnapshotData));
			return id;
		});

		// BUG: entry is not created at all (onTurnEnd returns early when no changes)
		// This is actually correct behavior — no changes = no snapshot
		expect(entries).toHaveLength(0);
	});

	it("CORRECT: turn 0 shows diff when agent creates new file from empty dir", () => {
		// Empty working dir
		const git = new InternalGit(storeDir);
		const mgr = new FileSnapshotManager(git);
		mgr.initialize(testDir); // sessionStartTreeHash = null (empty dir)

		// Agent creates a file
		writeFileSync(join(testDir, "new.txt"), "hello\n");

		const entries: SessionEntry[] = [];
		mgr.onTurnEnd(testDir, 0, (_type, data) => {
			const id = "snap-0";
			entries.push(customSnapshotEntry(id, "p0", new Date().toISOString(), data as StepSnapshotData));
			return id;
		});

		expect(entries).toHaveLength(1);
		const snap = (entries[0]! as CustomEntry).data as StepSnapshotData;
		expect(snap.diff).not.toBeNull();
		expect(snap.diff!.added).toContain("new.txt");
	});

	it("BUG REPRO: rebuildIndex skips initialize, sessionStartTreeHash stays null", () => {
		// After session restore:
		// 1. rebuildIndex is called with existing entries
		// 2. initialize is skipped (snapshotIndex.size > 0)
		// 3. sessionStartTreeHash is NOT set (stays null)
		// 4. In rebuildIndex, sessionStartTreeHash comes from first snapshot's baseline

		writeFileSync(join(testDir, "a.txt"), "v1\n");

		const git = new InternalGit(storeDir);
		const tree1 = git.writeTree(new Map([["a.txt", "v1\n"]]));

		// First snapshot had baseline=null (empty dir start)
		const existingEntries: SessionEntry[] = [
			customSnapshotEntry("snap-0", "p0", "2026-01-01T00:00:00.000Z", {
				baselineTreeHash: null,
				snapshotTreeHash: tree1.treeHash,
				diff: { added: ["a.txt"], modified: [], deleted: [] },
				turnIndex: 0,
			}),
		];

		const mgr = new FileSnapshotManager(git);
		mgr.rebuildIndex(existingEntries);

		// After rebuildIndex, what is sessionStartTreeHash?
		// rebuildIndex sets it from first snapshot's baselineTreeHash
		// Since first snapshot baseline=null, sessionStartTreeHash stays null
		// lastCommittedTreeHash = tree1.treeHash (last snapshot)

		// Agent modifies a.txt
		writeFileSync(join(testDir, "a.txt"), "v2\n");

		const entries: SessionEntry[] = [...existingEntries];
		mgr.onTurnEnd(testDir, 1, (_type, data) => {
			const id = "snap-1";
			entries.push(customSnapshotEntry(id, "p1", new Date().toISOString(), data as StepSnapshotData));
			return id;
		});

		expect(entries).toHaveLength(2);
		const newSnap = (entries[1]! as CustomEntry).data as StepSnapshotData;
		// This should work: compareTo = lastCommittedTreeHash = tree1
		// diff should show a.txt as modified
		expect(newSnap.diff).not.toBeNull();
		expect(newSnap.diff!.modified).toContain("a.txt");
	});

	it("EDGE CASE: snapshot with diff=null is filtered from list", () => {
		// The frontend handler filters: .filter(s => s.data.diff !== null)
		// This means any snapshot with diff=null is INVISIBLE in the panel.
		//
		// When does diff=null happen?
		// - onTurnEnd detects no changes → no entry written at all
		// - BUT rebuildIndex reads old entries that may have diff=null
		//   from a DIFFERENT code path (e.g. old version, migration)
		//
		// This test verifies the filter behavior:
		const git = new InternalGit(storeDir);
		const tree = git.writeTree(new Map([["a.txt", "v1\n"]]));

		const entries: SessionEntry[] = [
			// This entry has diff=null (could be from old session format)
			customSnapshotEntry("snap-null", "p0", "2026-01-01T00:00:00.000Z", {
				baselineTreeHash: tree.treeHash,
				snapshotTreeHash: tree.treeHash,
				diff: null,
				turnIndex: 0,
			}),
			// This entry has proper diff
			customSnapshotEntry("snap-real", "p1", "2026-01-01T00:01:00.000Z", {
				baselineTreeHash: tree.treeHash,
				snapshotTreeHash: tree.treeHash,
				diff: { added: ["b.txt"], modified: [], deleted: [] },
				turnIndex: 1,
			}),
		];

		// Frontend filter (simulated)
		const visible = entries.filter((e) => ((e as CustomEntry).data as StepSnapshotData).diff !== null);

		expect(visible).toHaveLength(1);
		expect(((visible[0]! as CustomEntry).data as StepSnapshotData).diff!.added).toContain("b.txt");
	});
});
