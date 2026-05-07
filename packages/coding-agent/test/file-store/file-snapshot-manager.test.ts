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
});
