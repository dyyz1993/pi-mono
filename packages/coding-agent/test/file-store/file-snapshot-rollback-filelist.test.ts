import { describe, it, expect, vi } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.js";
import type { StepSnapshotData } from "../../src/core/file-store/file-snapshot-manager.js";

function createManagerWithSnapshots(
	snapshots: Array<{ turnIndex: number; added?: string[]; modified?: string[]; deleted?: string[] }>,
): FileSnapshotManager {
	const mockGit = {
		readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
		writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
		computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
		parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
	} as any;

	const manager = new FileSnapshotManager(mockGit);

	for (let i = 0; i < snapshots.length; i++) {
		const s = snapshots[i]!;
		const entryId = `snap-${i}`;
		const data: StepSnapshotData = {
			baselineTreeHash: i === 0 ? "baseline-0" : `snap-hash-${i - 1}`,
			snapshotTreeHash: `snap-hash-${i}`,
			diff: {
				added: s.added ?? [],
				modified: s.modified ?? [],
				deleted: s.deleted ?? [],
			},
			turnIndex: s.turnIndex,
		};

		(manager as any).snapshotIndex.set(entryId, { ...data, entryId });
		(manager as any).turnIndexMap.set(s.turnIndex, entryId);
	}

	return manager;
}

describe("getModifiedFiles rollback semantics", () => {
	it("Case 1: Turn A creates A, Turn B creates B — rollback Turn B shows only B", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A"] },
			{ turnIndex: 1, added: ["B"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 1 });

		expect(files.map((f) => f.path)).toEqual(["B"]);
	});

	it("Case 1: Turn A creates A, Turn B creates B — rollback Turn A shows A + B", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A"] },
			{ turnIndex: 1, added: ["B"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 0 });

		expect(files.map((f) => f.path).sort()).toEqual(["A", "B"]);
	});

	it("Case 2: Turn A creates C, Turn B modifies C — rollback Turn B shows C as modified", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["C"] },
			{ turnIndex: 1, modified: ["C"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 1 });

		expect(files).toHaveLength(1);
		expect(files[0]!.path).toBe("C");
		expect(files[0]!.status).toBe("modified");
	});

	it("Case 2: Turn A creates C, Turn B modifies C — rollback Turn A shows C as added", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["C"] },
			{ turnIndex: 1, modified: ["C"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 0 });

		expect(files).toHaveLength(1);
		expect(files[0]!.path).toBe("C");
		expect(files[0]!.status).toBe("added");
	});

	it("Case 3: 3 turns — rollback Turn B shows B + C", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A"] },
			{ turnIndex: 1, added: ["B"] },
			{ turnIndex: 2, added: ["C"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 1 });
		expect(files.map((f) => f.path).sort()).toEqual(["B", "C"]);
	});

	it("Case 3: 3 turns — rollback Turn C shows only C", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A"] },
			{ turnIndex: 1, added: ["B"] },
			{ turnIndex: 2, added: ["C"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 2 });
		expect(files.map((f) => f.path)).toEqual(["C"]);
	});

	it("Case 3: 3 turns — rollback Turn A shows A + B + C", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A"] },
			{ turnIndex: 1, added: ["B"] },
			{ turnIndex: 2, added: ["C"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 0 });
		expect(files.map((f) => f.path).sort()).toEqual(["A", "B", "C"]);
	});

	it("returns all files when no filter provided", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A"] },
			{ turnIndex: 1, added: ["B"] },
			{ turnIndex: 2, added: ["C"] },
		]);

		const files = manager.getModifiedFiles();
		expect(files.map((f) => f.path).sort()).toEqual(["A", "B", "C"]);
	});
});

