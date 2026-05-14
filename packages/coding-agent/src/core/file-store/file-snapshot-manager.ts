import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { CustomEntry, SessionEntry } from "../session-manager.js";
import type { InternalGit, TreeEntry } from "./internal-git.js";

export interface StepSnapshotData {
	baselineTreeHash: string | null;
	snapshotTreeHash: string;
	diff: { added: string[]; modified: string[]; deleted: string[] } | null;
	turnIndex: number;
}

export interface ModifiedFileInfo {
	path: string;
	status: "added" | "modified" | "deleted";
	turnIndex: number;
	entryId: string;
}

export interface FileDiffInfo {
	path: string;
	oldContent: string | null;
	newContent: string | null;
	oldHash: string | null;
	newHash: string | null;
	unifiedDiff: string;
}

export interface RestoreResult {
	restored: string[];
	deleted: string[];
	skipped: string[];
	dirty: string[];
}

const FILE_SIZE_LIMIT = 1024 * 1024;

function findCanonicalGitRoot(cwd: string): string | null {
	let dir: string;
	try {
		dir = realpathSync(cwd);
	} catch {
		return null;
	}
	for (;;) {
		const gitPath = join(dir, ".git");
		if (!existsSync(gitPath)) {
			const parent = dirname(dir);
			if (parent === dir) return null;
			dir = parent;
			continue;
		}
		const stat = lstatSync(gitPath);
		if (stat.isDirectory()) return dir;
		if (stat.isFile()) {
			const content = readFileSync(gitPath, "utf-8").trim();
			const match = content.match(/^gitdir:\s*(.+)/);
			if (!match) return null;
			const gitdir = match[1]!.trim();
			if (gitdir.includes("/worktrees/")) {
				const commonPrefix = gitdir.replace(/\/worktrees\/[^/]+\/?$/, "");
				let rootDir = commonPrefix;
				if (rootDir.endsWith("/.git")) rootDir = rootDir.slice(0, -4);
				if (!existsSync(join(rootDir, ".git"))) return null;
				return realpathSync(rootDir);
			}
			const parent = dirname(gitdir);
			if (!existsSync(parent)) return null;
			return parent;
		}
		return null;
	}
}

function readFilteredWorkingDir(git: InternalGit, cwd: string): Map<string, string> {
	const all = git.scanWorkingDir(cwd);
	const filtered = new Map<string, string>();
	for (const [path, content] of all) {
		if (content.length > FILE_SIZE_LIMIT) continue;
		filtered.set(path, content);
	}
	return filtered;
}

function generateUnifiedDiff(oldContent: string | null, newContent: string | null, filePath: string): string {
	const oldLines = oldContent === null ? [] : oldContent.split("\n");
	const newLines = newContent === null ? [] : newContent.split("\n");
	const lines: string[] = [];
	lines.push(`--- ${filePath}`);
	lines.push(`+++ ${filePath}`);

	let i = 0;
	let j = 0;
	const hunks: string[] = [];

	while (i < oldLines.length || j < newLines.length) {
		if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
			i++;
			j++;
		} else {
			const hunkStart = Math.max(0, i - 3);
			const hunkOldEnd = Math.min(oldLines.length, i + 3);
			const hunkNewEnd = Math.min(newLines.length, j + 3);

			const removed: string[] = [];
			const added: string[] = [];
			let oi = i;
			let ni = j;

			while (oi < hunkOldEnd || ni < hunkNewEnd) {
				if (oi < hunkOldEnd && ni < hunkNewEnd && oldLines[oi] === newLines[ni]) {
					break;
				}
				if (oi < hunkOldEnd) {
					removed.push(oldLines[oi]);
					oi++;
				}
				if (ni < hunkNewEnd && (oi >= hunkOldEnd || newLines[ni] !== oldLines[oi])) {
					added.push(newLines[ni]);
					ni++;
				} else if (ni < hunkNewEnd) {
					break;
				}
			}

			const contextStart = Math.max(0, i - 2);
			const contextLines: string[] = [];
			for (let c = contextStart; c < i; c++) {
				contextLines.push(` ${oldLines[c]}`);
			}
			for (const r of removed) {
				contextLines.push(`-${r}`);
			}
			for (const a of added) {
				contextLines.push(`+${a}`);
			}
			const contextEnd = Math.min(newLines.length, ni + 2);
			for (let c = ni; c < contextEnd; c++) {
				contextLines.push(` ${newLines[c]}`);
			}

			hunks.push(`@@ -${i + 1},${oi - i} +${j + 1},${ni - j} @@`);
			hunks.push(...contextLines);

			i = oi;
			j = ni;
		}
	}

	if (hunks.length === 0) return "";
	lines.push(...hunks);
	return lines.join("\n");
}

