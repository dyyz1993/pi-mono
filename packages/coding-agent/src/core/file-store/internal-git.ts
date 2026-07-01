import {
	type Dirent,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import ignore from "ignore";
import type { FileSystemCapability, FileSystemDirent } from "../filesystem-capability.ts";

export interface TreeEntry {
	path: string;
	hash: string;
}

export interface StepDiff {
	added: string[];
	modified: string[];
	deleted: string[];
}

export interface TreeSnapshot {
	treeHash: string;
	entries: Map<string, TreeEntry>;
}

export interface ObjectMetadata {
	hash: string;
	size: number;
	createdAt: number;
	accessedAt: number;
	type: "file" | "tree";
}

export interface GCResult {
	deletedObjects: number;
	freedBytes: number;
	deletedHashes: string[];
}

const METADATA_DIR = "metadata";

const SCAN_MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const SCAN_MAX_FILE_COUNT = 5000;
const SCAN_MAX_DEPTH_NO_GIT = 3;
const MAX_FILE_SIZE = 1_000_000;

const DEFAULT_IGNORE_PATTERNS = [
	"node_modules/",
	".git/",
	".pi/",
	"dist/",
	"build/",
	".DS_Store",
	"*.pyc",
	"__pycache__/",
	".next/",
	".nuxt/",
	"target/",
	".gradle/",
	".idea/",
	".vscode/",
	"*.swp",
	"*.swo",
	"*.png",
	"*.jpg",
	"*.jpeg",
	"*.gif",
	"*.bmp",
	"*.ico",
	"*.webp",
	"*.svg",
	"*.mp4",
	"*.mov",
	"*.avi",
	"*.mkv",
	"*.webm",
	"*.mp3",
	"*.wav",
	"*.flac",
	"*.ogg",
	"*.zip",
	"*.tar",
	"*.gz",
	"*.bz2",
	"*.7z",
	"*.rar",
	"*.woff",
	"*.woff2",
	"*.ttf",
	"*.eot",
	"*.otf",
	"*.pdf",
	"*.doc",
	"*.docx",
	"*.xls",
	"*.xlsx",
	"*.ppt",
	"*.pptx",
	"*.exe",
	"*.dll",
	"*.so",
	"*.dylib",
	"*.wasm",
	"*.sqlite",
	"*.db",
];

interface ScanContext {
	totalSize: number;
	fileCount: number;
	limitReached: boolean;
}

function fnv1a(data: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < data.length; i++) {
		hash ^= data.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash.toString(16).padStart(8, "0");
}

export function computeProjectHash(projectRoot: string): string {
	return fnv1a(projectRoot);
}

export class InternalGit {
	private readonly objectsDir: string;
	private readonly metadataDir: string;

	constructor(storeDir: string) {
		this.objectsDir = join(storeDir, "objects");
		this.metadataDir = join(storeDir, METADATA_DIR);
		mkdirSync(this.objectsDir, { recursive: true });
		mkdirSync(this.metadataDir, { recursive: true });
	}

	writeObject(content: string, type: "file" | "tree" = "file"): string {
		const hash = fnv1a(content);
		const file = join(this.objectsDir, hash.slice(0, 2), hash.slice(2));
		const now = Date.now();
		if (!existsSync(file)) {
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content, "utf-8");
			this.saveMetadata(hash, {
				hash,
				size: content.length,
				createdAt: now,
				accessedAt: now,
				type,
			});
		} else {
			this.updateAccessTime(hash, now);
		}
		return hash;
	}

	private saveMetadata(hash: string, metadata: ObjectMetadata): void {
		const file = join(this.metadataDir, hash.slice(0, 2), hash.slice(2));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(metadata), "utf-8");
	}

	private updateAccessTime(hash: string, timestamp = Date.now()): void {
		const metadata = this.loadMetadata(hash);
		if (!metadata) return;
		this.saveMetadata(hash, { ...metadata, accessedAt: timestamp });
	}

	private loadMetadata(hash: string): ObjectMetadata | null {
		try {
			return JSON.parse(
				readFileSync(join(this.metadataDir, hash.slice(0, 2), hash.slice(2)), "utf-8"),
			) as ObjectMetadata;
		} catch {
			return null;
		}
	}

	private deleteMetadata(hash: string): void {
		rmSync(join(this.metadataDir, hash.slice(0, 2), hash.slice(2)), { force: true });
	}

	private deleteObject(hash: string): void {
		rmSync(join(this.objectsDir, hash.slice(0, 2), hash.slice(2)), { force: true });
		this.deleteMetadata(hash);
	}

	readObject(hash: string): string {
		return readFileSync(join(this.objectsDir, hash.slice(0, 2), hash.slice(2)), "utf-8");
	}

	hasObject(hash: string): boolean {
		return existsSync(join(this.objectsDir, hash.slice(0, 2), hash.slice(2)));
	}

	scanWorkingDir(cwd: string): Map<string, string> {
		const ig = ignore().add(DEFAULT_IGNORE_PATTERNS);
		const gitignorePath = join(cwd, ".gitignore");
		if (existsSync(gitignorePath)) {
			try {
				ig.add(readFileSync(gitignorePath, "utf-8"));
			} catch {}
		}

		const result = new Map<string, string>();
		const maxDepth = existsSync(join(cwd, ".git")) ? Infinity : SCAN_MAX_DEPTH_NO_GIT;
		const ctx: ScanContext = { totalSize: 0, fileCount: 0, limitReached: false };
		this.scanDir(cwd, cwd, ig, result, 0, maxDepth, ctx);
		return result;
	}

	async scanWorkingDirAsync(cwd: string, fs: FileSystemCapability): Promise<Map<string, string>> {
		const ig = ignore().add(DEFAULT_IGNORE_PATTERNS);
		const gitignorePath = join(cwd, ".gitignore");
		if (await fs.exists(gitignorePath)) {
			try {
				ig.add(await fs.readFileText(gitignorePath));
			} catch {}
		}

		const result = new Map<string, string>();
		const maxDepth = (await fs.exists(join(cwd, ".git"))) ? Infinity : SCAN_MAX_DEPTH_NO_GIT;
		const ctx: ScanContext = { totalSize: 0, fileCount: 0, limitReached: false };
		await this.scanDirAsync(cwd, cwd, ig, result, 0, maxDepth, ctx, fs);
		return result;
	}

	private scanDir(
		dir: string,
		root: string,
		ig: ReturnType<typeof ignore>,
		result: Map<string, string>,
		depth: number,
		maxDepth: number,
		ctx: ScanContext,
	): void {
		if (ctx.limitReached || depth > maxDepth) return;

		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (ctx.limitReached) return;

			const fullPath = join(dir, entry.name.toString());
			const relPath = relative(root, fullPath);
			if (entry.isDirectory()) {
				if (ig.ignores(`${relPath}/`)) continue;
				this.scanDir(fullPath, root, ig, result, depth + 1, maxDepth, ctx);
				continue;
			}

			if (!entry.isFile() || ig.ignores(relPath) || ctx.fileCount >= SCAN_MAX_FILE_COUNT) {
				if (ctx.fileCount >= SCAN_MAX_FILE_COUNT) ctx.limitReached = true;
				continue;
			}

			try {
				const stat = statSync(fullPath);
				if (stat.size > MAX_FILE_SIZE) continue;
				if (ctx.totalSize + stat.size > SCAN_MAX_TOTAL_SIZE) {
					ctx.limitReached = true;
					return;
				}
				result.set(relPath, readFileSync(fullPath, "utf-8"));
				ctx.totalSize += stat.size;
				ctx.fileCount++;
			} catch {}
		}
	}

	private async scanDirAsync(
		dir: string,
		root: string,
		ig: ReturnType<typeof ignore>,
		result: Map<string, string>,
		depth: number,
		maxDepth: number,
		ctx: ScanContext,
		fs: FileSystemCapability,
	): Promise<void> {
		if (ctx.limitReached || depth > maxDepth) return;

		let entries: FileSystemDirent[];
		try {
			entries = await fs.readdirWithTypes(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (ctx.limitReached) return;

			const fullPath = join(dir, entry.name.toString());
			const relPath = relative(root, fullPath);
			if (entry.isDirectory()) {
				if (ig.ignores(`${relPath}/`)) continue;
				await this.scanDirAsync(fullPath, root, ig, result, depth + 1, maxDepth, ctx, fs);
				continue;
			}

			if (!entry.isFile() || ig.ignores(relPath) || ctx.fileCount >= SCAN_MAX_FILE_COUNT) {
				if (ctx.fileCount >= SCAN_MAX_FILE_COUNT) ctx.limitReached = true;
				continue;
			}

			try {
				const stat = await fs.stat(fullPath);
				if (stat.size > MAX_FILE_SIZE) continue;
				if (ctx.totalSize + stat.size > SCAN_MAX_TOTAL_SIZE) {
					ctx.limitReached = true;
					return;
				}
				result.set(relPath, await fs.readFileText(fullPath));
				ctx.totalSize += stat.size;
				ctx.fileCount++;
			} catch {}
		}
	}

	writeTree(files: Map<string, string>): TreeSnapshot {
		const entries = new Map<string, TreeEntry>();
		for (const [path, content] of files) {
			const hash = this.writeObject(content, "file");
			entries.set(path, { path, hash });
		}
		const treeData = [...entries.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([path, entry]) => `${path}\0${entry.hash}`)
			.join("\n");
		const treeHash = this.writeObject(treeData, "tree");
		return { treeHash, entries };
	}

	readTree(treeHash: string): Map<string, string> | null {
		if (!this.hasObject(treeHash)) return null;
		const files = new Map<string, string>();
		for (const line of this.readObject(treeHash).split("\n")) {
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

	/**
	 * Returns a Map of file paths to file content hashes from a tree, without
	 * reading the actual file contents. Useful when only the file listing or
	 * hash comparison is needed.
	 * Disk IO: 1 tree read, 0 file content reads.
	 */
	listTreeFiles(treeHash: string): Map<string, string> | null {
		if (!this.hasObject(treeHash)) return null;
		const files = new Map<string, string>();
		for (const line of this.readObject(treeHash).split("\n")) {
			if (!line) continue;
			const sep = line.indexOf("\0");
			if (sep === -1) continue;
			files.set(line.slice(0, sep), line.slice(sep + 1));
		}
		return files;
	}

	/**
	 * Like readTree but only reads file contents for paths in the `wanted` set.
	 * Skips reading file objects for paths not in the set, reducing disk IO
	 * from O(N) to O(M) where M = |wanted|.
	 */
	readTreeFiles(treeHash: string, wanted: Set<string>): Map<string, string> | null {
		if (!this.hasObject(treeHash)) return null;
		if (wanted.size === 0) return new Map();
		const files = new Map<string, string>();
		for (const line of this.readObject(treeHash).split("\n")) {
			if (!line) continue;
			const sep = line.indexOf("\0");
			if (sep === -1) continue;
			const path = line.slice(0, sep);
			if (!wanted.has(path)) continue;
			const hash = line.slice(sep + 1);
			if (this.hasObject(hash)) {
				files.set(path, this.readObject(hash));
			}
		}
		return files;
	}

	computeDiff(oldEntries: Map<string, TreeEntry>, newEntries: Map<string, TreeEntry>): StepDiff {
		const added: string[] = [];
		const modified: string[] = [];
		const deleted: string[] = [];

		for (const [path, entry] of newEntries) {
			const old = oldEntries.get(path);
			if (!old) {
				added.push(path);
			} else if (old.hash !== entry.hash) {
				modified.push(path);
			}
		}

		for (const path of oldEntries.keys()) {
			if (!newEntries.has(path)) {
				deleted.push(path);
			}
		}

		return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
	}

	diffTrees(baselineHash: string, snapshotHash: string): StepDiff {
		return this.computeDiff(
			this.parseTreeEntries(this.readObject(baselineHash)),
			this.parseTreeEntries(this.readObject(snapshotHash)),
		);
	}

	private parseTreeEntries(treeData: string): Map<string, TreeEntry> {
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

	hashContent(content: string): string {
		return fnv1a(content);
	}

	async gc(activeTreeHashes: Set<string>): Promise<GCResult> {
		const result: GCResult = { deletedObjects: 0, freedBytes: 0, deletedHashes: [] };
		const allObjects = this.scanAllObjects();
		const allTreeHashes = new Set<string>();

		for (const object of allObjects) {
			if (object.type === "tree") {
				allTreeHashes.add(object.hash);
			}
		}

		const referencedHashes = new Set<string>([...allTreeHashes, ...activeTreeHashes]);
		const toScan = [...referencedHashes];
		while (toScan.length > 0) {
			const treeHash = toScan.shift();
			if (!treeHash || !this.hasObject(treeHash)) continue;
			const treeData = this.readObject(treeHash);
			for (const line of treeData.split("\n")) {
				if (!line) continue;
				const sep = line.indexOf("\0");
				if (sep === -1) continue;
				const hash = line.slice(sep + 1);
				if (referencedHashes.has(hash) || !this.hasObject(hash)) continue;
				referencedHashes.add(hash);
				if (this.loadMetadata(hash)?.type === "tree") {
					toScan.push(hash);
				}
			}
		}

		for (const object of allObjects) {
			if (referencedHashes.has(object.hash)) continue;
			this.deleteObject(object.hash);
			result.deletedObjects++;
			result.freedBytes += object.size;
			result.deletedHashes.push(object.hash);
		}

		return result;
	}

	scanAllObjects(): ObjectMetadata[] {
		const objects: ObjectMetadata[] = [];
		try {
			const prefixDirs = readdirSync(this.objectsDir, { withFileTypes: true });
			for (const prefixDir of prefixDirs) {
				if (!prefixDir.isDirectory()) continue;
				const prefix = prefixDir.name.toString();
				const suffixFiles = readdirSync(join(this.objectsDir, prefix), { withFileTypes: true });
				for (const suffixFile of suffixFiles) {
					if (!suffixFile.isFile()) continue;
					const metadata = this.loadMetadata(prefix + suffixFile.name.toString());
					if (metadata) {
						objects.push(metadata);
					}
				}
			}
		} catch {}
		return objects;
	}

	async pruneOldObjects(
		maxAgeMs = 30 * 24 * 60 * 60 * 1000,
		activeTreeHashes: Set<string> = new Set(),
	): Promise<GCResult> {
		const cutoff = Date.now() - maxAgeMs;
		const result: GCResult = { deletedObjects: 0, freedBytes: 0, deletedHashes: [] };
		const allObjects = this.scanAllObjects();
		const protectedHashes = new Set<string>(activeTreeHashes);

		for (const object of allObjects) {
			if (object.type === "tree") {
				protectedHashes.add(object.hash);
			}
		}

		for (const object of allObjects) {
			if (object.type !== "tree") continue;
			const treeData = this.readObject(object.hash);
			for (const line of treeData.split("\n")) {
				if (!line) continue;
				const sep = line.indexOf("\0");
				if (sep === -1) continue;
				protectedHashes.add(line.slice(sep + 1));
			}
		}

		for (const object of allObjects) {
			if (protectedHashes.has(object.hash) || object.createdAt >= cutoff) continue;
			this.deleteObject(object.hash);
			result.deletedObjects++;
			result.freedBytes += object.size;
			result.deletedHashes.push(object.hash);
		}

		return result;
	}

	getStoreSize(): number {
		let size = 0;
		try {
			const prefixDirs = readdirSync(this.objectsDir, { withFileTypes: true });
			for (const prefixDir of prefixDirs) {
				if (!prefixDir.isDirectory()) continue;
				const prefix = prefixDir.name.toString();
				const suffixFiles = readdirSync(join(this.objectsDir, prefix), { withFileTypes: true });
				for (const suffixFile of suffixFiles) {
					if (!suffixFile.isFile()) continue;
					try {
						size += statSync(join(this.objectsDir, prefix, suffixFile.name.toString())).size;
					} catch {}
				}
			}
		} catch {}
		return size;
	}

	async enforceLimit(maxBytes = 100 * 1024 * 1024, activeTreeHashes: Set<string> = new Set()): Promise<GCResult> {
		if (this.getStoreSize() <= maxBytes) {
			return { deletedObjects: 0, freedBytes: 0, deletedHashes: [] };
		}

		const result: GCResult = { deletedObjects: 0, freedBytes: 0, deletedHashes: [] };
		for (const maxAgeMs of [7 * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000]) {
			if (this.getStoreSize() <= maxBytes) break;
			const pruned = await this.pruneOldObjects(maxAgeMs, activeTreeHashes);
			result.deletedObjects += pruned.deletedObjects;
			result.freedBytes += pruned.freedBytes;
			result.deletedHashes.push(...pruned.deletedHashes);
		}
		if (this.getStoreSize() > maxBytes) {
			const collected = await this.gc(activeTreeHashes);
			result.deletedObjects += collected.deletedObjects;
			result.freedBytes += collected.freedBytes;
			result.deletedHashes.push(...collected.deletedHashes);
		}
		return result;
	}

	getStats(): { totalObjects: number; totalBytes: number; treeObjects: number; fileObjects: number } {
		const objects = this.scanAllObjects();
		return {
			totalObjects: objects.length,
			totalBytes: objects.reduce((sum, object) => sum + object.size, 0),
			treeObjects: objects.filter((object) => object.type === "tree").length,
			fileObjects: objects.filter((object) => object.type === "file").length,
		};
	}

	rm(path: string): void {
		rmSync(path, { force: true });
	}

	static createForProject(storeRoot: string, projectRoot: string): InternalGit {
		const storeDir = join(storeRoot, computeProjectHash(projectRoot));
		mkdirSync(storeDir, { recursive: true });
		return new InternalGit(storeDir);
	}
}
