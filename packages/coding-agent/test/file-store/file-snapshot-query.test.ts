import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InternalGit } from "../../src/core/file-store/internal-git.js";

interface StepSnapshotData {
	baselineTreeHash: string | null;
	snapshotTreeHash: string;
	diff: {
		added: string[];
		modified: string[];
		deleted: string[];
	} | null;
	turnIndex: number;
}

interface ModifiedFileInfo {
	path: string;
	status: "added" | "modified" | "deleted";
	turnIndex: number;
	entryId: string;
}

interface FileDiffInfo {
	path: string;
	oldContent: string | null;
	newContent: string | null;
	oldHash: string | null;
	newHash: string | null;
	unifiedDiff: string;
}

interface SnapshotEntry {
	id: string;
	turnIndex: number;
	data: StepSnapshotData;
}

function generateUnifiedDiff(oldContent: string | null, newContent: string | null, filePath: string): string {
	if (oldContent === null && newContent === null) return "";

	const oldLines = oldContent === null ? [] : oldContent.split("\n");
	const newLines = newContent === null ? [] : newContent.split("\n");

	const lines: string[] = [`--- ${filePath}`, `+++ ${filePath}`];

	let oi = 0;
	let ni = 0;
	while (oi < oldLines.length || ni < newLines.length) {
		if (oi < oldLines.length && ni < newLines.length) {
			if (oldLines[oi] === newLines[ni]) {
				lines.push(` ${oldLines[oi]}`);
				oi++;
				ni++;
			} else {
				lines.push(`-${oldLines[oi]}`);
				lines.push(`+${newLines[ni]}`);
				oi++;
				ni++;
			}
		} else if (oi < oldLines.length) {
			lines.push(`-${oldLines[oi]}`);
			oi++;
		} else {
			lines.push(`+${newLines[ni]}`);
			ni++;
		}
	}

	return lines.join("\n");
}

class FileSnapshotQueryManager {
	private git: InternalGit;
	private snapshots: SnapshotEntry[] = [];
	private sessionStartTreeHash: string | null = null;
	private entryCounter = 0;

	constructor(git: InternalGit) {
		this.git = git;
	}

	initialize(cwd: string): void {
		const files = this.git.scanWorkingDir(cwd);
		const { treeHash } = this.git.writeTree(files);
		this.sessionStartTreeHash = treeHash;
	}

	onTurnEnd(cwd: string, turnIndex: number): StepSnapshotData | null {
		const files = this.git.scanWorkingDir(cwd);
		const { treeHash: snapshotTreeHash } = this.git.writeTree(files);

		const lastHash =
			this.snapshots.length > 0
				? this.snapshots[this.snapshots.length - 1].data.snapshotTreeHash
				: this.sessionStartTreeHash;

		let diff: StepSnapshotData["diff"] = null;
		if (lastHash && lastHash !== snapshotTreeHash) {
			const d = this.git.diffTrees(lastHash, snapshotTreeHash);
			if (d.added.length > 0 || d.modified.length > 0 || d.deleted.length > 0) {
				diff = d;
			}
		}

		const data: StepSnapshotData = {
			baselineTreeHash: lastHash,
			snapshotTreeHash,
			diff,
			turnIndex,
		};

		if (diff) {
			this.entryCounter++;
			this.snapshots.push({
				id: `snap-${this.entryCounter}`,
				turnIndex,
				data,
			});
		}

		return diff ? data : null;
	}

