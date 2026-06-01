import { describe, expect, it, vi } from "vitest";
import type { StepSnapshotData } from "../../src/core/file-store/file-snapshot-manager.js";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.js";

type MockReadTreeFn = (hash: string) => Map<string, string> | null;

function createMockGit(readTreeFn: MockReadTreeFn) {
	return {
		readTree: vi.fn(readTreeFn),
		readFilteredWorkingDir: vi.fn().mockReturnValue(new Map()),
		writeTree: vi.fn().mockReturnValue({ treeHash: null, entries: new Map() }),
		computeDiff: vi.fn().mockReturnValue({ added: [], modified: [], deleted: [] }),
		parseTreeEntriesFromHash: vi.fn().mockReturnValue(new Map()),
	} as any;
}

function msg(id: string, parentId: string | null, role: string = "user"): any {
	return {
		type: "message",
		id,
		parentId,
		role,
		timestamp: `t-${id}`,
		message: { role, content: "" },
	};
}

function snap(
	id: string,
	parentId: string,
	data: {
		baselineTreeHash: string | null;
		snapshotTreeHash: string;
		added?: string[];
		modified?: string[];
		deleted?: string[];
		turnIndex: number;
	},
): any {
	return {
		type: "custom",
		customType: "step-snapshot",
		id,
		parentId,
		timestamp: `t-${id}`,
		data: {
			baselineTreeHash: data.baselineTreeHash,
			snapshotTreeHash: data.snapshotTreeHash,
			diff: {
				added: data.added ?? [],
				modified: data.modified ?? [],
				deleted: data.deleted ?? [],
			},
			turnIndex: data.turnIndex,
		} satisfies StepSnapshotData,
	};
}

function setupManager(treeStore: Map<string, Map<string, string>>, entries: any[], sessionStartTreeHash?: string) {
	const manager = new FileSnapshotManager(createMockGit((hash: string) => treeStore.get(hash) ?? null));

	manager.rebuildIndex(entries);

	if (sessionStartTreeHash !== undefined) {
		(manager as any).sessionStartTreeHash = sessionStartTreeHash;
	}

	return manager;
}

function makeTree(files: Record<string, string>): Map<string, string> {
	return new Map(Object.entries(files));
}

