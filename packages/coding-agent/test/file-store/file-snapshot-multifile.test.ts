import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSnapshotManager } from "../../src/core/file-store/file-snapshot-manager.js";
import { InternalGit } from "../../src/core/file-store/internal-git.js";
import type { SessionEntry } from "../../src/core/session-manager.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `fsm-multifile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("FileSnapshotManager - multi-file rollback TDD", () => {
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

	/**
	 * Scenario: Two turns that create/modify/delete multiple files.
	 *
	 * Turn 1: Create file-A.txt ("AAA"), file-B.txt ("BBB"), file-C.txt ("CCC")
	 * Turn 2: Modify file-A.txt ("AAA" → "AAA-MOD"), delete file-B.txt, create file-D.txt ("DDD")
	 *
	 * Then we test getModifiedFiles and getFileDiff for rollback scenarios.
	 */
	describe("Case 2.4: multi-file diff display", () => {
		let turn0SnapshotId: string;
		let turn1SnapshotId: string;

		beforeEach(async () => {
			await manager.initialize(tempDir);

			// Turn 0: Create 3 files
			writeFileSync(join(tempDir, "file-A.txt"), "AAA", "utf-8");
			writeFileSync(join(tempDir, "file-B.txt"), "BBB", "utf-8");
			writeFileSync(join(tempDir, "file-C.txt"), "CCC", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);
			turn0SnapshotId = appendedEntries[appendedEntries.length - 1]!.id;

			// Turn 1: Modify A, delete B, create D
			writeFileSync(join(tempDir, "file-A.txt"), "AAA-MOD", "utf-8");
			rmSync(join(tempDir, "file-B.txt"));
			writeFileSync(join(tempDir, "file-D.txt"), "DDD", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);
			turn1SnapshotId = appendedEntries[appendedEntries.length - 1]!.id;
		});

		it("should include ADDED files in getModifiedFiles (BUG-MULTI-1)", () => {
			// When rolling back Turn 1 (from turn1SnapshotId to end),
			// file-D.txt should appear as "added" because Turn 1 created it.
			const files = manager.getModifiedFiles({ fromEntryId: turn1SnapshotId });

			const filePaths = files.map((f) => f.path);
			expect(filePaths).toContain("file-A.txt");
			expect(filePaths).toContain("file-B.txt");
			expect(filePaths).toContain("file-D.txt"); // THIS is the bug assertion
		});

		it("should return correct statuses for multi-file changes", () => {
			const files = manager.getModifiedFiles({ fromEntryId: turn1SnapshotId });
			const byPath = new Map(files.map((f) => [f.path, f]));

			expect(byPath.get("file-A.txt")?.status).toBe("modified");
			expect(byPath.get("file-B.txt")?.status).toBe("deleted");
			expect(byPath.get("file-D.txt")?.status).toBe("added");
		});

		it("should include ALL files when rolling back from Turn 0 snapshot to end", () => {
			// Rolling back to first turn: should show ALL file changes across both turns
			const files = manager.getModifiedFiles({ fromEntryId: turn0SnapshotId });

			const filePaths = files.map((f) => f.path);
			// Turn 0 added A, B, C
			expect(filePaths).toContain("file-A.txt");
			expect(filePaths).toContain("file-B.txt");
			expect(filePaths).toContain("file-C.txt");
			// Turn 1 added D
			expect(filePaths).toContain("file-D.txt");
		});

		it("should generate non-empty diff for modified file when comparing previous snapshot (BUG-MULTI-2)", () => {
			// When getFileDiff is called with toEntryId = turn1SnapshotId
			// and WITHOUT fromEntryId, it should still show the diff
			// between session start and the snapshot.
			//
			// file-A.txt: session start had no file-A.txt, snapshot has "AAA-MOD"
			// → oldContent should be null, newContent should be "AAA-MOD"
			const diff = manager.getFileDiff({
				filePath: "file-A.txt",
				toEntryId: turn1SnapshotId,
			});

			expect(diff).not.toBeNull();
			expect(diff?.newContent).toBe("AAA-MOD");
			// Since file-A.txt didn't exist at session start, oldContent should be null
			expect(diff?.oldContent).toBeNull();
			// unifiedDiff should be non-empty (it's all additions)
			expect(diff?.unifiedDiff).toBeTruthy();
		});

		it("should show correct diff when comparing between adjacent snapshots", () => {
			// When getFileDiff is called with both fromEntryId and toEntryId,
			// it should compare the trees of those two snapshots.
			// fromEntryId = turn0SnapshotId → file-A.txt = "AAA"
			// toEntryId = turn1SnapshotId → file-A.txt = "AAA-MOD"
			const diff = manager.getFileDiff({
				filePath: "file-A.txt",
				fromEntryId: turn0SnapshotId,
				toEntryId: turn1SnapshotId,
			});

			expect(diff).not.toBeNull();
			expect(diff?.oldContent).toBe("AAA");
			expect(diff?.newContent).toBe("AAA-MOD");
			expect(diff?.unifiedDiff).toContain("-AAA");
			expect(diff?.unifiedDiff).toContain("+AAA-MOD");
		});

		it("should show diff for deleted file with backward walk", () => {
			const diff = manager.getFileDiff({
				filePath: "file-B.txt",
				fromEntryId: turn0SnapshotId,
				toEntryId: turn1SnapshotId,
			});

			expect(diff).not.toBeNull();
			// file-B.txt existed in turn0 ("BBB") but deleted in turn1
			expect(diff?.oldContent).toBe("BBB");
			expect(diff?.newContent).toBeNull();
			expect(diff?.unifiedDiff).toBeTruthy();
		});

		it("should show diff for added file (file-D.txt)", () => {
			const diff = manager.getFileDiff({
				filePath: "file-D.txt",
				fromEntryId: turn0SnapshotId,
				toEntryId: turn1SnapshotId,
			});

			expect(diff).not.toBeNull();
			// file-D.txt didn't exist in turn0, created in turn1 with "DDD"
			expect(diff?.oldContent).toBeNull();
			expect(diff?.newContent).toBe("DDD");
			expect(diff?.unifiedDiff).toBeTruthy();
		});
	});

	/**
	 * Scenario: Session start has existing files, then turns modify them.
	 * Tests that getFileDiff compares correctly even when files exist at session start.
	 */
	describe("pre-existing files at session start", () => {
		let turn0SnapshotId: string;
		let turn1SnapshotId: string;

		beforeEach(async () => {
			// Session starts with an existing file
			writeFileSync(join(tempDir, "existing.txt"), "ORIGINAL", "utf-8");
			await manager.initialize(tempDir);

			// Turn 0: Modify existing file
			writeFileSync(join(tempDir, "existing.txt"), "MODIFIED", "utf-8");
			manager.onTurnEnd(tempDir, 0, appendEntry);
			turn0SnapshotId = appendedEntries[appendedEntries.length - 1]!.id;

			// Turn 1: Modify back to original + add new file
			writeFileSync(join(tempDir, "existing.txt"), "ORIGINAL", "utf-8");
			writeFileSync(join(tempDir, "new-file.txt"), "NEW", "utf-8");
			manager.onTurnEnd(tempDir, 1, appendEntry);
			turn1SnapshotId = appendedEntries[appendedEntries.length - 1]!.id;
		});

		it("should show non-empty diff when file content differs between adjacent snapshots", () => {
			const diff = manager.getFileDiff({
				filePath: "existing.txt",
				fromEntryId: turn0SnapshotId,
				toEntryId: turn1SnapshotId,
			});

			expect(diff).not.toBeNull();
			expect(diff?.oldContent).toBe("MODIFIED");
			expect(diff?.newContent).toBe("ORIGINAL");
			expect(diff?.unifiedDiff).toBeTruthy();
		});

		it("should show empty diff when file content is same between session start and snapshot", () => {
			// existing.txt at session start = "ORIGINAL"
			// existing.txt at turn1 snapshot = "ORIGINAL"
			// → getFileDiff without fromEntryId should return same content
			const diff = manager.getFileDiff({
				filePath: "existing.txt",
				toEntryId: turn1SnapshotId,
			});

			expect(diff).not.toBeNull();
			expect(diff?.oldContent).toBe("ORIGINAL");
			expect(diff?.newContent).toBe("ORIGINAL");
			// unifiedDiff should be empty because content is identical
			// BUT this should still return a valid diff object (not null)
		});

		it("getModifiedFiles should include file that was modified then reverted", () => {
			// Turn 1 modified existing.txt back to original
			const files = manager.getModifiedFiles({ fromEntryId: turn1SnapshotId });
			const byPath = new Map(files.map((f) => [f.path, f]));

			// existing.txt was modified in turn1 (even if reverted to original content)
			expect(byPath.has("existing.txt")).toBe(true);
			expect(byPath.has("new-file.txt")).toBe(true);
		});
	});
});
