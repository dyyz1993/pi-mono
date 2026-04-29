import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionTreeEvent, TurnEndEvent } from "@dyyz1993/pi-coding-agent";

function fnv1a(data: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < data.length; i++) {
		hash ^= data.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash.toString(16).padStart(8, "0");
}

const DEFAULT_IGNORE_PATTERNS = [
	"node_modules",
	".git",
	".pi",
	"dist",
	"build",
	".DS_Store",
	"__pycache__",
	".next",
	".nuxt",
	"target",
	".gradle",
	".idea",
	".vscode",
	"*.swp",
	"*.swo",
	"*.pyc",
];

function matchGlob(name: string, pattern: string): boolean {
	if (pattern.startsWith("*.")) {
		return name.endsWith(pattern.slice(1));
	}
	if (pattern.endsWith("/")) {
		return name === pattern.slice(0, -1);
	}
	return name === pattern;
}

function shouldIgnore(relPath: string, extraPatterns: string[]): boolean {
	const parts = relPath.split("/");
	for (const part of parts) {
		for (const pattern of DEFAULT_IGNORE_PATTERNS) {
			if (matchGlob(part, pattern)) return true;
		}
		for (const pattern of extraPatterns) {
			const trimmed = pattern.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			if (trimmed.startsWith("!")) continue;
			if (matchGlob(part, trimmed.replace(/^\/+/, ""))) return true;
		}
	}
	return false;
}

function findCanonicalGitRoot(cwd: string): string | null {
	let dir = realpathSync(cwd);
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

class ObjectStore {
	private readonly objectsDir: string;

	constructor(storeDir: string) {
		this.objectsDir = join(storeDir, "objects");
		mkdirSync(this.objectsDir, { recursive: true });
	}

	writeObject(content: string): string {
		const hash = fnv1a(content);
		const prefix = hash.slice(0, 2);
		const suffix = hash.slice(2);
		const dir = join(this.objectsDir, prefix);
		const file = join(dir, suffix);
		if (!existsSync(file)) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(file, content, "utf-8");
		}
		return hash;
	}

	readObject(hash: string): string {
		return readFileSync(join(this.objectsDir, hash.slice(0, 2), hash.slice(2)), "utf-8");
	}

	hasObject(hash: string): boolean {
		return existsSync(join(this.objectsDir, hash.slice(0, 2), hash.slice(2)));
	}

	scanWorkingDir(cwd: string): Map<string, string> {
		const gitignorePatterns: string[] = [];
		const gitignorePath = join(cwd, ".gitignore");
		if (existsSync(gitignorePath)) {
			try {
				gitignorePatterns.push(...readFileSync(gitignorePath, "utf-8").split(/\r?\n/));
			} catch {}
		}
		const result = new Map<string, string>();
		this.scanDir(cwd, cwd, gitignorePatterns, result);
		return result;
	}

	private scanDir(dir: string, root: string, extraPatterns: string[], result: Map<string, string>): void {
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			const relPath = relative(root, fullPath);
			if (entry.isDirectory()) {
				if (shouldIgnore(`${relPath}/`, extraPatterns)) continue;
				this.scanDir(fullPath, root, extraPatterns, result);
			} else if (entry.isFile()) {
				if (shouldIgnore(relPath, extraPatterns)) continue;
				try {
					const stat = lstatSync(fullPath);
					if (stat.size > 1024 * 1024) continue;
					const content = readFileSync(fullPath, "utf-8");
					result.set(relPath, content);
				} catch {}
			}
		}
	}

	writeTree(files: Map<string, string>): string {
		const entries: Array<{ path: string; hash: string }> = [];
		for (const [path, content] of files) {
			const hash = this.writeObject(content);
			entries.push({ path, hash });
		}
		entries.sort((a, b) => a.path.localeCompare(b.path));
		const treeData = entries.map((e) => `${e.path}\0${e.hash}`).join("\n");
		return this.writeObject(treeData);
	}

	readTree(treeHash: string): Map<string, string> {
		const treeData = this.readObject(treeHash);
		const files = new Map<string, string>();
		for (const line of treeData.split("\n")) {
			if (!line) continue;
			const sep = line.indexOf("\0");
			if (sep === -1) continue;
			const path = line.slice(0, sep);
			const hash = line.slice(sep + 1);
			if (this.hasObject(hash)) {
				files.set(path, this.readObject(hash));
			}
		}
		return files;
	}

	parseTreeEntries(treeHash: string): Map<string, string> {
		const treeData = this.readObject(treeHash);
		const entries = new Map<string, string>();
		for (const line of treeData.split("\n")) {
			if (!line) continue;
			const sep = line.indexOf("\0");
			if (sep === -1) continue;
			entries.set(line.slice(0, sep), line.slice(sep + 1));
		}
		return entries;
	}

	computeTreeDiff(
		oldTreeHash: string | null,
		newTreeHash: string,
	): { added: string[]; modified: string[]; deleted: string[] } {
		const oldEntries = oldTreeHash ? this.parseTreeEntries(oldTreeHash) : new Map<string, string>();
		const newEntries = this.parseTreeEntries(newTreeHash);

		const added: string[] = [];
		const modified: string[] = [];
		const deleted: string[] = [];

		for (const [path, hash] of newEntries) {
			const old = oldEntries.get(path);
			if (!old) added.push(path);
			else if (old !== hash) modified.push(path);
		}
		for (const path of oldEntries.keys()) {
			if (!newEntries.has(path)) deleted.push(path);
		}

		return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
	}
}