describe("getRollbackPreviewFiles", () => {
	describe("Scenario 1: Basic two-turn rollback", () => {
		function buildScenario1Entries() {
			return [
				msg("u1", null, "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["a.txt"],
					turnIndex: 0,
				}),
				msg("u2", "snap-t1", "user"),
				msg("a2", "u2", "assistant"),
				snap("snap-t2", "a2", {
					baselineTreeHash: "hash-t1",
					snapshotTreeHash: "hash-t2",
					added: ["b.txt"],
					turnIndex: 1,
				}),
			];
		}

		it("rollback to T1 assistant → finds snap-t1 as child of a1, shows b.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "a", "b.txt": "b" }));

			const entries = buildScenario1Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a1",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]).toEqual({
				path: "b.txt",
				status: "added",
				turnIndex: -1,
				entryId: "",
			});
		});

		it("rollback to T2 assistant → snap-t2 is child of a2, path walk finds snap-t1 ancestor; shows b.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "a", "b.txt": "b" }));

			const entries = buildScenario1Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a2",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]).toEqual({
				path: "b.txt",
				status: "added",
				turnIndex: -1,
				entryId: "",
			});
		});

		it("rollback to T1 user message → no snapshot on path or as child, falls back to sessionStartTreeHash; shows a.txt + b.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "a", "b.txt": "b" }));

			const entries = buildScenario1Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "u1",
				entries,
			});

			expect(files).toHaveLength(2);
			const paths = files.map((f) => f.path).sort();
			expect(paths).toEqual(["a.txt", "b.txt"]);
			expect(files.every((f) => f.status === "added")).toBe(true);
		});

		it("rollback to T2 user message → snap-t1 on path from u2, shows b.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "a", "b.txt": "b" }));

			const entries = buildScenario1Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "u2",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]).toEqual({
				path: "b.txt",
				status: "added",
				turnIndex: -1,
				entryId: "",
			});
		});
	});

	describe("Scenario 2: File modification", () => {
		function buildScenario2Entries() {
			return [
				msg("u1", null, "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["a.txt"],
					turnIndex: 0,
				}),
				msg("u2", "snap-t1", "user"),
				msg("a2", "u2", "assistant"),
				snap("snap-t2", "a2", {
					baselineTreeHash: "hash-t1",
					snapshotTreeHash: "hash-t2",
					modified: ["a.txt"],
					turnIndex: 1,
				}),
			];
		}

		it("rollback to T1 assistant → shows a.txt (modified)", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "v1" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "v2" }));

			const entries = buildScenario2Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a1",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]!.path).toBe("a.txt");
			expect(files[0]!.status).toBe("modified");
		});

		it("rollback to T1 user message → falls back to sessionStartTreeHash, shows a.txt modified", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "v1" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "v2" }));

			const entries = buildScenario2Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "u1",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]!.path).toBe("a.txt");
			expect(files[0]!.status).toBe("added");
		});
	});

	describe("Scenario 3: File deletion", () => {
		function buildScenario3Entries() {
			return [
				msg("u1", null, "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["a.txt"],
					turnIndex: 0,
				}),
				msg("u2", "snap-t1", "user"),
				msg("a2", "u2", "assistant"),
				snap("snap-t2", "a2", {
					baselineTreeHash: "hash-t1",
					snapshotTreeHash: "hash-t2",
					deleted: ["a.txt"],
					turnIndex: 1,
				}),
			];
		}

		it("rollback to T1 assistant → target=hash-t1, current=hash-t2; a.txt in target but not current → deleted", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t2", makeTree({}));

			const entries = buildScenario3Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a1",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]!.path).toBe("a.txt");
			expect(files[0]!.status).toBe("deleted");
		});

		it("rollback to T2 assistant → snap-t1 ancestor on path, target=hash-t1, current=hash-t2; a.txt deleted", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t2", makeTree({}));

			const entries = buildScenario3Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a2",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]!.path).toBe("a.txt");
			expect(files[0]!.status).toBe("deleted");
		});
	});

	describe("Scenario 4: Pure chat turn (no file changes)", () => {
		function buildScenario4Entries() {
			return [
				msg("u1", null, "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["a.txt"],
					turnIndex: 0,
				}),
				msg("u2", "snap-t1", "user"),
				msg("a2", "u2", "assistant"),
				msg("u3", "a2", "user"),
				msg("a3", "u3", "assistant"),
				snap("snap-t3", "a3", {
					baselineTreeHash: "hash-t1",
					snapshotTreeHash: "hash-t3",
					added: ["b.txt"],
					turnIndex: 1,
				}),
			];
		}

		it("rollback to T2 user message → snap-t1 on path, shows b.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t3", makeTree({ "a.txt": "a", "b.txt": "b" }));

			const entries = buildScenario4Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "u2",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]).toEqual({
				path: "b.txt",
				status: "added",
				turnIndex: -1,
				entryId: "",
			});
		});

		it("rollback to T2 assistant message → snap-t1 on path, shows b.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t3", makeTree({ "a.txt": "a", "b.txt": "b" }));

			const entries = buildScenario4Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a2",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]).toEqual({
				path: "b.txt",
				status: "added",
				turnIndex: -1,
				entryId: "",
			});
		});

		it("rollback to T1 user message → falls back to sessionStartTreeHash, shows a.txt + b.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t3", makeTree({ "a.txt": "a", "b.txt": "b" }));

			const entries = buildScenario4Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "u1",
				entries,
			});

			expect(files).toHaveLength(2);
			const paths = files.map((f) => f.path).sort();
			expect(paths).toEqual(["a.txt", "b.txt"]);
			expect(files.every((f) => f.status === "added")).toBe(true);
		});
	});

	describe("Scenario 5: Three turns", () => {
		function buildScenario5Entries() {
			return [
				msg("u1", null, "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["a.txt"],
					turnIndex: 0,
				}),
				msg("u2", "snap-t1", "user"),
				msg("a2", "u2", "assistant"),
				snap("snap-t2", "a2", {
					baselineTreeHash: "hash-t1",
					snapshotTreeHash: "hash-t2",
					added: ["b.txt"],
					turnIndex: 1,
				}),
				msg("u3", "snap-t2", "user"),
				msg("a3", "u3", "assistant"),
				snap("snap-t3", "a3", {
					baselineTreeHash: "hash-t2",
					snapshotTreeHash: "hash-t3",
					added: ["c.txt"],
					turnIndex: 2,
				}),
			];
		}

		it("rollback to T2 assistant → snap-t1 on path (ancestor), target=hash-t1, shows b.txt + c.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "a", "b.txt": "b" }));
			treeStore.set("hash-t3", makeTree({ "a.txt": "a", "b.txt": "b", "c.txt": "c" }));

			const entries = buildScenario5Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a2",
				entries,
			});

			const paths = files.map((f) => f.path).sort();
			expect(paths).toEqual(["b.txt", "c.txt"]);
			expect(files.every((f) => f.status === "added")).toBe(true);
		});

		it("rollback to T1 assistant → snap-t1 is child of a1, target=hash-t1, shows b.txt + c.txt added", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "a", "b.txt": "b" }));
			treeStore.set("hash-t3", makeTree({ "a.txt": "a", "b.txt": "b", "c.txt": "c" }));

			const entries = buildScenario5Entries();
			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a1",
				entries,
			});

			const paths = files.map((f) => f.path).sort();
			expect(paths).toEqual(["b.txt", "c.txt"]);
			expect(files.every((f) => f.status === "added")).toBe(true);
		});
	});

	describe("Edge cases", () => {
		it("returns empty when target is a snapshot entry directly in snapshotIndex", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));

			const entries = [
				msg("u1", null, "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["a.txt"],
					turnIndex: 0,
				}),
			];

			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "snap-t1",
				entries,
			});

			expect(files).toEqual([]);
		});

		it("returns empty when entries array is empty", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));

			const manager = setupManager(treeStore, [], "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "nonexistent",
				entries: [],
			});

			expect(files).toEqual([]);
		});

		it("handles target with no snapshot on path falling back to sessionStartTreeHash", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "a" }));

			const entries = [
				msg("root", null, "user"),
				msg("u1", "root", "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["a.txt"],
					turnIndex: 0,
				}),
			];

			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "root",
				entries,
			});

			expect(files).toHaveLength(1);
			expect(files[0]!.path).toBe("a.txt");
			expect(files[0]!.status).toBe("added");
		});

		it("handles mixed create + modify + delete across 3 turns", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "a.txt": "v1", "b.txt": "b" }));
			treeStore.set("hash-t2", makeTree({ "a.txt": "v2", "b.txt": "b" }));
			treeStore.set("hash-t3", makeTree({ "a.txt": "v2" }));

			const entries = [
				msg("u1", null, "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["a.txt", "b.txt"],
					turnIndex: 0,
				}),
				msg("u2", "snap-t1", "user"),
				msg("a2", "u2", "assistant"),
				snap("snap-t2", "a2", {
					baselineTreeHash: "hash-t1",
					snapshotTreeHash: "hash-t2",
					modified: ["a.txt"],
					turnIndex: 1,
				}),
				msg("u3", "snap-t2", "user"),
				msg("a3", "u3", "assistant"),
				snap("snap-t3", "a3", {
					baselineTreeHash: "hash-t2",
					snapshotTreeHash: "hash-t3",
					deleted: ["b.txt"],
					turnIndex: 2,
				}),
			];

			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a1",
				entries,
			});

			expect(files).toHaveLength(2);
			const aFile = files.find((f) => f.path === "a.txt");
			const bFile = files.find((f) => f.path === "b.txt");
			expect(aFile!.status).toBe("modified");
			expect(bFile!.status).toBe("deleted");
		});

		it("returns sorted files by path", () => {
			const treeStore = new Map<string, Map<string, string>>();
			treeStore.set("hash-start", makeTree({}));
			treeStore.set("hash-t1", makeTree({ "z.txt": "z" }));
			treeStore.set("hash-t2", makeTree({ "z.txt": "z", "a.txt": "a", "m.txt": "m" }));

			const entries = [
				msg("u1", null, "user"),
				msg("a1", "u1", "assistant"),
				snap("snap-t1", "a1", {
					baselineTreeHash: "hash-start",
					snapshotTreeHash: "hash-t1",
					added: ["z.txt"],
					turnIndex: 0,
				}),
				msg("u2", "snap-t1", "user"),
				msg("a2", "u2", "assistant"),
				snap("snap-t2", "a2", {
					baselineTreeHash: "hash-t1",
					snapshotTreeHash: "hash-t2",
					added: ["a.txt", "m.txt"],
					turnIndex: 1,
				}),
			];

			const manager = setupManager(treeStore, entries, "hash-start");

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "a1",
				entries,
			});

			expect(files.map((f) => f.path)).toEqual(["a.txt", "m.txt"]);
		});

		it("returns empty when sessionStartTreeHash is null and target resolves to null", () => {
			const treeStore = new Map<string, Map<string, string>>();

			const manager = new FileSnapshotManager(createMockGit((hash: string) => treeStore.get(hash) ?? null));
			(manager as any).sessionStartTreeHash = null;
			(manager as any).lastCommittedTreeHash = null;

			const files = manager.getRollbackPreviewFiles({
				targetEntryId: "anything",
				entries: [],
			});

			expect(files).toEqual([]);
		});
	});
});