describe("getModifiedFiles rollback — delete and multi-turn cases", () => {
	/**
	 * Case 4: File deletion
	 *   Turn A creates X, Turn B deletes X
	 *   Rollback Turn B → shows X as added (re-appears)
	 *   Rollback Turn A → shows X as added (created in Turn A, stays added through both turns)
	 */
	it("Case 4: Turn A creates X, Turn B deletes X — rollback Turn B shows X", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["X"] },
			{ turnIndex: 1, deleted: ["X"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 1 });
		expect(files).toHaveLength(1);
		expect(files[0]!.path).toBe("X");
		expect(files[0]!.status).toBe("deleted");
	});

	it("Case 4: Turn A creates X, Turn B deletes X — rollback Turn A shows X as added", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["X"] },
			{ turnIndex: 1, deleted: ["X"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 0 });
		expect(files).toHaveLength(1);
		expect(files[0]!.path).toBe("X");
		// Turn A added X first, Turn B deleted — first-seen wins as "added"
		expect(files[0]!.status).toBe("added");
	});

	/**
	 * Case 5: Mixed operations across 4 turns
	 *   Turn 0: create A, create B
	 *   Turn 1: modify A, create C
	 *   Turn 2: delete B, modify C
	 *   Turn 3: create D, modify A
	 *
	 *   Rollback Turn 3 → only D (created) and A (modified)
	 *   Rollback Turn 2 → B (deleted), C (modified), D (created), A (modified)
	 *   Rollback Turn 1 → A (modified), C (created), B (deleted), D (created)
	 */
	it("Case 5: 4 turns mixed ops — rollback Turn 3 shows A(modified) + D(added)", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A", "B"] },
			{ turnIndex: 1, modified: ["A"], added: ["C"] },
			{ turnIndex: 2, deleted: ["B"], modified: ["C"] },
			{ turnIndex: 3, added: ["D"], modified: ["A"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 3 });
		const paths = files.map((f) => f.path).sort();
		expect(paths).toEqual(["A", "D"]);

		const fileA = files.find((f) => f.path === "A");
		expect(fileA?.status).toBe("modified");
		const fileD = files.find((f) => f.path === "D");
		expect(fileD?.status).toBe("added");
	});

	it("Case 5: 4 turns mixed ops — rollback Turn 2 shows B+C+D+A", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A", "B"] },
			{ turnIndex: 1, modified: ["A"], added: ["C"] },
			{ turnIndex: 2, deleted: ["B"], modified: ["C"] },
			{ turnIndex: 3, added: ["D"], modified: ["A"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 2 });
		const paths = files.map((f) => f.path).sort();
		expect(paths).toEqual(["A", "B", "C", "D"]);
	});

	it("Case 5: 4 turns mixed ops — rollback Turn 0 shows all 4 files", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A", "B"] },
			{ turnIndex: 1, modified: ["A"], added: ["C"] },
			{ turnIndex: 2, deleted: ["B"], modified: ["C"] },
			{ turnIndex: 3, added: ["D"], modified: ["A"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 0 });
		const paths = files.map((f) => f.path).sort();
		expect(paths).toEqual(["A", "B", "C", "D"]);
	});

	/**
	 * Case 6: Gaps in turnIndex (e.g., after rollback + new turn)
	 *   turnIndex: 0, 2, 4 (skipping 1, 3)
	 *   Should still work correctly based on snapshotIndex values
	 */
	it("Case 6: Non-sequential turnIndex — rollback works correctly", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A"] },
			{ turnIndex: 2, added: ["B"] },
			{ turnIndex: 4, added: ["C"] },
		]);

		// Rollback turnIndex=4 → only C
		const files4 = manager.getModifiedFiles({ toTurnIndex: 4 });
		expect(files4.map((f) => f.path)).toEqual(["C"]);

		// Rollback turnIndex=2 → B + C
		const files2 = manager.getModifiedFiles({ toTurnIndex: 2 });
		expect(files2.map((f) => f.path).sort()).toEqual(["B", "C"]);

		// Rollback turnIndex=0 → A + B + C
		const files0 = manager.getModifiedFiles({ toTurnIndex: 0 });
		expect(files0.map((f) => f.path).sort()).toEqual(["A", "B", "C"]);
	});

	/**
	 * Case 7: Non-existent turnIndex → returns empty (graceful)
	 */
	it("Case 7: Non-existent turnIndex returns empty", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A"] },
			{ turnIndex: 1, added: ["B"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 99 });
		expect(files).toEqual([]);
	});

	/**
	 * Case 8: Single turn — rollback shows that turn's files
	 */
	it("Case 8: Single turn — rollback shows all files from that turn", () => {
		const manager = createManagerWithSnapshots([
			{ turnIndex: 0, added: ["A", "B", "C"] },
		]);

		const files = manager.getModifiedFiles({ toTurnIndex: 0 });
		expect(files.map((f) => f.path).sort()).toEqual(["A", "B", "C"]);
		expect(files.every((f) => f.status === "added")).toBe(true);
	});
});

