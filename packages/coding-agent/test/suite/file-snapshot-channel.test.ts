import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../../src/core/file-store/internal-git.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";

function createTempDir(): string {
	const dir = join(tmpdir(), `fsm-channel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function readFile(path: string): string {
	return readFileSync(path, "utf-8");
}

describe("file-snapshot channel methods", () => {
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
		appendedEntries.push({
			type: "custom",
			id,
			parentId: appendedEntries.length > 0 ? appendedEntries[appendedEntries.length - 1]!.id : null,
			timestamp: new Date().toISOString(),
			customType: type,
			data,
		});
		return id;
	};

	const toSessionEntries = (): SessionEntry[] => {
		return appendedEntries as unknown as SessionEntry[];
	};

	describe("snapshot.list (getModifiedFiles)", () => {
		it("returns all modified files across session", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "new", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const files = manager.getModifiedFiles({});

			const aFile = files.find((f) => f.path === "a.ts");
			expect(aFile).toBeDefined();
			expect(aFile!.status).toBe("modified");

			const bFile = files.find((f) => f.path === "b.ts");
			expect(bFile).toBeDefined();
			expect(bFile!.status).toBe("added");
		});

		it("returns empty when no file changes", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const files = manager.getModifiedFiles({});
			expect(files).toHaveLength(0);
		});

		it("scopes results with fromEntryId/toEntryId", async () => {
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "a1", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);
			const turn0EntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "b.ts"), "b1", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);
			const turn1EntryId = appendedEntries[1]!.id;

			writeFileSync(join(tempDir, "c.ts"), "c1", "utf-8");
			manager.onTurnEnd(tempDir, 2, appendEntry);

			// Range is [fromIdx, toIdx] — closed interval on both ends
			const files = manager.getModifiedFiles({
				fromEntryId: turn0EntryId,
				toEntryId: turn1EntryId,
			});

			const paths = files.map((f) => f.path);
			expect(paths).toContain("a.ts");
			expect(paths).toContain("b.ts");
			expect(paths).not.toContain("c.ts");
		});

		it("tracks deleted files", async () => {
			writeFileSync(join(tempDir, "doomed.ts"), "will be deleted", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "doomed.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const files = manager.getModifiedFiles({});
			const deletedFile = files.find((f) => f.path === "doomed.ts");
			expect(deletedFile).toBeDefined();
			expect(deletedFile!.status).toBe("deleted");
		});
	});

	describe("snapshot.get (getSnapshotAtEntry)", () => {
		it("returns snapshot details for specific entry", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const entryId = appendedEntries[0]!.id;
			const snap = manager.getSnapshotAtEntry(entryId);

			expect(snap).not.toBeNull();
			expect(snap!.snapshotTreeHash).toBeDefined();
			expect(snap!.diff).not.toBeNull();
			expect(snap!.diff!.modified).toContain("a.ts");
			expect(snap!.turnIndex).toBe(0);
		});

		it("returns null for non-existent entry", () => {
			const snap = manager.getSnapshotAtEntry("nonexistent");
			expect(snap).toBeNull();
		});

		it("returns baselineTreeHash for first snapshot", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const entryId = appendedEntries[0]!.id;
			const snap = manager.getSnapshotAtEntry(entryId);

			expect(snap).not.toBeNull();
			expect(snap!.baselineTreeHash).not.toBeNull();
		});
	});

	describe("snapshot.rollback (restoreFiles with targetEntryId)", () => {
		it("restores files to specific snapshot", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);
			const turn0EntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			await manager.restoreFiles(tempDir, {
				targetEntryId: turn0EntryId,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(readFile(join(tempDir, "a.ts"))).toBe("v2");
		});

		it("creates unrevert-point entry after rollback", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);
			const turn0EntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const entriesBefore = appendedEntries.length;

			await manager.restoreFiles(tempDir, {
				targetEntryId: turn0EntryId,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(appendedEntries.length).toBe(entriesBefore + 1);
			const unrevert = appendedEntries[appendedEntries.length - 1]!;
			expect(unrevert.customType).toBe("unrevert-point");
			const data = unrevert.data as { restoredFiles: string[]; preRollbackTreeHash: string | null };
			expect(data.restoredFiles).toContain("a.ts");
			expect(data.preRollbackTreeHash).not.toBeNull();
		});

		it("restores to session start when no targetEntryId", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "new", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const result = await manager.restoreFiles(tempDir, {
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(result.restored).toContain("a.ts");
			expect(result.deleted).toContain("b.ts");
			expect(readFile(join(tempDir, "a.ts"))).toBe("v1");
			expect(existsSync(join(tempDir, "b.ts"))).toBe(false);
		});

		it("with files filter only restores specified files", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);
			const turn0EntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			await manager.restoreFiles(tempDir, {
				targetEntryId: turn0EntryId,
				entries: toSessionEntries(),
				appendEntry,
				files: ["a.ts"],
			});

			expect(readFile(join(tempDir, "a.ts"))).toBe("v2");
			expect(readFile(join(tempDir, "b.ts"))).toBe("v3");
		});

		it("detects dirty files before restore", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const turn0EntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "a.ts"), "externally-modified", "utf-8");

			const result = await manager.restoreFiles(tempDir, {
				targetEntryId: turn0EntryId,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(result.dirty).toContain("a.ts");
		});
	});

	describe("snapshot.unrevert (forward restore via unrevert-point)", () => {
		it("reads unrevert-point and restores forward", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			await manager.restoreFiles(tempDir, {
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(readFile(join(tempDir, "a.ts"))).toBe("v1");

			const unrevertPoints = appendedEntries.filter((e) => e.customType === "unrevert-point");
			expect(unrevertPoints.length).toBe(1);
			const unrevertData = unrevertPoints[0]!.data as { preRollbackTreeHash: string | null };
			expect(unrevertData.preRollbackTreeHash).not.toBeNull();

			await manager.restoreFiles(tempDir, {
				snapshotHash: unrevertData.preRollbackTreeHash!,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(readFile(join(tempDir, "a.ts"))).toBe("v2");
		});

		it("returns empty result when no unrevert-point found (no rollback happened)", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const unrevertPoints = appendedEntries.filter((e) => e.customType === "unrevert-point");
			expect(unrevertPoints.length).toBe(0);
		});

		it("unrevert after rollback to non-root entry restores to pre-rollback", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);
			const turn0EntryId = appendedEntries[0]!.id;

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			await manager.restoreFiles(tempDir, {
				targetEntryId: turn0EntryId,
				entries: toSessionEntries(),
				appendEntry,
			});
			expect(readFile(join(tempDir, "a.ts"))).toBe("v2");

			const unrevertPoints = appendedEntries.filter((e) => e.customType === "unrevert-point");
			expect(unrevertPoints.length).toBe(1);
			const unrevertData = unrevertPoints[0]!.data as {
				preRollbackTreeHash: string | null;
				rolledBackToLeaf: string;
			};
			expect(unrevertData.rolledBackToLeaf).toBe(turn0EntryId);

			await manager.restoreFiles(tempDir, {
				snapshotHash: unrevertData.preRollbackTreeHash!,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(readFile(join(tempDir, "a.ts"))).toBe("v3");
		});
	});

	describe("snapshot.restoreByHash (restoreFiles with snapshotHash)", () => {
		it("restores to arbitrary tree hash", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const turn0Snap = manager.getSnapshotAtEntry(appendedEntries[0]!.id);
			expect(turn0Snap).not.toBeNull();

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			await manager.restoreFiles(tempDir, {
				snapshotHash: turn0Snap!.snapshotTreeHash,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(readFile(join(tempDir, "a.ts"))).toBe("v2");
		});

		it("restores to a hash from a manually created tree", async () => {
			writeFileSync(join(tempDir, "a.ts"), "manual-snap", "utf-8");
			const snapFiles = git.scanWorkingDir(tempDir);
			const { treeHash: manualHash } = git.writeTree(snapFiles);

			writeFileSync(join(tempDir, "b.ts"), "extra", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "changed", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			await manager.restoreFiles(tempDir, {
				snapshotHash: manualHash,
				entries: toSessionEntries(),
				appendEntry,
			});

			expect(readFile(join(tempDir, "a.ts"))).toBe("manual-snap");
		});
	});

	describe("snapshot.stats (getActiveTreeHashes)", () => {
		it("returns active tree hashes including session start and snapshots", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			const hashes = manager.getActiveTreeHashes();
			expect(hashes.size).toBeGreaterThanOrEqual(3);

			const snap0 = manager.getSnapshotAtEntry(appendedEntries[0]!.id);
			const snap1 = manager.getSnapshotAtEntry(appendedEntries[1]!.id);
			expect(hashes.has(snap0!.snapshotTreeHash)).toBe(true);
			expect(hashes.has(snap1!.snapshotTreeHash)).toBe(true);
			expect(hashes.has(snap0!.baselineTreeHash!)).toBe(true);
		});

		it("returns only session start hash when no turns recorded", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			const hashes = manager.getActiveTreeHashes();
			expect(hashes.size).toBe(1);
		});

		it("returns empty set when initialized with empty dir", async () => {
			await manager.initialize(tempDir);

			const hashes = manager.getActiveTreeHashes();
			expect(hashes.size).toBe(0);
		});
	});

	describe("get_file_diff (getFileDiff)", () => {
		it("returns diff between two entry points", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1\n", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2\n", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const entryId = appendedEntries[0]!.id;
			const diff = manager.getFileDiff({
				filePath: "a.ts",
				fromEntryId: undefined,
				toEntryId: entryId,
			});

			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("v1\n");
			expect(diff!.newContent).toBe("v2\n");
			expect(diff!.unifiedDiff).toContain("-v1");
			expect(diff!.unifiedDiff).toContain("+v2");
		});

		it("returns null for file not in snapshots", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const diff = manager.getFileDiff({
				filePath: "nonexistent.ts",
				fromEntryId: undefined,
				toEntryId: appendedEntries[0]!.id,
			});

			expect(diff).toBeNull();
		});
	});

	describe("get_batch_diffs (getBatchDiffs)", () => {
		it("returns batch diffs with summary", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			writeFileSync(join(tempDir, "b.ts"), "new", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const result = manager.getBatchDiffs({});

			expect(result.files.length).toBeGreaterThanOrEqual(2);
			expect(result.summary.totalFiles).toBeGreaterThanOrEqual(2);
			expect(result.summary.modified).toBeGreaterThanOrEqual(1);
			expect(result.summary.added).toBeGreaterThanOrEqual(1);

			const aFile = result.files.find((f) => f.path === "a.ts");
			expect(aFile).toBeDefined();
			expect(aFile!.diff).not.toBeNull();
			expect(aFile!.diff!.newContent).toBe("v2");

			const bFile = result.files.find((f) => f.path === "b.ts");
			expect(bFile).toBeDefined();
			expect(bFile!.diff).not.toBeNull();
			expect(bFile!.diff!.oldContent).toBeNull();
		});

		it("returns empty result when no changes", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const result = manager.getBatchDiffs({});
			expect(result.summary.totalFiles).toBe(0);
			expect(result.files).toHaveLength(0);
		});
	});

	describe("get_file_history (getFileHistory)", () => {
		it("returns history of changes for a specific file", async () => {
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);

			writeFileSync(join(tempDir, "a.ts"), "v3", "utf-8");
			manager.onTurnEnd(tempDir, 2, appendEntry);

			const history = manager.getFileHistory({ filePath: "a.ts" });

			expect(history).toHaveLength(3);
			expect(history[0]!.status).toBe("added");
			expect(history[0]!.turnIndex).toBe(0);
			expect(history[1]!.status).toBe("modified");
			expect(history[1]!.turnIndex).toBe(1);
			expect(history[2]!.status).toBe("modified");
			expect(history[2]!.turnIndex).toBe(2);
		});

		it("returns empty for file with no history", async () => {
			writeFileSync(join(tempDir, "a.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			writeFileSync(join(tempDir, "a.ts"), "v2", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const history = manager.getFileHistory({ filePath: "never-existed.ts" });
			expect(history).toHaveLength(0);
		});

		it("tracks deletion in history", async () => {
			writeFileSync(join(tempDir, "doomed.ts"), "v1", "utf-8");
			await manager.initialize(tempDir);

			rmSync(join(tempDir, "doomed.ts"));
			manager.onTurnEnd(tempDir, 0, appendEntry);

			const history = manager.getFileHistory({ filePath: "doomed.ts" });
			expect(history).toHaveLength(1);
			expect(history[0]!.status).toBe("deleted");
		});
	});
});
