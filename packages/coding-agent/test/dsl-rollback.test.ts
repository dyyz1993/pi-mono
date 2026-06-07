/**
 * Comprehensive rollback / file-snapshot system tests using the DSL.
 *
 * Coverage:
 *   1. FileSnapshotManager lifecycle (initialize, onTurnEnd, rebuildIndex)
 *   2. Snapshot operations (getModifiedFiles, getFileDiff, getBatchDiffs, getFileHistory)
 *   3. Live changes detection (getLiveChanges)
 *   4. Rollback operations (restoreFiles, preview, dirty files, unrevert)
 *   5. GC operations (gc, prune, enforceLimit, getActiveTreeHashes)
 *   6. Edge cases (1MB limit, empty dir, idempotency, path resolution)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

// ─── Helpers ──────────────────────────────────────────────────

function createStore(): { git: InternalGit; dir: string } {
	const dir = join(tmpdir(), `pi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	const storeRoot = join(dir, "store");
	const git = InternalGit.createForProject(storeRoot, dir);
	return { git, dir };
}

function cleanupStore(dir: string): void {
	if (existsSync(dir)) rmSync(dir, { recursive: true });
}

function writeFile(dir: string, path: string, content: string): void {
	const full = join(dir, path);
	const parent = full.substring(0, full.lastIndexOf("/"));
	if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
	writeFileSync(full, content);
}

function makeAppendEntry(entries: SessionEntry[]): (type: string, data: unknown) => string {
	let counter = 0;
	return (type: string, data: unknown) => {
		const id = `entry-${counter++}`;
		entries.push({
			id,
			parentId: entries.at(-1)?.id ?? null,
			type: "custom",
			customType: type,
			data,
			timestamp: new Date().toISOString(),
		} as unknown as SessionEntry);
		return id;
	};
}

// ─── Tests ────────────────────────────────────────────────────

describe("FileSnapshotManager", () => {
	let git: InternalGit;
	let dir: string;
	let mgr: FileSnapshotManager;
	let entries: SessionEntry[];
	let appendEntry: (type: string, data: unknown) => string;

	beforeEach(() => {
		const store = createStore();
		git = store.git;
		dir = store.dir;
		mgr = new FileSnapshotManager(git);
		entries = [];
		appendEntry = makeAppendEntry(entries);
	});

	afterEach(() => {
		cleanupStore(dir);
	});

	// ── 1. Lifecycle ──────────────────────────────────────

	describe("initialize()", () => {
		it("records session-start baseline from working dir", () => {
			writeFile(dir, "a.txt", "hello");
			writeFile(dir, "b.txt", "world");
			mgr.initialize(dir);

			const changes = mgr.getLiveChanges(dir);
			expect(changes).toHaveLength(0);
		});

		it("sets null baseline for empty dir", () => {
			mgr.initialize(dir);
			const changes = mgr.getLiveChanges(dir);
			expect(changes).toHaveLength(0);
		});

		it("is idempotent — second call is no-op", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			writeFile(dir, "b.txt", "world");

			// Second initialize should be no-op
			mgr.initialize(dir);

			// b.txt should show as a live change relative to original baseline
			const changes = mgr.getLiveChanges(dir);
			expect(changes).toHaveLength(1);
			expect(changes[0].path).toBe("b.txt");
			expect(changes[0].status).toBe("added");
		});
	});

	describe("onTurnEnd()", () => {
		it("writes snapshot entry when files change", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			expect(entries).toHaveLength(1);
			expect((entries[0] as { customType?: string }).customType).toBe("step-snapshot");
		});

		it("skips entry when nothing changed", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			mgr.onTurnEnd(dir, 0, appendEntry);

			expect(entries).toHaveLength(0);
		});

		it("updates lastCommittedTreeHash after snapshot", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			writeFile(dir, "b.txt", "new");

			mgr.onTurnEnd(dir, 0, appendEntry);

			// After snapshot, no live changes expected
			const changes = mgr.getLiveChanges(dir);
			expect(changes).toHaveLength(0);
		});

		it("handles multiple turns with incremental diffs", () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "v1");
			mgr.onTurnEnd(dir, 0, appendEntry);

			writeFile(dir, "a.txt", "v2");
			mgr.onTurnEnd(dir, 1, appendEntry);

			expect(entries).toHaveLength(2);
			expect(mgr.getModifiedFiles()).toHaveLength(2); // a.txt + b.txt
		});
	});

	describe("rebuildIndex()", () => {
		it("rebuilds from persisted session entries", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			const newMgr = new FileSnapshotManager(git);
			newMgr.rebuildIndex(entries, null);
			newMgr.initialize(dir);

			const modified = newMgr.getModifiedFiles();
			expect(modified).toHaveLength(1);
			expect(modified[0].path).toBe("b.txt");
		});

		it("respects leaf path — only loads entries on parent-chain", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			// Simulate forking: create a branch
			const branchEntries = [...entries];
			const branchAppend = makeAppendEntry(branchEntries);
			writeFile(dir, "c.txt", "branch");
			const newMgr = new FileSnapshotManager(git);
			newMgr.rebuildIndex(branchEntries, branchEntries.at(-1)?.id ?? null);
			newMgr.initialize(dir);

			const modified = newMgr.getModifiedFiles();
			expect(modified.some((f) => f.path === "b.txt")).toBe(true);
		});

		it("clears existing state before rebuild", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			expect(mgr.getModifiedFiles()).toHaveLength(1);

			mgr.rebuildIndex([], null);

			expect(mgr.getModifiedFiles()).toHaveLength(0);
		});
	});

	// ── 2. Snapshot Operations ────────────────────────────

	describe("getModifiedFiles()", () => {
		it("returns all modified files across all snapshots", () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			writeFile(dir, "a.txt", "v2");
			mgr.onTurnEnd(dir, 1, appendEntry);

			const files = mgr.getModifiedFiles();
			expect(files).toHaveLength(2);
			expect(files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
		});

		it("returns empty when no snapshots exist", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			expect(mgr.getModifiedFiles()).toHaveLength(0);
		});

		it("supports range queries via fromEntryId/toEntryId", () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);
			const firstEntryId = entries.at(-1)!.id;

			writeFile(dir, "c.txt", "new");
			mgr.onTurnEnd(dir, 1, appendEntry);
			const secondEntryId = entries.at(-1)!.id;

			const range = mgr.getModifiedFiles({ fromEntryId: firstEntryId, toEntryId: secondEntryId });
			expect(range.map((f) => f.path)).toContain("c.txt");
		});

		it("first-occurrence wins — added file stays added even if later modified", () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "x.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			writeFile(dir, "x.txt", "modified");
			mgr.onTurnEnd(dir, 1, appendEntry);

			const files = mgr.getModifiedFiles();
			const xFile = files.find((f) => f.path === "x.txt");
			expect(xFile?.status).toBe("added");
		});
	});

	describe("getFileDiff()", () => {
		it("returns diff for modified file", () => {
			writeFile(dir, "a.txt", "line1\nline2\n");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "line1\nline2-changed\n");
			mgr.onTurnEnd(dir, 0, appendEntry);

			const diff = mgr.getFileDiff({ filePath: "a.txt" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toContain("line2");
			expect(diff!.newContent).toContain("line2-changed");
			expect(diff!.unifiedDiff).toContain("+++");
			expect(diff!.unifiedDiff).toContain("---");
		});

		it("returns diff for added file with null oldContent", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "new file");
			mgr.onTurnEnd(dir, 0, appendEntry);

			const diff = mgr.getFileDiff({ filePath: "b.txt" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBeNull();
			expect(diff!.newContent).toBe("new file");
		});

		it("returns null for nonexistent file", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			mgr.onTurnEnd(dir, 0, appendEntry);

			const diff = mgr.getFileDiff({ filePath: "nope.txt" });
			expect(diff).toBeNull();
		});
	});

	describe("getBatchDiffs()", () => {
		it("returns diffs for all modified files with summary", () => {
			writeFile(dir, "a.txt", "v1");
			writeFile(dir, "b.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "v2");
			writeFile(dir, "c.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			const result = mgr.getBatchDiffs();
			expect(result.summary.added).toBe(1);
			expect(result.summary.modified).toBe(1);
			expect(result.summary.totalFiles).toBe(2);
			expect(result.files).toHaveLength(2);
		});

		it("returns empty result when no changes", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			mgr.onTurnEnd(dir, 0, appendEntry);

			const result = mgr.getBatchDiffs();
			expect(result.summary.totalFiles).toBe(0);
			expect(result.files).toHaveLength(0);
		});
	});

	describe("getFileHistory()", () => {
		it("returns change history for a file across snapshots", () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "v2");
			mgr.onTurnEnd(dir, 0, appendEntry);

			writeFile(dir, "a.txt", "v3");
			mgr.onTurnEnd(dir, 1, appendEntry);

			const history = mgr.getFileHistory({ filePath: "a.txt" });
			expect(history).toHaveLength(2);
			expect(history[0].status).toBe("modified");
			expect(history[1].status).toBe("modified");
		});

		it("returns empty array for never-changed file", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			mgr.onTurnEnd(dir, 0, appendEntry);

			const history = mgr.getFileHistory({ filePath: "a.txt" });
			expect(history).toHaveLength(0);
		});
	});

	// ── 3. Live Changes ───────────────────────────────────

	describe("getLiveChanges()", () => {
		it("detects added files", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "new");
			const changes = mgr.getLiveChanges(dir);

			expect(changes).toHaveLength(1);
			expect(changes[0].status).toBe("added");
			expect(changes[0].path).toBe("b.txt");
		});

		it("detects modified files", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "changed");
			const changes = mgr.getLiveChanges(dir);

			expect(changes).toHaveLength(1);
			expect(changes[0].status).toBe("modified");
		});

		it("detects deleted files", () => {
			writeFile(dir, "a.txt", "hello");
			writeFile(dir, "b.txt", "world");
			mgr.initialize(dir);

			unlinkSync(join(dir, "b.txt"));
			const changes = mgr.getLiveChanges(dir);

			expect(changes).toHaveLength(1);
			expect(changes[0].status).toBe("deleted");
			expect(changes[0].path).toBe("b.txt");
		});

		it("detects mixed changes", () => {
			writeFile(dir, "a.txt", "hello");
			writeFile(dir, "b.txt", "world");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "changed");
			writeFile(dir, "c.txt", "new");
			unlinkSync(join(dir, "b.txt"));
			const changes = mgr.getLiveChanges(dir);

			expect(changes).toHaveLength(3);
			const statuses = changes.map((c) => `${c.path}:${c.status}`).sort();
			expect(statuses).toEqual(["a.txt:modified", "b.txt:deleted", "c.txt:added"]);
		});

		it("uses lastCommittedTreeHash when available", () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			writeFile(dir, "c.txt", "another");
			const changes = mgr.getLiveChanges(dir);

			expect(changes).toHaveLength(1);
			expect(changes[0].path).toBe("c.txt");
		});
	});

	// ── 4. Rollback Operations ────────────────────────────

	describe("restoreFiles()", () => {
		it("restores files to a previous snapshot state", async () => {
			writeFile(dir, "a.txt", "v1");
			writeFile(dir, "b.txt", "v1");
			mgr.initialize(dir);

			// First turn: a.txt → v2, c.txt added
			writeFile(dir, "a.txt", "v2");
			writeFile(dir, "c.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);
			const snapshotId = entries.at(-1)!.id;

			// Second turn: a.txt → v3, d.txt added
			writeFile(dir, "a.txt", "v3");
			writeFile(dir, "d.txt", "after");
			mgr.onTurnEnd(dir, 1, appendEntry);

			// Roll back to first snapshot
			const result = await mgr.restoreFiles(dir, {
				targetEntryId: snapshotId,
				entries,
			});

			expect(result.restored).toContain("a.txt");
			expect(result.deleted).toContain("d.txt");
			expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("v2"); // restored to snapshot (which has v2)
		});

		it("rolls back to session start when targetEntryId is null", async () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			const result = await mgr.restoreFiles(dir, {
				targetEntryId: undefined as unknown as string,
				entries,
				currentLeafId: null,
			});

			// Should roll back to before the snapshot
			expect(result.deleted).toContain("b.txt");
		});

		it("preview mode returns what would happen without writing", async () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			// First turn: a.txt → v2, b.txt added
			writeFile(dir, "a.txt", "v2");
			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);
			const snapshotId = entries.at(-1)!.id;

			// Second turn: c.txt added
			writeFile(dir, "c.txt", "after-snapshot");
			mgr.onTurnEnd(dir, 1, appendEntry);

			const preview = await mgr.restoreFiles(dir, {
				targetEntryId: snapshotId,
				entries,
				preview: true,
			});

			expect(preview.deleted).toContain("c.txt");
			// File should still exist on disk
			expect(existsSync(join(dir, "c.txt"))).toBe(true);
		});

		it("detects dirty files modified outside the snapshot system", async () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "v2");
			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);
			const snapshotId = entries.at(-1)!.id;

			// Manually edit on disk (dirty) — changes since last snapshot
			writeFile(dir, "a.txt", "dirty-edit");

			// Roll back to session start (no targetEntryId) so there's a real diff
			const result = await mgr.restoreFiles(dir, {
				entries,
			});

			expect(result.dirty).toContain("a.txt");
			expect(result.forceRestored).toContain("a.txt");
		});

		it("writes unrevert-point entry with preRollbackTreeHash", async () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			// First turn: a.txt → v2
			writeFile(dir, "a.txt", "v2");
			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);
			const snapshotId = entries.at(-1)!.id;

			// Second turn: c.txt added
			writeFile(dir, "c.txt", "after-snapshot");
			mgr.onTurnEnd(dir, 1, appendEntry);

			const unrevertEntries: SessionEntry[] = [];
			const unrevertAppend = makeAppendEntry(unrevertEntries);

			await mgr.restoreFiles(dir, {
				targetEntryId: snapshotId,
				entries,
				appendEntry: unrevertAppend,
			});

			expect(unrevertEntries).toHaveLength(1);
			expect((unrevertEntries[0] as { customType?: string }).customType).toBe("unrevert-point");
		});

		it("snapshotHash takes priority over targetEntryId", async () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			// Create a tree hash manually
			const tree = git.writeTree(new Map([["a.txt", "original"]]));
			const hash = tree.treeHash;

			writeFile(dir, "a.txt", "changed");
			mgr.onTurnEnd(dir, 0, appendEntry);

			const result = await mgr.restoreFiles(dir, {
				snapshotHash: hash,
				entries,
			});

			expect(result.restored).toContain("a.txt");
			expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("original");
		});

		it("restores specific files only when files option provided", async () => {
			writeFile(dir, "a.txt", "v1");
			writeFile(dir, "b.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "v2");
			writeFile(dir, "b.txt", "v2");
			mgr.onTurnEnd(dir, 0, appendEntry);
			const snapshotId = entries.at(-1)!.id;

			await mgr.restoreFiles(dir, {
				targetEntryId: snapshotId,
				entries,
				files: ["a.txt"],
			});

			// a.txt should be unchanged (already at snapshot state)
			// b.txt should NOT be restored — still has v2
			expect(readFileSync(join(dir, "b.txt"), "utf-8")).toBe("v2");
		});

		it("returns empty when target equals current", async () => {
			writeFile(dir, "a.txt", "hello");
			mgr.initialize(dir);
			writeFile(dir, "a.txt", "changed");
			mgr.onTurnEnd(dir, 0, appendEntry);
			const snapshotId = entries.at(-1)!.id;

			// Roll back to the latest snapshot (same as current)
			const result = await mgr.restoreFiles(dir, {
				targetEntryId: snapshotId,
				entries,
			});

			expect(result.restored).toHaveLength(0);
			expect(result.deleted).toHaveLength(0);
		});
	});

	describe("getRollbackPreviewFiles()", () => {
		it("returns files that would change on rollback", () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "v2");
			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);
			const snapshotId = entries.at(-1)!.id;

			const preview = mgr.getRollbackPreviewFiles({
				targetEntryId: snapshotId,
				entries,
			});

			// Rolling to snapshotId means b.txt (added after) would be deleted
			// But snapshotId IS the snapshot with b.txt, so preview should be empty (target = current)
			// Need to create an earlier target
			writeFile(dir, "c.txt", "newer");
			mgr.onTurnEnd(dir, 1, appendEntry);
			const laterId = entries.at(-1)!.id;

			const preview2 = mgr.getRollbackPreviewFiles({
				targetEntryId: snapshotId,
				entries,
			});

			expect(preview2.length).toBeGreaterThan(0);
			expect(preview2.some((f) => f.path === "c.txt")).toBe(true);
		});
	});

	// ── 5. GC Operations ──────────────────────────────────

	describe("getActiveTreeHashes()", () => {
		it("includes sessionStartTreeHash and all snapshot hashes", () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "a.txt", "v2");
			mgr.onTurnEnd(dir, 0, appendEntry);

			const hashes = mgr.getActiveTreeHashes();
			expect(hashes.size).toBeGreaterThanOrEqual(2); // session start + at least one snapshot
		});

		it("includes baselineTreeHash for each snapshot", () => {
			writeFile(dir, "a.txt", "v1");
			mgr.initialize(dir);

			writeFile(dir, "b.txt", "new");
			mgr.onTurnEnd(dir, 0, appendEntry);

			writeFile(dir, "c.txt", "new");
			mgr.onTurnEnd(dir, 1, appendEntry);

			const hashes = mgr.getActiveTreeHashes();
			// session start + 2 snapshot hashes + 2 baseline hashes (some may overlap)
			expect(hashes.size).toBeGreaterThanOrEqual(2);
		});
	});

	describe("InternalGit GC", () => {
		it("gc deletes orphaned blobs not referenced by any tree", async () => {
			// GC protects ALL trees + their referenced blobs; only orphaned blobs are deleted
			const tree1 = git.writeTree(new Map([["a.txt", "content-a"]]));
			const tree2 = git.writeTree(new Map([["a.txt", "content-b"]]));

			// Orphaned blob: written directly, not part of any tree
			const orphanHash = git.writeObject("standalone-orphan");

			const beforeObjects = git.scanAllObjects();
			expect(beforeObjects.length).toBeGreaterThan(0);
			expect(git.hasObject(orphanHash)).toBe(true);

			// GC with tree1 as active — but ALL trees are protected by gc()
			const result = await git.gc(new Set([tree1.treeHash]));
			expect(result.deletedObjects).toBeGreaterThan(0);

			// Orphaned blob deleted (not referenced by any tree)
			expect(git.hasObject(orphanHash)).toBe(false);

			// Both trees survive (GC protects all trees, not just active ones)
			expect(git.hasObject(tree1.treeHash)).toBe(true);
			expect(git.hasObject(tree2.treeHash)).toBe(true);
		});

		it("getStoreSize returns total bytes", () => {
			git.writeTree(new Map([["a.txt", "some content"]]));
			const size = git.getStoreSize();
			expect(size).toBeGreaterThan(0);
		});

		it("getStats returns object counts", () => {
			git.writeObject("file content");
			git.writeTree(new Map([["a.txt", "tree content"]]));
			const stats = git.getStats();
			expect(stats.totalObjects).toBeGreaterThan(0);
			expect(stats.fileObjects).toBeGreaterThan(0);
			expect(stats.treeObjects).toBeGreaterThan(0);
		});
	});

	// ── 6. Edge Cases ─────────────────────────────────────

	describe("Edge cases", () => {
		it("filters files larger than 1MB from snapshots", () => {
			writeFile(dir, "big.txt", "x".repeat(1024 * 1024 + 100));
			mgr.initialize(dir);

			// Big file should not appear in live changes as "added"
			writeFile(dir, "big.txt", "y".repeat(1024 * 1024 + 200));
			const changes = mgr.getLiveChanges(dir);
			// Either empty (if both versions filtered) or at most showing small files
			expect(changes.every((c) => c.path !== "big.txt")).toBe(true);
		});

		it("getLatestSnapshotOnPath returns null for no snapshots", () => {
			const result = mgr.getLatestSnapshotOnPath([], null);
			expect(result).toBeNull();
		});

		it("resolveSnapshotEntryIdForTarget returns null for unknown target", () => {
			const result = mgr.resolveSnapshotEntryIdForTarget("nonexistent", []);
			expect(result).toBeNull();
		});

		it("getSnapshotAtEntry returns null for unknown entry", () => {
			const result = mgr.getSnapshotAtEntry("nonexistent");
			expect(result).toBeNull();
		});

		it("getBatchFileContents returns empty map for no paths", () => {
			const result = mgr.getBatchFileContents([]);
			expect(result.size).toBe(0);
		});
	});
});