describe("getModifiedFiles — rebuildIndex scenario (simulates restart)", () => {
	/**
	 * Simulates: session had 3 turns, app restarts, rebuildIndex is called
	 * with entries from JSONL. Then user clicks rollback on Turn B.
	 */
	it("rebuildIndex restores snapshots, rollback Turn B shows only Turn B's files", () => {
		const mockGit = {
			readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
			writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
			computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
			parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
		} as any;

		const manager = new FileSnapshotManager(mockGit);

		// Simulate entries that would come from sessionManager.getEntries()
		const entries = [
			{ type: "message", id: "msg-0", parentId: null, timestamp: "t0" },
			{
				type: "custom",
				customType: "step-snapshot",
				id: "snap-0",
				parentId: "msg-0",
				timestamp: "t1",
				data: {
					baselineTreeHash: "baseline",
					snapshotTreeHash: "hash-0",
					diff: { added: ["A"], modified: [], deleted: [] },
					turnIndex: 0,
				},
			},
			{ type: "message", id: "msg-1", parentId: "snap-0", timestamp: "t2" },
			{
				type: "custom",
				customType: "step-snapshot",
				id: "snap-1",
				parentId: "msg-1",
				timestamp: "t3",
				data: {
					baselineTreeHash: "hash-0",
					snapshotTreeHash: "hash-1",
					diff: { added: ["B"], modified: [], deleted: [] },
					turnIndex: 1,
				},
			},
			{ type: "message", id: "msg-2", parentId: "snap-1", timestamp: "t4" },
			{
				type: "custom",
				customType: "step-snapshot",
				id: "snap-2",
				parentId: "msg-2",
				timestamp: "t5",
				data: {
					baselineTreeHash: "hash-1",
					snapshotTreeHash: "hash-2",
					diff: { added: ["C"], modified: ["A"], deleted: [] },
					turnIndex: 2,
				},
			},
		] as any[];

		// Call rebuildIndex (simulates _initFileSnapshotManager after restart)
		manager.rebuildIndex(entries);

		// Verify snapshots were loaded
		expect((manager as any).snapshotIndex.size).toBe(3);
		expect((manager as any).turnIndexMap.size).toBe(3);

		// Rollback Turn B (turnIndex=1) → B + C + A(modified)
		const files1 = manager.getModifiedFiles({ toTurnIndex: 1 });
		const paths1 = files1.map((f) => f.path).sort();
		expect(paths1).toEqual(["A", "B", "C"]);

		// Rollback Turn C (turnIndex=2) → C + A(modified)
		const files2 = manager.getModifiedFiles({ toTurnIndex: 2 });
		const paths2 = files2.map((f) => f.path).sort();
		expect(paths2).toEqual(["A", "C"]);

		// Rollback Turn A (turnIndex=0) → all files
		const files0 = manager.getModifiedFiles({ toTurnIndex: 0 });
		const paths0 = files0.map((f) => f.path).sort();
		expect(paths0).toEqual(["A", "B", "C"]);

		// No filter → all files
		const allFiles = manager.getModifiedFiles();
		expect(allFiles.map((f) => f.path).sort()).toEqual(["A", "B", "C"]);
	});

	it("rebuildIndex with empty entries returns empty files", () => {
		const mockGit = {
			readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
			writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
			computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
			parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
		} as any;

		const manager = new FileSnapshotManager(mockGit);
		manager.rebuildIndex([]);

		const files = manager.getModifiedFiles();
		expect(files).toEqual([]);
	});

	it("rebuildIndex with no step-snapshot entries returns empty files", () => {
		const mockGit = {
			readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
			writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
			computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
			parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
		} as any;

		const manager = new FileSnapshotManager(mockGit);
		manager.rebuildIndex([
			{ type: "message", id: "msg-0", parentId: null, timestamp: "t0" },
			{ type: "message", id: "msg-1", parentId: "msg-0", timestamp: "t1" },
		] as any[]);

		const files = manager.getModifiedFiles();
		expect(files).toEqual([]);
	});
});

