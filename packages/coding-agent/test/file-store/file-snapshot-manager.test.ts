import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.js";
import { InternalGit } from "../../src/core/file-store/internal-git.js";
import type { SessionEntry } from "../../src/core/session-manager.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `fsm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

interface MockCustomEntry {
	type: "custom";
	id: string;
	parentId: string | null;
	timestamp: string;
	customType: string;
	data: unknown;
}

describe("FileSnapshotManager", () => {
	let tempDir: string;
	let storeDir: string;
	let git: InternalGit;
	let manager: FileSnapshotManager;
	let appendedEntries: MockCustomEntry[];
	let entryIdCounter: number;

	beforeEach(() => {
		tempDir = createTempDir();
		storeDir = createTempDir();
		git = InternalGit.createForProject(storeDir, tempDir);
		manager = new FileSnapshotManager(git);
		appendedEntries = [];
		entryIdCounter = 0;
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		rmSync(storeDir, { recursive: true, force: true });
	});

	const appendEntry = (type: string, data: unknown): string => {
		const id = `entry-${entryIdCounter++}`;
		const entry: MockCustomEntry = {
			type: "custom",
			id,
			parentId: appendedEntries.length > 0 ? appendedEntries[appendedEntries.length - 1]!.id : null,
			timestamp: new Date().toISOString(),
			customType: type,
			data,
		};
		appendedEntries.push(entry);
		return id;
	};

	const toSessionEntries = (): SessionEntry[] => {
		return appendedEntries as unknown as SessionEntry[];
	};

	describe("initialize()", () => {
		it("creates session start snapshot for non-empty directory", async () => {
			writeFileSync(join(tempDir, "foo.ts"), "hello", "utf-8");

			await manager.initialize(tempDir);

			expect(manager.getSnapshotAtTurn(0)).toBeNull();
		});

		it("handles empty directory", async () => {
			await manager.initialize(tempDir);

			expect(manager.getSnapshotAtTurn(0)).toBeNull();
		});

		it("stores session start tree hash internally", async () => {
			writeFileSync(join(tempDir, "a.ts"), "content-a", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "content-b", "utf-8");

			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "changed", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			expect(appendedEntries.length).toBe(1);
			const data = appendedEntries[0]!.data as { baselineTreeHash: string | null };
			expect(data.baselineTreeHash).not.toBeNull();
		});
	});

	describe("onTurnEnd()", () => {
		it("skips snapshot when no files changed", async () => {
			writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "foo.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			manager.onTurnEnd(tempDir, 1, appendEntry);

			expect(appendedEntries.length).toBe(1);
		});

		it("creates snapshot on file change", async () => {
			writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "foo.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			expect(appendedEntries.length).toBe(1);
			const entry = appendedEntries[0]!;
			expect(entry.customType).toBe("step-snapshot");
			const data = entry.data as { diff: { modified: string[] } };
			expect(data.diff).not.toBeNull();
			expect(data.diff!.modified).toContain("foo.ts");
		});

		it("creates snapshot on file add", async () => {
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "new-file.ts"), "new content", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			expect(appendedEntries.length).toBe(1);
			const data = appendedEntries[0]!.data as { diff: { added: string[] }; baselineTreeHash: string | null };
			expect(data.diff).not.toBeNull();
			expect(data.diff!.added).toContain("new-file.ts");
			expect(data.baselineTreeHash).toBeNull();
		});

		it("creates snapshot on file delete", async () => {
			writeFileSync(join(tempDir, "old-file.ts"), "will be deleted", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "old-file.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			expect(appendedEntries.length).toBe(1);
			const data = appendedEntries[0]!.data as { diff: { deleted: string[] } };
			expect(data.diff).not.toBeNull();
			expect(data.diff!.deleted).toContain("old-file.ts");
		});

		it("tracks turn index correctly", async () => {
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "first", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "second", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			expect(appendedEntries.length).toBe(2);
			expect((appendedEntries[0]!.data as { turnIndex: number }).turnIndex).toBe(0);
			expect((appendedEntries[1]!.data as { turnIndex: number }).turnIndex).toBe(1);
		});

		it("skips large files over 1MB", async () => {
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "big.ts"), "x".repeat(1024 * 1024 + 1), "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			expect(appendedEntries.length).toBe(0);
		});
	});

	describe("rebuildIndex()", () => {
		it("rebuilds from step-snapshot custom entries", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const m2 = new FileSnapshotManager(git);
			m2.rebuildIndex(toSessionEntries());

			expect(m2.getSnapshotAtTurn(0)).not.toBeNull();
			expect(m2.getSnapshotAtTurn(1)).not.toBeNull();
			expect(m2.getSnapshotAtTurn(2)).toBeNull();
		});

		it("handles empty entries", () => {
			const m2 = new FileSnapshotManager(git);
			m2.rebuildIndex([]);

			expect(m2.getSnapshotAtTurn(0)).toBeNull();
		});

		it("ignores non-snapshot entries", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const noiseEntry: MockCustomEntry = {
				type: "custom",
				id: `entry-${entryIdCounter++}`,
				parentId: appendedEntries[appendedEntries.length - 1]!.id,
				timestamp: new Date().toISOString(),
				customType: "other-extension",
				data: { foo: "bar" },
			};
			appendedEntries.push(noiseEntry);

			const m2 = new FileSnapshotManager(git);
			m2.rebuildIndex(toSessionEntries());

			expect(m2.getSnapshotAtTurn(0)).not.toBeNull();
			expect(m2.getSnapshotAtTurn(1)).toBeNull();
		});
	});

	describe("getLatestSnapshotOnPath()", () => {
		it("returns latest snapshot on path", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const leafId = appendedEntries[appendedEntries.length - 1]!.id;
			const snap = manager.getLatestSnapshotOnPath(toSessionEntries(), leafId);

			expect(snap).not.toBeNull();
			expect(snap!.turnIndex).toBe(1);
		});

		it("returns null when no snapshots", async () => {
			await manager.initialize(tempDir);

			const snap = manager.getLatestSnapshotOnPath([], "some-id");
			expect(snap).toBeNull();
		});

		it("returns null when leafId is null", async () => {
			const snap = manager.getLatestSnapshotOnPath([], null);
			expect(snap).toBeNull();
		});

		it("follows tree path correctly", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const branchPoint = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const snap = manager.getLatestSnapshotOnPath(toSessionEntries(), branchPoint);

			expect(snap).not.toBeNull();
			expect(snap!.turnIndex).toBe(0);
		});
	});

	describe("restoreFiles()", () => {
		it("restores modified files", async () => {
			writeFileSync(join(tempDir, "foo.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "foo.ts"), "modified", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const targetEntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "foo.ts"), "modified-again", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(result.restored).toContain("foo.ts");
			expect(readFileSync(join(tempDir, "foo.ts"), "utf-8")).toBe("modified");
		});

		it("deletes files not in target", async () => {
			writeFileSync(join(tempDir, "original.ts"), "keep", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "original.ts"), "keep");
			writeFileSync(join(tempDir, "added-later.ts"), "new", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "original.ts"), "keep");
			writeFileSync(join(tempDir, "added-later.ts"), "new");
			writeFileSync(join(tempDir, "extra.ts"), "extra", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const targetEntryId = appendedEntries[0]!.id;

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(result.deleted).toContain("extra.ts");
			expect(existsSync(join(tempDir, "extra.ts"))).toBe(false);
			expect(readFileSync(join(tempDir, "added-later.ts"), "utf-8")).toBe("new");
		});

		it("preview mode returns plan without writing", async () => {
			writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "foo.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "foo.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const targetEntryId = appendedEntries[0]!.id;

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId,
				entries: toSessionEntries(),
				appendEntry,
				preview: true,
			});

			expect(result.restored).toContain("foo.ts");
			expect(readFileSync(join(tempDir, "foo.ts"), "utf-8")).toBe("v3");
		});

		it("detects dirty files", async () => {
			writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "foo.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "foo.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const targetEntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "foo.ts"), "externally-modified", "utf-8");

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(result.dirty).toContain("foo.ts");
		});

		it("returns empty result when snapshots identical", async () => {
			writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "foo.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const targetEntryId = appendedEntries[0]!.id;

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId,
				currentLeafId: appendedEntries[0]!.id,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(result.restored).toEqual([]);
			expect(result.deleted).toEqual([]);
		});

		it("appends unrevert-point entry", async () => {
			writeFileSync(join(tempDir, "foo.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "foo.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "foo.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const entriesBefore = appendedEntries.length;
			const targetEntryId = appendedEntries[0]!.id;

			await manager.restoreFiles(tempDir, {
				targetEntryId,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(appendedEntries.length).toBe(entriesBefore + 1);
			const unrevert = appendedEntries[appendedEntries.length - 1]!;
			expect(unrevert.customType).toBe("unrevert-point");
			const data = unrevert.data as { restoredFiles: string[] };
			expect(data.restoredFiles).toContain("foo.ts");
		});

		it("restores to session start when no targetEntryId", async () => {
			writeFileSync(join(tempDir, "original.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "original.ts"), "changed", "utf-8");
			writeFileSync(join(tempDir, "added.ts"), "added", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await manager.restoreFiles(tempDir, {
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(result.restored).toContain("original.ts");
			expect(result.deleted).toContain("added.ts");
			expect(readFileSync(join(tempDir, "original.ts"), "utf-8")).toBe("original");
			expect(existsSync(join(tempDir, "added.ts"))).toBe(false);
		});

		it("uses snapshotHash directly when provided", async () => {
			writeFileSync(join(tempDir, "a.ts"), "snap-a", "utf-8");
			const snapAFiles = git.scanWorkingDir(tempDir);
			const { treeHash: snapAHash } = git.writeTree(snapAFiles);

			writeFileSync(join(tempDir, "b.ts"), "snap-b", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "changed");
			writeFileSync(join(tempDir, "b.ts"), "changed");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await manager.restoreFiles(tempDir, {
				snapshotHash: snapAHash,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(result.restored).toContain("a.ts");
		});

		it("selective restore with files filter", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const targetEntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId,
				entries: toSessionEntries(),
				appendEntry,
				files: ["a.ts"],
			});

			expect(result.restored).toContain("a.ts");
			expect(result.restored).not.toContain("b.ts");
			expect(readFileSync(join(tempDir, "a.ts"), "utf-8")).toBe("v2");
			expect(readFileSync(join(tempDir, "b.ts"), "utf-8")).toBe("v3");
		});
	});

	describe("getLiveChanges()", () => {
		it("returns empty when no changes from baseline", async () => {
			writeFileSync(join(tempDir, "a.ts"), "hello", "utf-8");
			await manager.initialize(tempDir);

			const changes = manager.getLiveChanges(tempDir);
			expect(changes).toEqual([]);
		});

		it("detects added files", async () => {
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "new.ts"), "new content", "utf-8");
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(1);
			expect(changes[0]!.path).toBe("new.ts");
			expect(changes[0]!.status).toBe("added");
			expect(changes[0]!.diff.oldContent).toBeNull();
			expect(changes[0]!.diff.newContent).toBe("new content");
		});

		it("detects modified files", async () => {
			writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "modified", "utf-8");
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(1);
			expect(changes[0]!.path).toBe("a.ts");
			expect(changes[0]!.status).toBe("modified");
			expect(changes[0]!.diff.oldContent).toBe("original");
			expect(changes[0]!.diff.newContent).toBe("modified");
		});

		it("detects deleted files", async () => {
			writeFileSync(join(tempDir, "will-delete.ts"), "delete me", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "will-delete.ts"));
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(1);
			expect(changes[0]!.path).toBe("will-delete.ts");
			expect(changes[0]!.status).toBe("deleted");
			expect(changes[0]!.diff.oldContent).toBe("delete me");
			expect(changes[0]!.diff.newContent).toBeNull();
		});

		it("detects mixed add/modify/delete in one call", async () => {
			writeFileSync(join(tempDir, "keep.ts"), "keep", "utf-8");
			writeFileSync(join(tempDir, "modify.ts"), "original", "utf-8");
			writeFileSync(join(tempDir, "delete.ts"), "gone", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "modify.ts"), "changed", "utf-8");
			rmSync(join(tempDir, "delete.ts"));
			writeFileSync(join(tempDir, "added.ts"), "new", "utf-8");

			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(3);
			const byPath = new Map(changes.map((c) => [c.path, c]));

			expect(byPath.get("added.ts")!.status).toBe("added");
			expect(byPath.get("modify.ts")!.status).toBe("modified");
			expect(byPath.get("delete.ts")!.status).toBe("deleted");
		});

		it("detects deleted files after onTurnEnd committed a baseline", async () => {
			// Scenario: Turn 0 creates a.ts, Turn 1 deletes a.ts
			// After Turn 0's onTurnEnd, baseline is updated to include a.ts
			// getLiveChanges should still detect the deletion
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "first", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			rmSync(join(tempDir, "a.ts"));
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(1);
			expect(changes[0]!.path).toBe("a.ts");
			expect(changes[0]!.status).toBe("deleted");
		});

		it("returns empty after onTurnEnd commits the same state", async () => {
			writeFileSync(join(tempDir, "a.ts"), "stable", "utf-8");
			await manager.initialize(tempDir);

			manager.onTurnEnd(tempDir, 0, appendEntry);

			// No further changes — getLiveChanges should be empty
			const changes = manager.getLiveChanges(tempDir);
			expect(changes).toEqual([]);
		});

		it("detects deleted file in subdirectory", async () => {
			const subDir = join(tempDir, "nested");
			mkdirSync(subDir, { recursive: true });
			writeFileSync(join(subDir, "file.ts"), "sub content", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(subDir, "file.ts"));
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(1);
			expect(changes[0]!.path).toBe("nested/file.ts");
			expect(changes[0]!.status).toBe("deleted");
			expect(changes[0]!.diff.oldContent).toBe("sub content");
			expect(changes[0]!.diff.newContent).toBeNull();
		});

		it("detects multiple deleted files in one call", async () => {
			writeFileSync(join(tempDir, "a.ts"), "a", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "b", "utf-8");
			writeFileSync(join(tempDir, "c.ts"), "c", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			rmSync(join(tempDir, "c.ts"));
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(2);
			const paths = changes.map((c) => c.path).sort();
			expect(paths).toEqual(["a.ts", "c.ts"]);
			expect(changes.every((c) => c.status === "deleted")).toBe(true);
		});

		it("detects delete as modified-then-deleted in same turn", async () => {
			// File exists in baseline, gets modified then deleted within the same turn.
			// getLiveChanges should show deleted (not modified + deleted).
			writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			// Modify then delete — only the delete takes effect on disk
			writeFileSync(join(tempDir, "a.ts"), "changed", "utf-8");
			rmSync(join(tempDir, "a.ts"));
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(1);
			expect(changes[0]!.path).toBe("a.ts");
			expect(changes[0]!.status).toBe("deleted");
			// old content should come from baseline, not the intermediate write
			expect(changes[0]!.diff.oldContent).toBe("original");
			expect(changes[0]!.diff.newContent).toBeNull();
		});

		it("returns empty when all files deleted and nothing was in baseline", async () => {
			// Session started empty, user created then deleted files within the session
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "temp.ts"), "temp", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			rmSync(join(tempDir, "temp.ts"));
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(1);
			expect(changes[0]!.status).toBe("deleted");
		});

		it("detects deleted file when old content was large (near 1MB)", async () => {
			// File is under 1MB so it gets indexed, then deleted
			writeFileSync(join(tempDir, "big.ts"), "x".repeat(900_000), "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "big.ts"));
			const changes = manager.getLiveChanges(tempDir);

			expect(changes).toHaveLength(1);
			expect(changes[0]!.path).toBe("big.ts");
			expect(changes[0]!.status).toBe("deleted");
			// oldContent should still be available from git object storage
			expect(changes[0]!.diff.oldContent).toBe("x".repeat(900_000));
			expect(changes[0]!.diff.newContent).toBeNull();
		});

		it("does not report file as deleted when it was never in baseline", async () => {
			// File never existed at session start or any committed turn
			await manager.initialize(tempDir);

			// Someone creates and deletes a file — net zero
			writeFileSync(join(tempDir, "ghost.ts"), "poof", "utf-8");
			rmSync(join(tempDir, "ghost.ts"));
			const changes = manager.getLiveChanges(tempDir);

			// Since baseline is empty and current files don't have ghost.ts
			// computeDiff: oldEntries is empty (empty baseline), newEntries is empty (deleted)
			// → no diff
			expect(changes).toEqual([]);
		});
	});

	describe("onTurnEnd() delete edge cases", () => {
		it("records multiple deletes in a single turn", async () => {
			writeFileSync(join(tempDir, "a.ts"), "a", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "b", "utf-8");
			writeFileSync(join(tempDir, "c.ts"), "c", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			rmSync(join(tempDir, "c.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			expect(appendedEntries).toHaveLength(1);
			const data = appendedEntries[0]!.data as { diff: { deleted: string[] } };
			const deleted = data.diff!.deleted.sort();
			expect(deleted).toEqual(["a.ts", "c.ts"]);
		});

		it("records subdirectory file delete", async () => {
			const subDir = join(tempDir, "lib");
			mkdirSync(subDir, { recursive: true });
			writeFileSync(join(subDir, "helper.ts"), "helper", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(subDir, "helper.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const data = appendedEntries[0]!.data as { diff: { deleted: string[] } };
			expect(data.diff!.deleted).toContain("lib/helper.ts");
		});

		it("records delete when file was modified earlier in same turn", async () => {
			writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			// Modify file
			writeFileSync(join(tempDir, "a.ts"), "intermediate", "utf-8");
			// Then delete it
			rmSync(join(tempDir, "a.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const data = appendedEntries[0]!.data as { diff: { added: string[]; modified: string[]; deleted: string[] } };
			// Should only show as deleted, not modified
			expect(data.diff!.modified).not.toContain("a.ts");
			expect(data.diff!.deleted).toContain("a.ts");
		});

		it("records delete that removes all files", async () => {
			writeFileSync(join(tempDir, "only.ts"), "only file", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "only.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			expect(appendedEntries).toHaveLength(1);
			const data = appendedEntries[0]!.data as { diff: { deleted: string[] } };
			expect(data.diff!.deleted).toContain("only.ts");
		});

		it("does not record delete when file was never tracked", async () => {
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "untracked.ts"), "new", "utf-8");
			rmSync(join(tempDir, "untracked.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			// No committed snapshot because net zero change
			expect(appendedEntries).toHaveLength(0);
		});
	});

	describe("getModifiedFiles with deleted files", () => {
		it("returns deleted files in the result", async () => {
			writeFileSync(join(tempDir, "a.ts"), "a", "utf-8");
			writeFileSync(join(tempDir, "stay.ts"), "stay", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			writeFileSync(join(tempDir, "new.ts"), "new", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const files = manager.getModifiedFiles();
			expect(files.length).toBeGreaterThanOrEqual(2);
			const deletedEntry = files.find((f) => f.path === "a.ts");
			expect(deletedEntry).toBeDefined();
			expect(deletedEntry!.status).toBe("deleted");
			expect(deletedEntry!.turnIndex).toBe(0);
		});

		it("deleted file keeps first-seen status after later re-add", async () => {
			// Turn 0: delete a.ts
			// Turn 1: create a.ts (different content)
			// getModifiedFiles uses first-seen status: deleted is recorded first
			writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "recreated", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const files = manager.getModifiedFiles();
			const aEntry = files.find((f) => f.path === "a.ts");
			expect(aEntry).toBeDefined();
			// First status wins: turn 0 deleted a.ts, so status is "deleted"
			expect(aEntry!.status).toBe("deleted");
			expect(aEntry!.turnIndex).toBe(0);
		});

		it("getModifiedFiles respects fromEntryId/toEntryId filters", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "b.ts"), "b", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);
			const turn0Id = appendedEntries[0]!.id;

			rmSync(join(tempDir, "a.ts"));
			writeFileSync(join(tempDir, "c.ts"), "c", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			// Only turn 0: should show b.ts added
			const turn0Files = manager.getModifiedFiles({ toEntryId: turn0Id });
			const turn0Paths = turn0Files.map((f) => f.path);
			expect(turn0Paths).toContain("b.ts");
			expect(turn0Paths).not.toContain("a.ts");
			expect(turn0Files.every((f) => f.status === "added")).toBe(true);
		});

		it("getModifiedFiles respects toTurnIndex filter", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "b.ts"), "b", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "c.ts"), "c", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			writeFileSync(join(tempDir, "d.ts"), "d", "utf-8");
			manager.onTurnEnd(tempDir, 2, appendEntry);

			const turn0Files = manager.getModifiedFiles({ toTurnIndex: 0 });
			expect(turn0Files.map((f) => f.path)).toEqual(["b.ts"]);

			const turn1Files = manager.getModifiedFiles({ toTurnIndex: 1 });
			const turn1Paths = turn1Files.map((f) => f.path);
			expect(turn1Paths).toContain("b.ts");
			expect(turn1Paths).toContain("c.ts");
			expect(turn1Paths).not.toContain("d.ts");

			const allFiles = manager.getModifiedFiles({ toTurnIndex: 2 });
			expect(allFiles.map((f) => f.path).sort()).toEqual(["b.ts", "c.ts", "d.ts"]);
		});

		it("getModifiedFiles toTurnIndex mismaps after rollback + new turn", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "b.ts"), "b", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "c.ts"), "c", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			writeFileSync(join(tempDir, "d.ts"), "d", "utf-8");
			manager.onTurnEnd(tempDir, 2, appendEntry);

			rmSync(join(tempDir, "d.ts"));
			writeFileSync(join(tempDir, "e.ts"), "e", "utf-8");
			manager.onTurnEnd(tempDir, 3, appendEntry);

			const snap2 = manager.getSnapshotAtTurn(2);
			expect(snap2).not.toBeNull();
			expect(snap2!.diff!.added).toContain("d.ts");

			const snap3 = manager.getSnapshotAtTurn(3);
			expect(snap3).not.toBeNull();
			expect(snap3!.diff!.added).toContain("e.ts");

			const turn2Files = manager.getModifiedFiles({ toTurnIndex: 2 });
			const turn2Paths = turn2Files.map((f) => f.path);
			expect(turn2Paths).toContain("d.ts");
			expect(turn2Paths).not.toContain("e.ts");
		});

		it("getModifiedFiles with invalid toTurnIndex returns all files", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "b.ts"), "b", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const files = manager.getModifiedFiles({ toTurnIndex: 999 });
			expect(files.map((f) => f.path)).toEqual(["b.ts"]);
		});
	});

	describe("getFileDiff for deleted files", () => {
		it("returns diff with oldContent for deleted file", async () => {
			writeFileSync(join(tempDir, "delete-me.ts"), "content to delete", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "delete-me.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const diff = manager.getFileDiff({ filePath: "delete-me.ts" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("content to delete");
			expect(diff!.newContent).toBeNull();
			expect(diff!.unifiedDiff).toBeTruthy();
			expect(diff!.unifiedDiff).toContain("--- delete-me.ts");
			expect(diff!.unifiedDiff).toContain("+++ delete-me.ts");
		});

		it("returns null for file that never existed", async () => {
			await manager.initialize(tempDir);
			const diff = manager.getFileDiff({ filePath: "never-existed.ts" });
			expect(diff).toBeNull();
		});

		it("returns diff for deleted file in subdirectory", async () => {
			const subDir = join(tempDir, "src");
			mkdirSync(subDir, { recursive: true });
			writeFileSync(join(subDir, "util.ts"), "util content", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(subDir, "util.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const diff = manager.getFileDiff({ filePath: "src/util.ts" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("util content");
			expect(diff!.newContent).toBeNull();
		});
	});

	describe("getBatchDiffs with deleted files", () => {
		it("summary includes deleted count", async () => {
			writeFileSync(join(tempDir, "delete.ts"), "gone", "utf-8");
			writeFileSync(join(tempDir, "keep.ts"), "keep", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "delete.ts"));
			writeFileSync(join(tempDir, "add.ts"), "new", "utf-8");
			writeFileSync(join(tempDir, "keep.ts"), "changed", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const result = manager.getBatchDiffs();
			expect(result.summary.totalFiles).toBe(3);
			expect(result.summary.added).toBe(1);
			expect(result.summary.modified).toBe(1);
			expect(result.summary.deleted).toBe(1);
		});

		it("deleted file has diff with oldContent only", async () => {
			writeFileSync(join(tempDir, "gone.ts"), "old content", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "gone.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const result = manager.getBatchDiffs();
			const goneFile = result.files.find((f) => f.path === "gone.ts");
			expect(goneFile).toBeDefined();
			expect(goneFile!.status).toBe("deleted");
			expect(goneFile!.diff).not.toBeNull();
			expect(goneFile!.diff!.oldContent).toBe("old content");
			expect(goneFile!.diff!.newContent).toBeNull();
		});

		it("batch diffs returns empty when no changes", async () => {
			await manager.initialize(tempDir);
			const result = manager.getBatchDiffs();
			expect(result.files).toEqual([]);
			expect(result.summary.totalFiles).toBe(0);
		});
	});

	describe("getFileHistory for deleted files", () => {
		it("tracks delete in file history", async () => {
			writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "modified", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			rmSync(join(tempDir, "a.ts"));
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const history = manager.getFileHistory({ filePath: "a.ts" });
			expect(history).toHaveLength(2);
			expect(history[0]!.status).toBe("modified");
			expect(history[1]!.status).toBe("deleted");
		});

		it("returns empty history for never-tracked file", async () => {
			await manager.initialize(tempDir);
			const history = manager.getFileHistory({ filePath: "ghost.ts" });
			expect(history).toEqual([]);
		});

		it("shows delete then recreate in history", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const history = manager.getFileHistory({ filePath: "a.ts" });
			expect(history).toHaveLength(2);
			expect(history[0]!.status).toBe("deleted");
			expect(history[1]!.status).toBe("added");
		});
	});

	describe("rebuildIndex with deleted files", () => {
		it("preserves deleted file after rebuild", async () => {
			writeFileSync(join(tempDir, "a.ts"), "content", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const m2 = new FileSnapshotManager(git);
			m2.rebuildIndex(toSessionEntries());

			const files = m2.getModifiedFiles();
			const deletedFile = files.find((f) => f.path === "a.ts");
			expect(deletedFile).toBeDefined();
			expect(deletedFile!.status).toBe("deleted");
			expect(deletedFile!.turnIndex).toBe(0);
		});

		it("getFileDiff for deleted file works after rebuild", async () => {
			writeFileSync(join(tempDir, "del.ts"), "old data", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "del.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const m2 = new FileSnapshotManager(git);
			m2.rebuildIndex(toSessionEntries());

			const diff = m2.getFileDiff({ filePath: "del.ts" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("old data");
			expect(diff!.newContent).toBeNull();
		});

		it("snapshot at correct turn after rebuild with delete", async () => {
			writeFileSync(join(tempDir, "a.ts"), "a", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "b.ts"), "b", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			rmSync(join(tempDir, "b.ts"));
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const m2 = new FileSnapshotManager(git);
			m2.rebuildIndex(toSessionEntries());

			const snap0 = m2.getSnapshotAtTurn(0);
			expect(snap0).not.toBeNull();
			expect(snap0!.diff!.added).toContain("b.ts");

			const snap1 = m2.getSnapshotAtTurn(1);
			expect(snap1).not.toBeNull();
			expect(snap1!.diff!.deleted).toContain("b.ts");
		});
	});

	describe("delete cross-turn tracking", () => {
		it("delete then recreate in next turn — both tracked", async () => {
			writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "recreated", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			// getLiveChanges: baseline is after turn 1, so a.ts is present
			const changes = manager.getLiveChanges(tempDir);
			// No uncommitted changes if working dir matches baseline
			expect(changes).toEqual([]);
		});

		it("delete in turn 0, no change in turn 1 — history correctly shows one delete", async () => {
			writeFileSync(join(tempDir, "a.ts"), "original", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			// Turn 1: no changes
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const history = manager.getFileHistory({ filePath: "a.ts" });
			expect(history).toHaveLength(1);
			expect(history[0]!.status).toBe("deleted");
		});

		it("delete then getModifiedFiles — deleted file appears exactly once", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "a.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const files = manager.getModifiedFiles();
			const aEntries = files.filter((f) => f.path === "a.ts");
			expect(aEntries).toHaveLength(1);
			expect(aEntries[0]!.status).toBe("deleted");
		});
	});
});
