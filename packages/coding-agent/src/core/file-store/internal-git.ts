import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
			const hash = this.writeObject(content);
			entries.set(path, { path, hash });
		}
		const sorted = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
		const treeData = sorted.map(([path, entry]) => `${path}\0${entry.hash}`).join("\n");
		const treeHash = this.writeObject(treeData);
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

	static createForProject(storeRoot: string, projectRoot: string): InternalGit {
		const projectHash = computeProjectHash(projectRoot);
		const storeDir = join(storeRoot, projectHash);
		mkdirSync(storeDir, { recursive: true });
		return new InternalGit(storeDir);
	}
}
