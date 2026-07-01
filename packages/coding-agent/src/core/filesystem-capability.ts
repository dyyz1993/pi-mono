import { mkdir, readFile, readdir, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface FileSystemDirent {
	name: string;
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}

export interface FileSystemStat {
	size: number;
	mtimeMs: number;
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}

export interface FileSystemReadBatchResult {
	path: string;
	content: Buffer | null;
	error?: string;
}

export interface FileSystemWalkOptions {
	maxDepth?: number;
	ignore?: readonly string[];
	maxFiles?: number;
	maxSize?: number;
}

export interface FileSystemWalkEntry {
	path: string;
	size: number;
	type: "file" | "directory" | "symlink";
}

export interface FileSystemWalkResult {
	entries: FileSystemWalkEntry[];
	limitReached?: boolean;
}

/**
 * Workspace filesystem capability exposed to extensions as ctx.fs.
 *
 * Local sessions use node:fs. Remote/sandbox sessions can replace this with a
 * routed implementation so extensions do not silently touch the wrong disk.
 */
export interface FileSystemCapability {
	readFile(path: string): Promise<Buffer>;
	readFileText(path: string): Promise<string>;
	writeFile(path: string, content: string | Buffer): Promise<void>;
	mkdir(path: string): Promise<void>;
	delete(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	stat(path: string): Promise<FileSystemStat>;
	readdir(path: string): Promise<string[]>;
	readdirWithTypes(path: string): Promise<FileSystemDirent[]>;
	walk(path: string, options?: FileSystemWalkOptions): Promise<FileSystemWalkResult>;
	readBatch(paths: readonly string[]): Promise<FileSystemReadBatchResult[]>;
}

export function createLocalFileSystemCapability(): FileSystemCapability {
	return {
		readFile: (path) => readFile(path),
		readFileText: (path) => readFile(path, "utf-8"),
		async writeFile(path, content) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content);
		},
		mkdir: (path) => mkdir(path, { recursive: true }).then(() => {}),
		delete: (path) => rm(path, { recursive: true, force: true }),
		async exists(path) {
			try {
				await fsStat(path);
				return true;
			} catch {
				return false;
			}
		},
		stat: (path) => fsStat(path),
		readdir: (path) => readdir(path),
		readdirWithTypes: (path) => readdir(path, { withFileTypes: true }),
		async walk(path, options) {
			const entries: FileSystemWalkEntry[] = [];
			let totalSize = 0;
			let limitReached = false;
			const maxDepth = options?.maxDepth ?? Infinity;
			const maxFiles = options?.maxFiles ?? Infinity;
			const maxSize = options?.maxSize ?? Infinity;
			const ignored = options?.ignore ?? [];

			const isIgnored = (entryPath: string) => ignored.some((pattern) => entryPath.includes(pattern));
			const visit = async (currentPath: string, depth: number): Promise<void> => {
				if (limitReached || depth > maxDepth) return;
				let dirents: FileSystemDirent[];
				try {
					dirents = await readdir(currentPath, { withFileTypes: true });
				} catch {
					return;
				}

				for (const dirent of dirents) {
					if (limitReached) return;
					const childPath = `${currentPath.replace(/\/$/, "")}/${dirent.name}`;
					if (isIgnored(childPath)) continue;
					const childStat = await fsStat(childPath).catch(() => null);
					const size = childStat?.size ?? 0;
					const type = dirent.isSymbolicLink() ? "symlink" : dirent.isDirectory() ? "directory" : "file";
					entries.push({ path: childPath, size, type });
					if (dirent.isFile()) {
						totalSize += size;
						if (entries.filter((entry) => entry.type === "file").length >= maxFiles || totalSize >= maxSize) {
							limitReached = true;
							return;
						}
					}
					if (dirent.isDirectory()) {
						await visit(childPath, depth + 1);
					}
				}
			};

			await visit(path, 0);
			return { entries, limitReached };
		},
		async readBatch(paths) {
			return Promise.all(
				paths.map(async (path) => {
					try {
						return { path, content: await readFile(path) };
					} catch (error) {
						return { path, content: null, error: error instanceof Error ? error.message : String(error) };
					}
				}),
			);
		},
	};
}
