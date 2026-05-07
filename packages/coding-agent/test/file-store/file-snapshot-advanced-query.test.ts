import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	BatchDiffResult,
	FileHistoryEntry,
	FileSnapshotManager,
} from "../../src/core/file-store/file-snapshot-manager.js";
import { InternalGit } from "../../src/core/file-store/internal-git.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-advanced-query-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("FileSnapshotManager advanced queries", () => {
	let tempDir: string;
	let workDir: string;
	let storeDir: string;
	let git: InternalGit;
	let mgr: FileSnapshotManager;

	beforeEach(() => {
		tempDir = createTempDir();
		workDir = join(tempDir, "workspace");
		storeDir = join(tempDir, "store");
		mkdirSync(workDir, { recursive: true });
		git = new InternalGit(storeDir);
		mgr = new FileSnapshotManager(git);
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function appendEntry(_type: string, _data: unknown): string {
		const id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		return id;
	}

	describe("getBatchDiffs", () => {
		it("returns diffs for all modified files", async () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			await mgr.initialize(workDir);

			writeFileSync(join(workDir, "foo.ts"), "v2", "utf-8");
			writeFileSync(join(workDir, "bar.ts"), "new", "utf-8");
			mgr.onTurnEnd(workDir, 0, appendEntry);

			const result = mgr.getBatchDiffs();

			expect(result.files).toHaveLength(2);
			expect(result.files.find((f) => f.path === "foo.ts")?.status).toBe("modified");
			expect(result.files.find((f) => f.path === "bar.ts")?.status).toBe("added");

			const fooFile = result.files.find((f) => f.path === "foo.ts")!;
			expect(fooFile.diff).not.toBeNull();
			expect(fooFile.diff!.oldContent).toBe("v1");
			expect(fooFile.diff!.newContent).toBe("v2");

			const barFile = result.files.find((f) => f.path === "bar.ts")!;
			expect(barFile.diff).not.toBeNull();
			expect(barFile.diff!.oldContent).toBeNull();
			expect(barFile.diff!.newContent).toBe("new");
		});

		it("returns summary with counts", async () => {
			writeFileSync(join(workDir, "existing.ts"), "original", "utf-8");
			await mgr.initialize(workDir);

			writeFileSync(join(workDir, "new.ts"), "brand new", "utf-8");
			writeFileSync(join(workDir, "existing.ts"), "changed", "utf-8");
			mgr.onTurnEnd(workDir, 0, appendEntry);

			const result = mgr.getBatchDiffs();

			expect(result.summary.totalFiles).toBe(2);
			expect(result.summary.added).toBe(1);
			expect(result.summary.modified).toBe(1);
			expect(result.summary.deleted).toBe(0);
		});

		it("handles empty range (no changes)", async () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			await mgr.initialize(workDir);

			mgr.onTurnEnd(workDir, 0, appendEntry);

			const result = mgr.getBatchDiffs();

			expect(result.files).toHaveLength(0);
			expect(result.summary.totalFiles).toBe(0);
			expect(result.summary.added).toBe(0);
			expect(result.summary.modified).toBe(0);
			expect(result.summary.deleted).toBe(0);
		});

		it("handles added and deleted files", async () => {
			writeFileSync(join(workDir, "doomed.ts"), "will be deleted", "utf-8");
			await mgr.initialize(workDir);

			rmSync(join(workDir, "doomed.ts"));
			writeFileSync(join(workDir, "new.ts"), "brand new", "utf-8");
			mgr.onTurnEnd(workDir, 0, appendEntry);

			const result = mgr.getBatchDiffs();

			expect(result.summary.deleted).toBe(1);
			expect(result.summary.added).toBe(1);

			const deletedFile = result.files.find((f) => f.path === "doomed.ts")!;
			expect(deletedFile.status).toBe("deleted");
			expect(deletedFile.diff).not.toBeNull();
			expect(deletedFile.diff!.oldContent).toBe("will be deleted");
			expect(deletedFile.diff!.newContent).toBeNull();

			const addedFile = result.files.find((f) => f.path === "new.ts")!;
			expect(addedFile.status).toBe("added");
			expect(addedFile.diff!.oldContent).toBeNull();
			expect(addedFile.diff!.newContent).toBe("brand new");
		});
	});

	describe("getFileHistory", () => {
		it("returns full history for a file", async () => {
			writeFileSync(join(workDir, "track.ts"), "v1", "utf-8");
			await mgr.initialize(workDir);

			writeFileSync(join(workDir, "track.ts"), "v2", "utf-8");
			mgr.onTurnEnd(workDir, 0, appendEntry);

			writeFileSync(join(workDir, "track.ts"), "v3", "utf-8");
			mgr.onTurnEnd(workDir, 1, appendEntry);

			const history = mgr.getFileHistory({ filePath: "track.ts" });

			expect(history).toHaveLength(2);
			expect(history[0].turnIndex).toBe(0);
			expect(history[0].status).toBe("modified");
			expect(history[1].turnIndex).toBe(1);
			expect(history[1].status).toBe("modified");
		});

		it("returns empty for non-existent file", async () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			await mgr.initialize(workDir);

			writeFileSync(join(workDir, "foo.ts"), "v2", "utf-8");
			mgr.onTurnEnd(workDir, 0, appendEntry);

			const history = mgr.getFileHistory({ filePath: "never-existed.ts" });

			expect(history).toHaveLength(0);
		});

		it("tracks multiple modifications across turns", async () => {
			await mgr.initialize(workDir);

			writeFileSync(join(workDir, "multi.ts"), "step1", "utf-8");
			mgr.onTurnEnd(workDir, 0, appendEntry);

			writeFileSync(join(workDir, "multi.ts"), "step2", "utf-8");
			mgr.onTurnEnd(workDir, 1, appendEntry);

			writeFileSync(join(workDir, "multi.ts"), "step3", "utf-8");
			mgr.onTurnEnd(workDir, 2, appendEntry);

			const history = mgr.getFileHistory({ filePath: "multi.ts" });

			expect(history).toHaveLength(3);
			expect(history[0].turnIndex).toBe(0);
			expect(history[0].status).toBe("added");
			expect(history[1].status).toBe("modified");
			expect(history[2].status).toBe("modified");

			for (const entry of history) {
				expect(entry.entryId).toBeDefined();
				expect(entry.snapshotHash).toBeDefined();
			}
		});

		it("tracks add then delete", async () => {
			await mgr.initialize(workDir);

			writeFileSync(join(workDir, "temp.ts"), "created", "utf-8");
			mgr.onTurnEnd(workDir, 0, appendEntry);

			rmSync(join(workDir, "temp.ts"));
			mgr.onTurnEnd(workDir, 1, appendEntry);

			const history = mgr.getFileHistory({ filePath: "temp.ts" });

			expect(history).toHaveLength(2);
			expect(history[0].status).toBe("added");
			expect(history[1].status).toBe("deleted");
			expect(history[0].previousHash).toBeDefined();
		});
	});
});