export interface BatchDiffResult {
	files: Array<{
		path: string;
		status: "added" | "modified" | "deleted";
		diff: FileDiffInfo | null;
	}>;
	summary: {
		totalFiles: number;
		added: number;
		modified: number;
		deleted: number;
	};
}

export interface FileHistoryEntry {
	entryId: string;
	turnIndex: number;
	timestamp: string;
	status: "added" | "modified" | "deleted";
	snapshotHash: string;
	previousHash: string | null;
}

interface SnapshotWithEntryId extends StepSnapshotData {
	entryId: string;
}

export class FileSnapshotManager {
	private git: InternalGit;
	private sessionStartTreeHash: string | null = null;
	private lastCommittedTreeHash: string | null = null;
	private turnIndex = 0;
	private snapshotIndex: Map<string, SnapshotWithEntryId> = new Map();
	private turnIndexMap: Map<number, string> = new Map();

	constructor(git: InternalGit) {
		this.git = git;
	}

	async initialize(cwd: string): Promise<void> {
		this.sessionStartTreeHash = null;
		this.lastCommittedTreeHash = null;
		this.turnIndex = 0;
		this.snapshotIndex.clear();
		this.turnIndexMap.clear();

		const files = readFilteredWorkingDir(this.git, cwd);
		if (files.size > 0) {
			this.sessionStartTreeHash = this.git.writeTree(files).treeHash;
		}
	}

	onTurnEnd(cwd: string, turnIndex: number, appendEntry: (type: string, data: unknown) => string | undefined): void {
		const files = readFilteredWorkingDir(this.git, cwd);
		const { treeHash: snapshotTreeHash, entries: newEntries } = this.git.writeTree(files);

		const compareTo = this.lastCommittedTreeHash ?? this.sessionStartTreeHash;
		const oldEntries = compareTo ? this.parseTreeEntriesFromHash(compareTo) : new Map<string, TreeEntry>();

		const stepDiff = this.git.computeDiff(oldEntries, newEntries);
		const hasChanges = stepDiff.added.length > 0 || stepDiff.modified.length > 0 || stepDiff.deleted.length > 0;

		if (hasChanges) {
			const entryId = appendEntry("step-snapshot", {
				baselineTreeHash: compareTo,
				snapshotTreeHash,
				diff: stepDiff,
				turnIndex,
			});

			if (entryId) {
				this.snapshotIndex.set(entryId, {
					baselineTreeHash: compareTo,
					snapshotTreeHash,
					diff: stepDiff,
					turnIndex,
					entryId,
				});
				this.turnIndexMap.set(turnIndex, entryId);
			}
			this.lastCommittedTreeHash = snapshotTreeHash;
		}

		this.turnIndex = turnIndex + 1;
	}