describe("rebuildIndex with leafId branch filtering", () => {
	it("filters out off-branch snapshots, only keeping current branch path", () => {
		const mockGit = {
			readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
			writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
			computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
			parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
		} as any;

		const manager = new FileSnapshotManager(mockGit);

		// Tree:
		//   e1(null) → snap-A0(turn=0, added:A) → e3 → snap-A1(turn=2, added:B) → e5
		//     └── e6 → snap-B0(turn=0, added:C) → e8 → snap-B1(turn=2, added:D) → e10 → snap-B2(turn=3, added:E) → e12 (leafId)
		const entries = [
			{ type: "message", id: "e1", parentId: null, timestamp: "t0" },
			{ type: "custom", customType: "step-snapshot", id: "snap-A0", parentId: "e1", timestamp: "t1", data: { baselineTreeHash: "b", snapshotTreeHash: "h0", diff: { added: ["A"], modified: [], deleted: [] }, turnIndex: 0 } },
			{ type: "message", id: "e3", parentId: "snap-A0", timestamp: "t2" },
			{ type: "custom", customType: "step-snapshot", id: "snap-A1", parentId: "e3", timestamp: "t3", data: { baselineTreeHash: "h0", snapshotTreeHash: "h1", diff: { added: ["B"], modified: [], deleted: [] }, turnIndex: 2 } },
			{ type: "message", id: "e5", parentId: "snap-A1", timestamp: "t4" },
			// Branch B: rollback to e1
			{ type: "message", id: "e6", parentId: "e1", timestamp: "t5" },
			{ type: "custom", customType: "step-snapshot", id: "snap-B0", parentId: "e6", timestamp: "t6", data: { baselineTreeHash: "b", snapshotTreeHash: "h2", diff: { added: ["C"], modified: [], deleted: [] }, turnIndex: 0 } },
			{ type: "message", id: "e8", parentId: "snap-B0", timestamp: "t7" },
			{ type: "custom", customType: "step-snapshot", id: "snap-B1", parentId: "e8", timestamp: "t8", data: { baselineTreeHash: "h2", snapshotTreeHash: "h3", diff: { added: ["D"], modified: [], deleted: [] }, turnIndex: 2 } },
			{ type: "message", id: "e10", parentId: "snap-B1", timestamp: "t9" },
			{ type: "custom", customType: "step-snapshot", id: "snap-B2", parentId: "e10", timestamp: "t10", data: { baselineTreeHash: "h3", snapshotTreeHash: "h4", diff: { added: ["E"], modified: [], deleted: [] }, turnIndex: 3 } },
			{ type: "message", id: "e12", parentId: "snap-B2", timestamp: "t11" },
		] as any;

		// Call rebuildIndex with leafId = e12 (Branch B's leaf)
		manager.rebuildIndex(entries, "e12");

		// Only Branch B's 3 snapshots should be kept (off-branch snap-A0, snap-A1 excluded)
		const snapIndex = (manager as any).snapshotIndex as Map<string, unknown>;
		expect(snapIndex.size).toBe(3);
		expect(snapIndex.has("snap-B0")).toBe(true);
		expect(snapIndex.has("snap-B1")).toBe(true);
		expect(snapIndex.has("snap-B2")).toBe(true);
		expect(snapIndex.has("snap-A0")).toBe(false);
		expect(snapIndex.has("snap-A1")).toBe(false);

		// turnIndexMap should point to Branch B's snapshots
		expect((manager as any).turnIndexMap.get(0)).toBe("snap-B0");
		expect((manager as any).turnIndexMap.get(2)).toBe("snap-B1");
		expect((manager as any).turnIndexMap.get(3)).toBe("snap-B2");

		// sessionStartTreeHash from first snapshot on branch path
		expect((manager as any).sessionStartTreeHash).toBe("b");
		// lastCommittedTreeHash from last snapshot on branch path
		expect((manager as any).lastCommittedTreeHash).toBe("h4");
	});

	it("fromEntryId resolves correctly with duplicate turnIndex across branches", () => {
		const mockGit = {
			readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
			writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
			computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
			parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
		} as any;

		const manager = new FileSnapshotManager(mockGit);

		const entries = [
			{ type: "message", id: "e1", parentId: null, timestamp: "t0" },
			{ type: "custom", customType: "step-snapshot", id: "snap-A0", parentId: "e1", timestamp: "t1", data: { baselineTreeHash: "b", snapshotTreeHash: "h0", diff: { added: ["A"], modified: [], deleted: [] }, turnIndex: 0 } },
			{ type: "message", id: "e3", parentId: "snap-A0", timestamp: "t2" },
			{ type: "custom", customType: "step-snapshot", id: "snap-A1", parentId: "e3", timestamp: "t3", data: { baselineTreeHash: "h0", snapshotTreeHash: "h1", diff: { added: ["B"], modified: [], deleted: [] }, turnIndex: 2 } },
			{ type: "message", id: "e5", parentId: "snap-A1", timestamp: "t4" },
			{ type: "message", id: "e6", parentId: "e1", timestamp: "t5" },
			{ type: "custom", customType: "step-snapshot", id: "snap-B0", parentId: "e6", timestamp: "t6", data: { baselineTreeHash: "b", snapshotTreeHash: "h2", diff: { added: ["C"], modified: [], deleted: [] }, turnIndex: 0 } },
			{ type: "message", id: "e8", parentId: "snap-B0", timestamp: "t7" },
			{ type: "custom", customType: "step-snapshot", id: "snap-B1", parentId: "e8", timestamp: "t8", data: { baselineTreeHash: "h2", snapshotTreeHash: "h3", diff: { added: ["D"], modified: [], deleted: [] }, turnIndex: 2 } },
			{ type: "message", id: "e10", parentId: "snap-B1", timestamp: "t9" },
			{ type: "custom", customType: "step-snapshot", id: "snap-B2", parentId: "e10", timestamp: "t10", data: { baselineTreeHash: "h3", snapshotTreeHash: "h4", diff: { added: ["E"], modified: [], deleted: [] }, turnIndex: 3 } },
			{ type: "message", id: "e12", parentId: "snap-B2", timestamp: "t11" },
		] as any;

		manager.rebuildIndex(entries, "e12");

		// Rollback to snap-B1 (turnIndex=2 on current branch) → D, E
		const files = manager.getModifiedFiles({ fromEntryId: "snap-B1" });
		const paths = files.map((f) => f.path).sort();
		expect(paths).toEqual(["D", "E"]);

		// Rollback to snap-B0 (turnIndex=0 on current branch) → C, D, E
		const files2 = manager.getModifiedFiles({ fromEntryId: "snap-B0" });
		const paths2 = files2.map((f) => f.path).sort();
		expect(paths2).toEqual(["C", "D", "E"]);

		// toTurnIndex also works correctly since turnIndexMap now points to correct branch snapshots
		const files3 = manager.getModifiedFiles({ toTurnIndex: 2 });
		const paths3 = files3.map((f) => f.path).sort();
		expect(paths3).toEqual(["D", "E"]);
	});

	it("without leafId, all branch snapshots are kept (backward compat)", () => {
		const mockGit = {
			readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
			writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
			computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
			parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
		} as any;

		const manager = new FileSnapshotManager(mockGit);

		const entries = [
			{ type: "message", id: "e1", parentId: null, timestamp: "t0" },
			{ type: "custom", customType: "step-snapshot", id: "snap-A0", parentId: "e1", timestamp: "t1", data: { baselineTreeHash: "b", snapshotTreeHash: "h0", diff: { added: ["A"], modified: [], deleted: [] }, turnIndex: 0 } },
			{ type: "custom", customType: "step-snapshot", id: "snap-B0", parentId: "e6", timestamp: "t2", data: { baselineTreeHash: "b", snapshotTreeHash: "h2", diff: { added: ["C"], modified: [], deleted: [] }, turnIndex: 0 } },
		] as any;

		// No leafId = no branch filtering
		manager.rebuildIndex(entries);

		expect((manager as any).snapshotIndex.size).toBe(2);
	});
});