interface StepSnapshot {
	baselineTreeHash: string | null;
	snapshotTreeHash: string;
	diff: { added: string[]; modified: string[]; deleted: string[] } | null;
	turnIndex: number;
}

interface UnrevertPoint {
	preRollbackTreeHash: string;
	rolledBackToLeaf: string;
	restoredFiles: string[];
}

function getStoreRoot(): string {
	return join(homedir(), ".pi", "agent", "file-store");
}

export default function fileSnapshot(pi: ExtensionAPI) {
	let store: ObjectStore | null = null;
	let sessionStartTreeHash: string | null = null;
	let lastCommittedTreeHash: string | null = null;
	let turnIndex = 0;
	let _sessionBaselinePaths: Set<string> = new Set();

	function getStore(ctx: ExtensionContext): ObjectStore {
		if (!store) {
			const projectRoot = findCanonicalGitRoot(ctx.cwd) ?? ctx.cwd;
			const projectHash = fnv1a(projectRoot);
			store = new ObjectStore(join(getStoreRoot(), projectHash));
		}
		return store;
	}

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		store = null;
		sessionStartTreeHash = null;
		lastCommittedTreeHash = null;
		turnIndex = 0;
		const s = getStore(ctx);
		const files = s.scanWorkingDir(ctx.cwd);
		_sessionBaselinePaths = new Set(files.keys());
		if (files.size > 0) {
			sessionStartTreeHash = s.writeTree(files);
		}
	});

	pi.on("turn_end", async (_event: TurnEndEvent, ctx: ExtensionContext) => {
		const s = getStore(ctx);
		const files = s.scanWorkingDir(ctx.cwd);
		const snapshotTreeHash = s.writeTree(files);

		const compareTo = lastCommittedTreeHash ?? sessionStartTreeHash;
		const isFirstSnapshot = !lastCommittedTreeHash && files.size > 0;
		const diff = compareTo ? s.computeTreeDiff(compareTo, snapshotTreeHash || "") : null;
		const hasChanges = diff && (diff.added.length > 0 || diff.modified.length > 0 || diff.deleted.length > 0);

		if (hasChanges || isFirstSnapshot) {
			pi.appendEntry("step-snapshot", {
				baselineTreeHash: compareTo,
				snapshotTreeHash,
				diff: hasChanges ? diff : null,
				turnIndex,
			} satisfies StepSnapshot);
			lastCommittedTreeHash = snapshotTreeHash || null;
		}

		turnIndex++;
	});

	pi.on("session_tree", async (event: SessionTreeEvent, ctx: ExtensionContext) => {
		const targetId = event.newLeafId;
		const s = getStore(ctx);
		const entries = ctx.sessionManager.getEntries();

		let targetTreeHash: string | null;
		let currentTreeHash2: string | null;

		if (!targetId) {
			targetTreeHash = sessionStartTreeHash ?? null;
			const currentSnapshot = findLatestSnapshotOnPath(entries, event.oldLeafId);
			currentTreeHash2 = currentSnapshot?.snapshotTreeHash ?? null;
		} else {
			const targetEntry = entries.find((e) => e.id === targetId);
			const isRootTarget = targetEntry && !targetEntry.parentId;

			const targetSnapshot = isRootTarget ? null : findLatestSnapshotOnPath(entries, targetId);
			const currentSnapshot = findLatestSnapshotOnPath(entries, event.oldLeafId);

			targetTreeHash = targetSnapshot?.snapshotTreeHash ?? sessionStartTreeHash ?? null;
			currentTreeHash2 = currentSnapshot?.snapshotTreeHash ?? null;
		}

		if (targetTreeHash === currentTreeHash2) return;

		const targetFiles = targetTreeHash ? s.readTree(targetTreeHash) : new Map<string, string>();
		const currentFiles = currentTreeHash2 ? s.readTree(currentTreeHash2) : new Map<string, string>();

		const toRestore = new Map<string, string>();
		for (const [path, content] of targetFiles) {
			const current = currentFiles.get(path);
			if (current !== content) {
				toRestore.set(path, content);
			}
		}

		const toDelete: string[] = [];
		for (const path of currentFiles.keys()) {
			if (!targetFiles.has(path)) {
				toDelete.push(path);
			}
		}

		if (toRestore.size === 0 && toDelete.length === 0) return;

		const preRollbackFiles = s.scanWorkingDir(ctx.cwd);
		const preRollbackTreeHash = preRollbackFiles.size > 0 ? s.writeTree(preRollbackFiles) : "";

		pi.appendEntry("unrevert-point", {
			preRollbackTreeHash,
			rolledBackToLeaf: targetId ?? "",
			restoredFiles: [...toRestore.keys()],
		} satisfies UnrevertPoint);

		restoreFiles(ctx.cwd, toRestore);
		deleteFiles(ctx.cwd, toDelete);
	});
}