	rebuildIndex(entries: SessionEntry[]): void {
		this.snapshotIndex.clear();
		this.turnIndexMap.clear();
		this.lastCommittedTreeHash = null;
		this.sessionStartTreeHash = null;
		this.turnIndex = 0;

		for (const entry of entries) {
			if (entry.type !== "custom") continue;
			const custom = entry as CustomEntry;
			if (custom.customType !== "step-snapshot") continue;

			const data = custom.data as StepSnapshotData;
			if (!data) continue;

			this.snapshotIndex.set(entry.id, {
				...data,
				entryId: entry.id,
			});
			this.turnIndexMap.set(data.turnIndex, entry.id);
			this.lastCommittedTreeHash = data.snapshotTreeHash;
			this.turnIndex = Math.max(this.turnIndex, data.turnIndex + 1);
		}
	}

	getLatestSnapshotOnPath(entries: SessionEntry[], leafId: string | null): StepSnapshotData | null {
		if (!leafId) return null;

		const byId = new Map<string, SessionEntry>();
		for (const entry of entries) {
			byId.set(entry.id, entry);
		}

		const snapshots: StepSnapshotData[] = [];
		for (const entry of entries) {
			if (entry.type !== "custom") continue;
			const custom = entry as CustomEntry;
			if (custom.customType !== "step-snapshot") continue;
			if (!isOnPathTo(byId, leafId, entry.id)) continue;
			snapshots.push(custom.data as StepSnapshotData);
		}

		return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
	}

	getSnapshotAtTurn(turnIndex: number): StepSnapshotData | null {
		const entryId = this.turnIndexMap.get(turnIndex);
		if (!entryId) return null;
		const snap = this.snapshotIndex.get(entryId);
		if (!snap) return null;
		return {
			baselineTreeHash: snap.baselineTreeHash,
			snapshotTreeHash: snap.snapshotTreeHash,
			diff: snap.diff,
			turnIndex: snap.turnIndex,
		};
	}

	getSnapshotAtEntry(entryId: string): StepSnapshotData | null {
		const snap = this.snapshotIndex.get(entryId);
		if (!snap) return null;
		return {
			baselineTreeHash: snap.baselineTreeHash,
			snapshotTreeHash: snap.snapshotTreeHash,
			diff: snap.diff,
			turnIndex: snap.turnIndex,
		};
	}