	getModifiedFiles(options?: { fromEntryId?: string; toEntryId?: string }): ModifiedFileInfo[] {
		const fromIdx = options?.fromEntryId ? this.snapshots.findIndex((s) => s.id === options.fromEntryId) : -1;
		const toIdx = options?.toEntryId
			? this.snapshots.findIndex((s) => s.id === options.toEntryId)
			: this.snapshots.length - 1;

		if (fromIdx === -2 || toIdx === -2) return [];
		const start = fromIdx === -1 ? 0 : fromIdx;
		const end = toIdx === -1 ? this.snapshots.length - 1 : toIdx;

		const fileMap = new Map<string, ModifiedFileInfo>();
		for (let i = start; i <= end; i++) {
			const snap = this.snapshots[i];
			if (!snap?.data.diff) continue;

			for (const path of snap.data.diff.added) {
				if (!fileMap.has(path)) {
					fileMap.set(path, { path, status: "added", turnIndex: snap.turnIndex, entryId: snap.id });
				}
			}
			for (const path of snap.data.diff.modified) {
				if (!fileMap.has(path)) {
					fileMap.set(path, { path, status: "modified", turnIndex: snap.turnIndex, entryId: snap.id });
				} else {
					const existing = fileMap.get(path)!;
					if (existing.status !== "added") {
						existing.status = "modified";
					}
				}
			}
			for (const path of snap.data.diff.deleted) {
				if (!fileMap.has(path)) {
					fileMap.set(path, { path, status: "deleted", turnIndex: snap.turnIndex, entryId: snap.id });
				}
			}
		}

		return [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	getFileDiff(options: { filePath: string; fromEntryId?: string; toEntryId?: string }): FileDiffInfo | null {
		const fromHash = options.fromEntryId
			? (this.snapshots.find((s) => s.id === options.fromEntryId)?.data.snapshotTreeHash ?? null)
			: this.sessionStartTreeHash;
		const toHash = options.toEntryId
			? (this.snapshots.find((s) => s.id === options.toEntryId)?.data.snapshotTreeHash ?? null)
			: this.snapshots.length > 0
				? this.snapshots[this.snapshots.length - 1].data.snapshotTreeHash
				: this.sessionStartTreeHash;

		if (!fromHash && !toHash) return null;

		const fromFiles = fromHash ? this.git.readTree(fromHash) : new Map<string, string>();
		const toFiles = toHash ? this.git.readTree(toHash) : new Map<string, string>();

		const oldContent = fromFiles.get(options.filePath) ?? null;
		const newContent = toFiles.get(options.filePath) ?? null;

		if (oldContent === null && newContent === null) return null;

		return {
			path: options.filePath,
			oldContent,
			newContent,
			oldHash: oldContent !== null ? this.git.hashContent(oldContent) : null,
			newHash: newContent !== null ? this.git.hashContent(newContent) : null,
			unifiedDiff: generateUnifiedDiff(oldContent, newContent, options.filePath),
		};
	}

	getSnapshotAtTurn(turnIndex: number): SnapshotEntry | undefined {
		return this.snapshots.find((s) => s.turnIndex === turnIndex);
	}
}

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-snapshot-query-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("FileSnapshotQueryManager", () => {
	let tempDir: string;
	let workDir: string;
	let storeDir: string;
	let git: InternalGit;
	let mgr: FileSnapshotQueryManager;

	beforeEach(() => {
		tempDir = createTempDir();
		workDir = join(tempDir, "workspace");
		storeDir = join(tempDir, "store");
		mkdirSync(workDir, { recursive: true });
		git = new InternalGit(storeDir);
		mgr = new FileSnapshotQueryManager(git);
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("getModifiedFiles", () => {
		it("returns all changes for full session range", () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "foo.ts"), "v2", "utf-8");
			writeFileSync(join(workDir, "bar.ts"), "new", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			const files = mgr.getModifiedFiles();
			expect(files).toHaveLength(2);
			expect(files.find((f) => f.path === "foo.ts")?.status).toBe("modified");
			expect(files.find((f) => f.path === "bar.ts")?.status).toBe("added");
		});

		it("returns changes between two specific entries", () => {
			writeFileSync(join(workDir, "a.ts"), "a1", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "b.ts"), "b1", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			writeFileSync(join(workDir, "c.ts"), "c1", "utf-8");
			mgr.onTurnEnd(workDir, 1);

			writeFileSync(join(workDir, "d.ts"), "d1", "utf-8");
			mgr.onTurnEnd(workDir, 2);

			const snap0 = mgr.getSnapshotAtTurn(0)!;
			const snap2 = mgr.getSnapshotAtTurn(2)!;
			const files = mgr.getModifiedFiles({ fromEntryId: snap0.id, toEntryId: snap2.id });

			const paths = files.map((f) => f.path);
			expect(paths).toContain("c.ts");
			expect(paths).toContain("d.ts");
		});

		it("returns empty for no changes", () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			mgr.initialize(workDir);

			mgr.onTurnEnd(workDir, 0);

			const files = mgr.getModifiedFiles();
			expect(files).toHaveLength(0);
		});

		it("aggregates across multiple turns", () => {
			writeFileSync(join(workDir, "base.ts"), "base", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "a.ts"), "a1", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			writeFileSync(join(workDir, "b.ts"), "b1", "utf-8");
			writeFileSync(join(workDir, "a.ts"), "a2", "utf-8");
			mgr.onTurnEnd(workDir, 1);

			const files = mgr.getModifiedFiles();
			expect(files.length).toBeGreaterThanOrEqual(2);

			const aFile = files.find((f) => f.path === "a.ts");
			expect(aFile).toBeDefined();
			expect(aFile!.turnIndex).toBe(0);

			const bFile = files.find((f) => f.path === "b.ts");
			expect(bFile).toBeDefined();
			expect(bFile!.status).toBe("added");
		});

		it("tracks per-file status correctly", () => {
			writeFileSync(join(workDir, "existing.ts"), "original", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "new.ts"), "brand new", "utf-8");
			writeFileSync(join(workDir, "existing.ts"), "changed", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			const files = mgr.getModifiedFiles();
			const existingFile = files.find((f) => f.path === "existing.ts");
			expect(existingFile?.status).toBe("modified");

			const newFile = files.find((f) => f.path === "new.ts");
			expect(newFile?.status).toBe("added");
		});

		it("handles file deletion", () => {
			writeFileSync(join(workDir, "doomed.ts"), "will be deleted", "utf-8");
			mgr.initialize(workDir);

			rmSync(join(workDir, "doomed.ts"));
			mgr.onTurnEnd(workDir, 0);

			const files = mgr.getModifiedFiles();
			const deletedFile = files.find((f) => f.path === "doomed.ts");
			expect(deletedFile?.status).toBe("deleted");
		});
	});

	describe("getFileDiff", () => {
		it("returns diff for modified file", () => {
			writeFileSync(join(workDir, "foo.ts"), "line1\nline2\n", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "foo.ts"), "line1\nline2-changed\n", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			const snap = mgr.getSnapshotAtTurn(0)!;
			const diff = mgr.getFileDiff({ filePath: "foo.ts", toEntryId: snap.id });

			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("line1\nline2\n");
			expect(diff!.newContent).toBe("line1\nline2-changed\n");
			expect(diff!.oldHash).not.toBeNull();
			expect(diff!.newHash).not.toBeNull();
			expect(diff!.unifiedDiff).toContain("-line2");
			expect(diff!.unifiedDiff).toContain("+line2-changed");
		});

		it("returns diff for added file (oldContent = null)", () => {
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "new.ts"), "brand new content\n", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			const snap = mgr.getSnapshotAtTurn(0)!;
			const diff = mgr.getFileDiff({ filePath: "new.ts", toEntryId: snap.id });

			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBeNull();
			expect(diff!.newContent).toBe("brand new content\n");
			expect(diff!.oldHash).toBeNull();
			expect(diff!.newHash).not.toBeNull();
			expect(diff!.unifiedDiff).toContain("+brand new content");
		});

		it("returns diff for deleted file (newContent = null)", () => {
			writeFileSync(join(workDir, "doomed.ts"), "about to be deleted\n", "utf-8");
			mgr.initialize(workDir);

			rmSync(join(workDir, "doomed.ts"));
			mgr.onTurnEnd(workDir, 0);

			const snap = mgr.getSnapshotAtTurn(0)!;
			const diff = mgr.getFileDiff({ filePath: "doomed.ts", toEntryId: snap.id });

			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("about to be deleted\n");
			expect(diff!.newContent).toBeNull();
			expect(diff!.oldHash).not.toBeNull();
			expect(diff!.newHash).toBeNull();
			expect(diff!.unifiedDiff).toContain("-about to be deleted");
		});

		it("returns null for file not in either snapshot", () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "bar.ts"), "v1", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			const snap = mgr.getSnapshotAtTurn(0)!;
			const diff = mgr.getFileDiff({ filePath: "nonexistent.ts", toEntryId: snap.id });
			expect(diff).toBeNull();
		});

		it("generates valid unified diff", () => {
			mkdirSync(join(workDir, "src"), { recursive: true });
			writeFileSync(join(workDir, "src/app.ts"), "import a\nimport b\n", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "src/app.ts"), "import a\nimport c\nimport d\n", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			const snap = mgr.getSnapshotAtTurn(0)!;
			const diff = mgr.getFileDiff({ filePath: "src/app.ts", toEntryId: snap.id });

			expect(diff).not.toBeNull();
			expect(diff!.unifiedDiff).toContain("--- src/app.ts");
			expect(diff!.unifiedDiff).toContain("+++ src/app.ts");
			expect(diff!.unifiedDiff).toContain("-import b");
			expect(diff!.unifiedDiff).toContain("+import c");
			expect(diff!.unifiedDiff).toContain("+import d");
		});

		it("handles default range (session start to current)", () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "foo.ts"), "v2", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			writeFileSync(join(workDir, "foo.ts"), "v3", "utf-8");
			mgr.onTurnEnd(workDir, 1);

			const diff = mgr.getFileDiff({ filePath: "foo.ts" });
			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("v1");
			expect(diff!.newContent).toBe("v3");
		});

		it("scopes diff to a specific entry range", () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			mgr.initialize(workDir);

			writeFileSync(join(workDir, "foo.ts"), "v2", "utf-8");
			mgr.onTurnEnd(workDir, 0);

			writeFileSync(join(workDir, "foo.ts"), "v3", "utf-8");
			mgr.onTurnEnd(workDir, 1);

			const snap0 = mgr.getSnapshotAtTurn(0)!;
			const diff = mgr.getFileDiff({ filePath: "foo.ts", fromEntryId: snap0.id });

			expect(diff).not.toBeNull();
			expect(diff!.oldContent).toBe("v2");
			expect(diff!.newContent).toBe("v3");
		});
	});
});
