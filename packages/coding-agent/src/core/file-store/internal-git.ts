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

	constructor(storeDir: string) {
		this.objectsDir = join(storeDir, "objects");
		mkdirSync(this.objectsDir, { recursive: true });
	}

	writeObject(content: string): string {
		const hash = fnv1a(content);
		const file = join(this.objectsDir, hash.slice(0, 2), hash.slice(2));
		if (!existsSync(file)) {
			mkdirSync(dirname(file), { recursive: true });
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

	writeTree(files: Map<string, string>): TreeSnapshot {
		const entries = new Map<string, TreeEntry>();
		for (const [path, content] of files) {
			const hash = this.writeObject(content);
			entries.set(path, { path, hash });
		}
		const treeData = [...entries.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([path, entry]) => `${path}\0${entry.hash}`)
			.join("\n");
		const treeHash = this.writeObject(treeData);
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

	hashContent(content: string): string {
		return fnv1a(content);
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