	getModifiedFiles(options?: { fromEntryId?: string; toEntryId?: string }): ModifiedFileInfo[] {
		const snapshots = [...this.snapshotIndex.values()].sort((a, b) => a.turnIndex - b.turnIndex);

		const fromIdx = options?.fromEntryId ? snapshots.findIndex((s) => s.entryId === options.fromEntryId) : -1;
		const toIdx = options?.toEntryId ? snapshots.findIndex((s) => s.entryId === options.toEntryId) : -1;

		const start = fromIdx === -1 ? 0 : fromIdx;
		const end = toIdx === -1 ? snapshots.length - 1 : toIdx;

		if (start > end || snapshots.length === 0) return [];

		const fileMap = new Map<string, ModifiedFileInfo>();
		for (let i = start; i <= end; i++) {
			const snap = snapshots[i];
			if (!snap?.diff) continue;

			for (const path of snap.diff.added) {
				if (!fileMap.has(path)) {
					fileMap.set(path, { path, status: "added", turnIndex: snap.turnIndex, entryId: snap.entryId });
				}
			}
			for (const path of snap.diff.modified) {
				if (!fileMap.has(path)) {
					fileMap.set(path, { path, status: "modified", turnIndex: snap.turnIndex, entryId: snap.entryId });
				} else {
					const existing = fileMap.get(path)!;
					if (existing.status !== "added") {
						existing.status = "modified";
					}
				}
			}
			for (const path of snap.diff.deleted) {
				if (!fileMap.has(path)) {
					fileMap.set(path, { path, status: "deleted", turnIndex: snap.turnIndex, entryId: snap.entryId });
				}
			}
		}

		return [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	getFileDiff(options: { filePath: string; fromEntryId?: string; toEntryId?: string }): FileDiffInfo | null {
		const snapshots = [...this.snapshotIndex.values()].sort((a, b) => a.turnIndex - b.turnIndex);

		const fromHash = options.fromEntryId
			? (snapshots.find((s) => s.entryId === options.fromEntryId)?.snapshotTreeHash ?? null)
			: this.sessionStartTreeHash;
		const toHash = options.toEntryId
			? (snapshots.find((s) => s.entryId === options.toEntryId)?.snapshotTreeHash ?? null)
			: (this.lastCommittedTreeHash ?? this.sessionStartTreeHash);

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

	getBatchDiffs(options?: { fromEntryId?: string; toEntryId?: string }): BatchDiffResult {
		const files = this.getModifiedFiles({
			fromEntryId: options?.fromEntryId,
			toEntryId: options?.toEntryId,
		});

		let added = 0;
		let modified = 0;
		let deleted = 0;

		const resultFiles = files.map((f) => {
			if (f.status === "added") added++;
			else if (f.status === "modified") modified++;
			else deleted++;

			let diff: FileDiffInfo | null = null;
			try {
				diff = this.getFileDiff({
					filePath: f.path,
					fromEntryId: options?.fromEntryId,
					toEntryId: options?.toEntryId,
				});
			} catch {}

			return { path: f.path, status: f.status, diff };
		});

		return {
			files: resultFiles,
			summary: {
				totalFiles: files.length,
				added,
				modified,
				deleted,
			},
		};
	}

	getFileHistory(options: { filePath: string }): FileHistoryEntry[] {
		const snapshots = [...this.snapshotIndex.values()].sort((a, b) => a.turnIndex - b.turnIndex);
		const history: FileHistoryEntry[] = [];

		for (const snap of snapshots) {
			if (!snap.diff) continue;

			let status: "added" | "modified" | "deleted" | null = null;
			if (snap.diff.added.includes(options.filePath)) {
				status = "added";
			} else if (snap.diff.modified.includes(options.filePath)) {
				status = "modified";
			} else if (snap.diff.deleted.includes(options.filePath)) {
				status = "deleted";
			}

			if (status) {
				const previousHash = snap.baselineTreeHash ?? null;
				history.push({
					entryId: snap.entryId,
					turnIndex: snap.turnIndex,
					timestamp: new Date(0).toISOString(),
					status,
					snapshotHash: snap.snapshotTreeHash,
					previousHash,
				});
			}
		}

		return history;
	}

	async restoreFiles(
		cwd: string,
		options: {
			targetEntryId?: string;
			snapshotHash?: string;
			files?: string[];
			preview?: boolean;
			currentLeafId?: string | null;
			entries: SessionEntry[];
			appendEntry: (type: string, data: unknown) => void;
		},
	): Promise<RestoreResult> {
		const empty: RestoreResult = { restored: [], deleted: [], skipped: [], dirty: [] };

		let targetTreeHash: string | null;
		if (options.snapshotHash) {
			targetTreeHash = options.snapshotHash;
		} else if (options.targetEntryId) {
			const snap = this.snapshotIndex.get(options.targetEntryId);
			if (snap) {
				targetTreeHash = snap.snapshotTreeHash;
			} else {
				const pathSnap = this.getLatestSnapshotOnPath(options.entries, options.targetEntryId);
				targetTreeHash = pathSnap?.snapshotTreeHash ?? null;
			}
		} else {
			targetTreeHash = this.sessionStartTreeHash ?? null;
		}

		let currentTreeHash: string | null;
		if (options.currentLeafId !== undefined) {
			const currentSnapshot = this.getLatestSnapshotOnPath(options.entries, options.currentLeafId);
			currentTreeHash = currentSnapshot?.snapshotTreeHash ?? null;
		} else {
			currentTreeHash = this.lastCommittedTreeHash ?? this.sessionStartTreeHash;
		}

		if (targetTreeHash === currentTreeHash) return empty;

		// Safety guard: if targetTreeHash is null, we cannot determine the target state.
		// Treating null as "no files" would delete everything on disk — a data-loss bug.
		// Instead, bail out safely.
		if (targetTreeHash === null) {
			return empty;
		}

		const targetFiles = this.git.readTree(targetTreeHash);
		const currentFiles = currentTreeHash ? this.git.readTree(currentTreeHash) : new Map<string, string>();

		const toRestore: string[] = [];
		for (const [path, content] of targetFiles) {
			const current = currentFiles.get(path);
			if (current !== content) {
				toRestore.push(path);
			}
		}

		const toDelete: string[] = [];
		for (const path of currentFiles.keys()) {
			if (!targetFiles.has(path)) {
				toDelete.push(path);
			}
		}

		let filteredRestore = toRestore;
		let filteredDelete = toDelete;

		if (options.files) {
			const fileSet = new Set(options.files);
			filteredRestore = toRestore.filter((p) => fileSet.has(p));
			filteredDelete = toDelete.filter((p) => fileSet.has(p));
		}

		if (filteredRestore.length === 0 && filteredDelete.length === 0) return empty;

		const dirty: string[] = [];
		for (const path of filteredRestore) {
			const absPath = join(cwd, path);
			if (existsSync(absPath)) {
				const expectedContent = currentFiles.get(path);
				const expectedHash = expectedContent !== undefined ? this.git.hashContent(expectedContent) : null;
				let actualContent: string | null = null;
				try {
					const stat = lstatSync(absPath);
					if (stat.size <= FILE_SIZE_LIMIT) {
						actualContent = readFileSync(absPath, "utf-8");
					}
				} catch {
					continue;
				}
				const actualHash = actualContent !== null ? this.git.hashContent(actualContent) : null;
				if (expectedHash !== null && actualHash !== expectedHash) {
					dirty.push(path);
				}
			}
		}
		dirty.sort();

		if (options.preview) {
			return {
				restored: filteredRestore.sort(),
				deleted: filteredDelete.sort(),
				skipped: [],
				dirty,
			};
		}

		const preRollbackFiles = readFilteredWorkingDir(this.git, cwd);
		const preRollbackTreeHash = preRollbackFiles.size > 0 ? this.git.writeTree(preRollbackFiles).treeHash : null;

		options.appendEntry("unrevert-point", {
			preRollbackTreeHash,
			rolledBackToLeaf: options.targetEntryId ?? "",
			restoredFiles: filteredRestore,
		});

		for (const path of filteredRestore) {
			const content = targetFiles.get(path);
			if (content === undefined) continue;
			const absPath = join(cwd, path);
			mkdirSync(dirname(absPath), { recursive: true });
			writeFileSync(absPath, content, "utf-8");
		}

		for (const path of filteredDelete) {
			const absPath = join(cwd, path);
			if (existsSync(absPath)) {
				rmSync(absPath, { force: true });
			}
		}

		this.lastCommittedTreeHash = targetTreeHash;

		return {
			restored: filteredRestore.sort(),
			deleted: filteredDelete.sort(),
			skipped: [],
			dirty,
		};
	}

	private parseTreeEntriesFromHash(treeHash: string): Map<string, TreeEntry> {
		const treeData = this.git.readObject(treeHash);
		const entries = new Map<string, TreeEntry>();
		for (const line of treeData.split("\n")) {
			if (!line) continue;
			const sep = line.indexOf("\0");
			if (sep === -1) continue;
			const path = line.slice(0, sep);
			const hash = line.slice(sep + 1);
			entries.set(path, { path, hash });
		}
		return entries;
	}
}

function isOnPathTo(byId: Map<string, SessionEntry>, startId: string, targetId: string): boolean {
	let current: string | null = startId;
	while (current !== null) {
		if (current === targetId) return true;
		const entry = byId.get(current);
		if (!entry) break;
		current = entry.parentId;
	}
	return false;
}
