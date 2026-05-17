import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ignore from "ignore";

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
	createdAt: number; // Unix timestamp
	accessedAt: number; // Last access time
	type: "file" | "tree";
}

export interface GCResult {
	deletedObjects: number;
	freedBytes: number;
	deletedHashes: string[];
}

const METADATA_DIR = "metadata";

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
];

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
		const prefix = hash.slice(0, 2);
		const suffix = hash.slice(2);
		const dir = join(this.objectsDir, prefix);
		const file = join(dir, suffix);
		const now = Date.now();

		if (!existsSync(file)) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(file, content, "utf-8");

			// Save metadata
			const metadata: ObjectMetadata = {
				hash,
				size: content.length,
				createdAt: now,
				accessedAt: now,
				type,
			};
			this.saveMetadata(hash, metadata);
		} else {
			// Update access time on existing objects
			this.updateAccessTime(hash, now);
		}

		return hash;
	}

	private saveMetadata(hash: string, metadata: ObjectMetadata): void {
		const prefix = hash.slice(0, 2);
		const suffix = hash.slice(2);
		const metaFile = join(this.metadataDir, prefix, suffix);
		mkdirSync(join(metaFile, ".."), { recursive: true });
		writeFileSync(metaFile, JSON.stringify(metadata), "utf-8");
	}

	private updateAccessTime(hash: string, timestamp: number = Date.now()): void {
		const meta = this.loadMetadata(hash);
		if (meta) {
			meta.accessedAt = timestamp;
			this.saveMetadata(hash, meta);
		}
	}

	private loadMetadata(hash: string): ObjectMetadata | null {
		const prefix = hash.slice(0, 2);
		const suffix = hash.slice(2);
		const metaFile = join(this.metadataDir, prefix, suffix);
		try {
			const data = readFileSync(metaFile, "utf-8");
			return JSON.parse(data) as ObjectMetadata;
		} catch {
			return null;
		}
	}

	private deleteMetadata(hash: string): void {
		const prefix = hash.slice(0, 2);
		const suffix = hash.slice(2);
		const metaFile = join(this.metadataDir, prefix, suffix);
		try {
			rmSync(metaFile, { force: true });
		} catch {
			// Ignore errors
		}
	}

	private deleteObject(hash: string): void {
		const prefix = hash.slice(0, 2);
		const suffix = hash.slice(2);
		const file = join(this.objectsDir, prefix, suffix);
		try {
			rmSync(file, { force: true });
		} catch {
			// Ignore errors
		}
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
		this.scanDir(cwd, cwd, ig, result);
		return result;
	}

	private scanDir(dir: string, root: string, ig: ReturnType<typeof ignore>, result: Map<string, string>): void {
		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = join(dir, entry.name.toString());
			const relPath = relative(root, fullPath);

			if (entry.isDirectory()) {
				if (ig.ignores(`${relPath}/`)) continue;
				this.scanDir(fullPath, root, ig, result);
			} else if (entry.isFile()) {
				if (ig.ignores(relPath)) continue;
				try {
					const content = readFileSync(fullPath, "utf-8");
					result.set(relPath, content);
				} catch {}
			}
		}
	}

	writeTree(files: Map<string, string>): TreeSnapshot {
		const entries = new Map<string, TreeEntry>();
		for (const [path, content] of files) {
			const hash = this.writeObject(content, "file");
			entries.set(path, { path, hash });
		}
		const sorted = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
		const treeData = sorted.map(([path, entry]) => `${path}\0${entry.hash}`).join("\n");
		const treeHash = this.writeObject(treeData, "tree");
		return { treeHash, entries };
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

		for (const [path] of oldEntries) {
			if (!newEntries.has(path)) {
				deleted.push(path);
			}
		}

		return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
	}

	diffTrees(baselineHash: string, snapshotHash: string): StepDiff {
		const baselineData = this.readObject(baselineHash);
		const snapshotData = this.readObject(snapshotHash);

		const baselineEntries = this.parseTreeEntries(baselineData);
		const snapshotEntries = this.parseTreeEntries(snapshotData);

		return this.computeDiff(baselineEntries, snapshotEntries);
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

	/**
	 * Garbage collection: remove objects that are not referenced by any active tree
	 */
	async gc(activeTreeHashes: Set<string>): Promise<GCResult> {
		const result: GCResult = {
			deletedObjects: 0,
			freedBytes: 0,
			deletedHashes: [],
		};

		// Collect all referenced objects (files and trees)
		const referencedHashes = new Set<string>(activeTreeHashes);
		const toScan = [...activeTreeHashes];

		while (toScan.length > 0) {
			const treeHash = toScan.shift()!;
			const treeData = this.readObject(treeHash);

			// Parse tree to find referenced file objects
			for (const line of treeData.split("\n")) {
				if (!line) continue;
				const sep = line.indexOf("\0");
				if (sep === -1) continue;
				const hash = line.slice(sep + 1);
				if (!referencedHashes.has(hash) && this.hasObject(hash)) {
					referencedHashes.add(hash);
					// If it's a tree (not a file), scan it too
					const meta = this.loadMetadata(hash);
					if (meta?.type === "tree") {
						toScan.push(hash);
					}
				}
			}
		}

		// Scan all objects and delete unreferenced ones
		const allObjects = this.scanAllObjects();
		for (const obj of allObjects) {
			if (!referencedHashes.has(obj.hash)) {
				this.deleteObject(obj.hash);
				result.deletedObjects++;
				result.freedBytes += obj.size;
				result.deletedHashes.push(obj.hash);
			}
		}

		return result;
	}

	/**
	 * Scan all objects in the store with their metadata
	 */
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

					const hash = prefix + suffixFile.name.toString();
					const meta = this.loadMetadata(hash);
					if (meta) {
						objects.push(meta);
					}
				}
			}
		} catch {
			// Ignore errors
		}

		return objects;
	}

	/**
	 * Prune objects older than maxAge that are not referenced
	 */
	async pruneOldObjects(
		maxAgeMs: number = 30 * 24 * 60 * 60 * 1000,
		activeTreeHashes: Set<string> = new Set(),
	): Promise<GCResult> {
		const cutoff = Date.now() - maxAgeMs;
		const result: GCResult = {
			deletedObjects: 0,
			freedBytes: 0,
			deletedHashes: [],
		};

		const allObjects = this.scanAllObjects();
		for (const obj of allObjects) {
			// Skip if referenced by active trees
			if (activeTreeHashes.has(obj.hash)) continue;

			if (obj.createdAt < cutoff) {
				this.deleteObject(obj.hash);
				result.deletedObjects++;
				result.freedBytes += obj.size;
				result.deletedHashes.push(obj.hash);
			}
		}

		return result;
	}

	/**
	 * Get total store size in bytes
	 */
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
						const filePath = join(this.objectsDir, prefix, suffixFile.name.toString());
						size += statSync(filePath).size;
					} catch {
						// Ignore errors
					}
				}
			}
		} catch {
			// Ignore errors
		}

		return size;
	}

	/**
	 * Enforce disk space limit by pruning old objects and running GC
	 */
	async enforceLimit(
		maxBytes: number = 100 * 1024 * 1024,
		activeTreeHashes: Set<string> = new Set(),
	): Promise<GCResult> {
		const currentSize = this.getStoreSize();

		if (currentSize <= maxBytes) {
			return { deletedObjects: 0, freedBytes: 0, deletedHashes: [] };
		}

		const totalResult: GCResult = {
			deletedObjects: 0,
			freedBytes: 0,
			deletedHashes: [],
		};

		// Strategy 1: Prune objects older than 7 days
		if (currentSize > maxBytes) {
			const result1 = await this.pruneOldObjects(7 * 24 * 60 * 60 * 1000, activeTreeHashes);
			totalResult.deletedObjects += result1.deletedObjects;
			totalResult.freedBytes += result1.freedBytes;
			totalResult.deletedHashes.push(...result1.deletedHashes);
		}

		// Strategy 2: Prune objects older than 1 day
		if (this.getStoreSize() > maxBytes) {
			const result2 = await this.pruneOldObjects(24 * 60 * 60 * 1000, activeTreeHashes);
			totalResult.deletedObjects += result2.deletedObjects;
			totalResult.freedBytes += result2.freedBytes;
			totalResult.deletedHashes.push(...result2.deletedHashes);
		}

		// Strategy 3: Run full GC
		if (this.getStoreSize() > maxBytes) {
			const result3 = await this.gc(activeTreeHashes);
			totalResult.deletedObjects += result3.deletedObjects;
			totalResult.freedBytes += result3.freedBytes;
			totalResult.deletedHashes.push(...result3.deletedHashes);
		}

		return totalResult;
	}

	/**
	 * Get store statistics
	 */
	getStats(): {
		totalObjects: number;
		totalBytes: number;
		treeObjects: number;
		fileObjects: number;
	} {
		const objects = this.scanAllObjects();
		const totalBytes = objects.reduce((sum, obj) => sum + obj.size, 0);
		const treeObjects = objects.filter((obj) => obj.type === "tree").length;
		const fileObjects = objects.filter((obj) => obj.type === "file").length;

		return {
			totalObjects: objects.length,
			totalBytes,
			treeObjects,
			fileObjects,
		};
	}

	static createForProject(storeRoot: string, projectRoot: string): InternalGit {
		const projectHash = computeProjectHash(projectRoot);
		const storeDir = join(storeRoot, projectHash);
		mkdirSync(storeDir, { recursive: true });
		return new InternalGit(storeDir);
	}
}