function restoreFiles(cwd: string, toRestore: Map<string, string>): void {
	for (const [path, content] of toRestore) {
		const absPath = join(cwd, path);
		mkdirSync(join(absPath, ".."), { recursive: true });
		writeFileSync(absPath, content, "utf-8");
	}
}

function deleteFiles(cwd: string, paths: string[]): void {
	for (const path of paths) {
		const absPath = join(cwd, path);
		if (existsSync(absPath)) {
			rmSync(absPath, { force: true });
		}
	}
}

function findLatestSnapshotOnPath(
	entries: Array<{ id: string; parentId: string | null; type: string; customType?: string; data?: unknown }>,
	leafId: string | null,
): StepSnapshot | null {
	if (!leafId) return null;

	const byId = new Map(entries.map((e) => [e.id, e]));
	const snapshots: StepSnapshot[] = [];

	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== "step-snapshot") continue;
		if (!isOnPathTo(byId, leafId, entry.id)) continue;
		snapshots.push(entry.data as StepSnapshot);
	}

	return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

function isOnPathTo(
	byId: Map<string, { id: string; parentId: string | null }>,
	startId: string,
	targetId: string,
): boolean {
	let current: string | null = startId;
	while (current !== null) {
		if (current === targetId) return true;
		const entry = byId.get(current);
		if (!entry) break;
		current = entry.parentId;
	}
	return false;
}
