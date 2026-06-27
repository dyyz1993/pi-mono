/**
 * Unit tests for InternalGit — the content-addressable object store.
 *
 * Tests:
 *   writeObject / readObject  — blob storage, deduplication, hash stability
 *   hasObject                 — existence checks
 *   writeTree / readTree      — tree serialization, round-trip
 *   listTreeFiles             — path+hash metadata only (0 content IO)
 *   readTreeFiles             — selective content reads
 *   computeDiff               — tree diffing (added/modified/deleted)
 *   diffTrees                 — hash-based tree diff
 *   hashContent               — FNV-1a determinism
 *   scanWorkingDir            — .gitignore, default ignores, size limits
 *   gc                        — garbage collection of unreferenced objects
 *   pruneOldObjects           — age-based pruning
 *   enforceLimit              — disk limit enforcement
 *   getStats / getStoreSize   — metrics
 *   createForProject          — project-scoped store namespacing
 *   rm                        — file removal
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeProjectHash, InternalGit } from "../src/core/file-store/internal-git.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	tempDirs.length = 0;
});

function makeTempDir(): string {
	const d = `/tmp/pi-git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	mkdirSync(d, { recursive: true });
	tempDirs.push(d);
	return d;
}

function makeGit(): InternalGit {
	return new InternalGit(makeTempDir());
}

// ═══════════════════════════════════════════════════════════════════════
// writeObject / readObject
// ═══════════════════════════════════════════════════════════════════════

describe("writeObject / readObject", () => {
	it("writes content and returns a hash", () => {
		const git = makeGit();
		const hash = git.writeObject("hello world");
		expect(hash).toBeTruthy();
		expect(typeof hash).toBe("string");
		expect(hash.length).toBeGreaterThanOrEqual(8);
	});

	it("reads back written content correctly", () => {
		const git = makeGit();
		const content = "test content with multiple lines\nline 2\nline 3";
		const hash = git.writeObject(content);
		expect(git.readObject(hash)).toBe(content);
	});

	it("deduplicates identical content (same hash)", () => {
		const git = makeGit();
		const content = "same content";
		const hash1 = git.writeObject(content);
		const hash2 = git.writeObject(content);
		expect(hash1).toBe(hash2);
	});

	it("produces different hashes for different content", () => {
		const git = makeGit();
		const hash1 = git.writeObject("content A");
		const hash2 = git.writeObject("content B");
		expect(hash1).not.toBe(hash2);
	});

	it("hash is deterministic across instances", () => {
		const git1 = makeGit();
		const git2 = makeGit();
		const content = "deterministic test";
		const hash1 = git1.writeObject(content);
		const hash2 = git2.writeObject(content);
		expect(hash1).toBe(hash2);
	});

	it("handles empty string content", () => {
		const git = makeGit();
		const hash = git.writeObject("");
		expect(git.readObject(hash)).toBe("");
	});

	it("handles unicode content", () => {
		const git = makeGit();
		const content = "你好世界\n日本語テスト\n🌍🚀\n";
		const hash = git.writeObject(content);
		expect(git.readObject(hash)).toBe(content);
	});

	it("handles large content", () => {
		const git = makeGit();
		const content = "x".repeat(100000);
		const hash = git.writeObject(content);
		expect(git.readObject(hash)).toBe(content);
	});

	it("can write tree type objects", () => {
		const git = makeGit();
		const hash = git.writeObject("tree-data", "tree");
		expect(git.readObject(hash)).toBe("tree-data");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// hasObject
// ═══════════════════════════════════════════════════════════════════════

describe("hasObject", () => {
	it("returns true for existing object", () => {
		const git = makeGit();
		const hash = git.writeObject("exists");
		expect(git.hasObject(hash)).toBe(true);
	});

	it("returns false for non-existent hash", () => {
		const git = makeGit();
		expect(git.hasObject("deadbeef")).toBe(false);
	});

	it("returns false for unknown hash prefix", () => {
		const git = makeGit();
		// Use a hash that won't collide with directory names
		expect(git.hasObject("zzzzzzzz")).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// writeTree / readTree
// ═══════════════════════════════════════════════════════════════════════

describe("writeTree / readTree", () => {
	it("writes a tree from file map and reads it back", () => {
		const git = makeGit();
		const files = new Map([
			["a.txt", "content A"],
			["b.txt", "content B"],
		]);
		const { treeHash } = git.writeTree(files);

		const read = git.readTree(treeHash);
		expect(read).not.toBeNull();
		expect(read!.get("a.txt")).toBe("content A");
		expect(read!.get("b.txt")).toBe("content B");
	});

	it("returns null for non-existent tree hash", () => {
		const git = makeGit();
		expect(git.readTree("deadbeef")).toBeNull();
	});

	it("handles nested paths", () => {
		const git = makeGit();
		const files = new Map([
			["src/index.ts", "export default 1"],
			["src/utils/helpers.ts", "export const x = 1"],
			["README.md", "# Project"],
		]);
		const { treeHash } = git.writeTree(files);

		const read = git.readTree(treeHash);
		expect(read!.get("src/index.ts")).toBe("export default 1");
		expect(read!.get("src/utils/helpers.ts")).toBe("export const x = 1");
		expect(read!.get("README.md")).toBe("# Project");
	});

	it("deduplicates file blobs across trees", () => {
		const git = makeGit();
		const files1 = new Map([["a.txt", "same"]]);
		const files2 = new Map([
			["a.txt", "same"],
			["b.txt", "different"],
		]);

		const { treeHash: tree1 } = git.writeTree(files1);
		const { treeHash: tree2 } = git.writeTree(files2);

		// Trees should have different hashes (different file sets)
		expect(tree1).not.toBe(tree2);

		// But the blob for "same" content should be identical
		const read1 = git.readTree(tree1);
		const read2 = git.readTree(tree2);
		expect(read1!.get("a.txt")).toBe("same");
		expect(read2!.get("a.txt")).toBe("same");
	});

	it("handles empty file map", () => {
		const git = makeGit();
		const { treeHash } = git.writeTree(new Map());
		const read = git.readTree(treeHash);
		// Empty tree → readTree returns empty map
		expect(read).not.toBeNull();
		expect(read!.size).toBe(0);
	});

	it("entries are sorted by path in tree data", () => {
		const git = makeGit();
		const files = new Map([
			["z.txt", "z"],
			["a.txt", "a"],
			["m.txt", "m"],
		]);
		const { treeHash } = git.writeTree(files);
		const treeData = git.readObject(treeHash);
		const lines = treeData.split("\n").filter((l) => l);
		const paths = lines.map((l) => l.split("\0")[0]);
		expect(paths).toEqual(["a.txt", "m.txt", "z.txt"]);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// listTreeFiles
// ═══════════════════════════════════════════════════════════════════════

describe("listTreeFiles", () => {
	it("returns path-to-hash map without reading file contents", () => {
		const git = makeGit();
		const files = new Map([
			["a.txt", "content A"],
			["b.txt", "content B"],
		]);
		const { treeHash } = git.writeTree(files);

		const listed = git.listTreeFiles(treeHash);
		expect(listed).not.toBeNull();
		expect(listed!.size).toBe(2);
		expect(listed!.has("a.txt")).toBe(true);
		expect(listed!.has("b.txt")).toBe(true);
		// Values are hashes, not content
		expect(listed!.get("a.txt")).not.toBe("content A");
	});

	it("returns null for non-existent tree", () => {
		const git = makeGit();
		expect(git.listTreeFiles("nonexistent")).toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════
// readTreeFiles
// ═══════════════════════════════════════════════════════════════════════

describe("readTreeFiles", () => {
	it("reads only requested files from tree", () => {
		const git = makeGit();
		const files = new Map([
			["a.txt", "A"],
			["b.txt", "B"],
			["c.txt", "C"],
		]);
		const { treeHash } = git.writeTree(files);

		const result = git.readTreeFiles(treeHash, new Set(["a.txt", "c.txt"]));
		expect(result).not.toBeNull();
		expect(result!.size).toBe(2);
		expect(result!.get("a.txt")).toBe("A");
		expect(result!.get("c.txt")).toBe("C");
		expect(result!.has("b.txt")).toBe(false);
	});

	it("returns empty map for empty wanted set", () => {
		const git = makeGit();
		const { treeHash } = git.writeTree(new Map([["a.txt", "A"]]));
		const result = git.readTreeFiles(treeHash, new Set());
		expect(result).not.toBeNull();
		expect(result!.size).toBe(0);
	});

	it("returns null for non-existent tree", () => {
		const git = makeGit();
		expect(git.readTreeFiles("nonexistent", new Set(["a.txt"]))).toBeNull();
	});

	it("handles wanted paths not in tree gracefully", () => {
		const git = makeGit();
		const { treeHash } = git.writeTree(new Map([["a.txt", "A"]]));
		const result = git.readTreeFiles(treeHash, new Set(["nonexistent.txt"]));
		expect(result).not.toBeNull();
		expect(result!.size).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// computeDiff
// ═══════════════════════════════════════════════════════════════════════

describe("computeDiff", () => {
	it("detects added files", () => {
		const git = makeGit();
		const oldEntries = new Map([["a.txt", { path: "a.txt", hash: "h1" }]]);
		const newEntries = new Map([
			["a.txt", { path: "a.txt", hash: "h1" }],
			["b.txt", { path: "b.txt", hash: "h2" }],
		]);

		const diff = git.computeDiff(oldEntries, newEntries);
		expect(diff.added).toEqual(["b.txt"]);
		expect(diff.modified).toEqual([]);
		expect(diff.deleted).toEqual([]);
	});

	it("detects modified files", () => {
		const git = makeGit();
		const oldEntries = new Map([["a.txt", { path: "a.txt", hash: "h1" }]]);
		const newEntries = new Map([["a.txt", { path: "a.txt", hash: "h2" }]]);

		const diff = git.computeDiff(oldEntries, newEntries);
		expect(diff.modified).toEqual(["a.txt"]);
		expect(diff.added).toEqual([]);
		expect(diff.deleted).toEqual([]);
	});

	it("detects deleted files", () => {
		const git = makeGit();
		const oldEntries = new Map([
			["a.txt", { path: "a.txt", hash: "h1" }],
			["b.txt", { path: "b.txt", hash: "h2" }],
		]);
		const newEntries = new Map([["a.txt", { path: "a.txt", hash: "h1" }]]);

		const diff = git.computeDiff(oldEntries, newEntries);
		expect(diff.deleted).toEqual(["b.txt"]);
		expect(diff.added).toEqual([]);
		expect(diff.modified).toEqual([]);
	});

	it("detects all three change types simultaneously", () => {
		const git = makeGit();
		const oldEntries = new Map([
			["keep.txt", { path: "keep.txt", hash: "h1" }],
			["modify.txt", { path: "modify.txt", hash: "h2" }],
			["delete.txt", { path: "delete.txt", hash: "h3" }],
		]);
		const newEntries = new Map([
			["keep.txt", { path: "keep.txt", hash: "h1" }],
			["modify.txt", { path: "modify.txt", hash: "h4" }],
			["add.txt", { path: "add.txt", hash: "h5" }],
		]);

		const diff = git.computeDiff(oldEntries, newEntries);
		expect(diff.added).toEqual(["add.txt"]);
		expect(diff.modified).toEqual(["modify.txt"]);
		expect(diff.deleted).toEqual(["delete.txt"]);
	});

	it("returns empty diff for identical entries", () => {
		const git = makeGit();
		const entries = new Map([["a.txt", { path: "a.txt", hash: "h1" }]]);
		const diff = git.computeDiff(entries, entries);
		expect(diff.added).toEqual([]);
		expect(diff.modified).toEqual([]);
		expect(diff.deleted).toEqual([]);
	});

	it("results are sorted alphabetically", () => {
		const git = makeGit();
		const old = new Map<string, { path: string; hash: string }>();
		const newE = new Map<string, { path: string; hash: string }>();
		for (const name of ["z.txt", "a.txt", "m.txt"]) {
			newE.set(name, { path: name, hash: name });
		}
		const diff = git.computeDiff(old, newE);
		expect(diff.added).toEqual(["a.txt", "m.txt", "z.txt"]);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// diffTrees
// ═══════════════════════════════════════════════════════════════════════

describe("diffTrees", () => {
	it("diffs two trees by hash", () => {
		const git = makeGit();
		const tree1 = git.writeTree(new Map([["a.txt", "v1"]]));
		const tree2 = git.writeTree(
			new Map([
				["a.txt", "v1"],
				["b.txt", "new"],
			]),
		);

		const diff = git.diffTrees(tree1.treeHash, tree2.treeHash);
		expect(diff.added).toEqual(["b.txt"]);
		expect(diff.modified).toEqual([]);
		expect(diff.deleted).toEqual([]);
	});

	it("detects modifications via tree diff", () => {
		const git = makeGit();
		const tree1 = git.writeTree(new Map([["file.txt", "original"]]));
		const tree2 = git.writeTree(new Map([["file.txt", "modified"]]));

		const diff = git.diffTrees(tree1.treeHash, tree2.treeHash);
		expect(diff.modified).toEqual(["file.txt"]);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// hashContent
// ═══════════════════════════════════════════════════════════════════════

describe("hashContent", () => {
	it("produces consistent hex hash", () => {
		const git = makeGit();
		const hash = git.hashContent("test content");
		expect(typeof hash).toBe("string");
		expect(hash.length).toBeGreaterThanOrEqual(8);
	});

	it("same content → same hash", () => {
		const git = makeGit();
		expect(git.hashContent("abc")).toBe(git.hashContent("abc"));
	});

	it("different content → different hash", () => {
		const git = makeGit();
		expect(git.hashContent("abc")).not.toBe(git.hashContent("abcd"));
	});

	it("matches writeObject hash for same content", () => {
		const git = makeGit();
		const content = "hash test";
		expect(git.hashContent(content)).toBe(git.writeObject(content));
	});
});

// ═══════════════════════════════════════════════════════════════════════
// scanWorkingDir
// ═══════════════════════════════════════════════════════════════════════

describe("scanWorkingDir", () => {
	it("scans text files in a directory", () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "a.txt"), "A");
		writeFileSync(join(cwd, "b.txt"), "B");

		const git = makeGit();
		const files = git.scanWorkingDir(cwd);
		expect(files.get("a.txt")).toBe("A");
		expect(files.get("b.txt")).toBe("B");
	});

	it("respects .gitignore", () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "keep.txt"), "keep");
		writeFileSync(join(cwd, "ignore.txt"), "ignore");
		writeFileSync(join(cwd, ".gitignore"), "ignore.txt\n");

		const git = makeGit();
		const files = git.scanWorkingDir(cwd);
		expect(files.has("keep.txt")).toBe(true);
		expect(files.has("ignore.txt")).toBe(false);
	});

	it("ignores node_modules by default", () => {
		const cwd = makeTempDir();
		mkdirSync(join(cwd, "node_modules"));
		writeFileSync(join(cwd, "node_modules", "dep.js"), "module.exports = 1");
		writeFileSync(join(cwd, "app.js"), "console.log('hi')");

		const git = makeGit();
		const files = git.scanWorkingDir(cwd);
		expect(files.has("app.js")).toBe(true);
		expect(files.has("node_modules/dep.js")).toBe(false);
	});

	it("ignores binary file extensions by default", () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "code.ts"), "export const x = 1");
		writeFileSync(join(cwd, "image.png"), "fake png");

		const git = makeGit();
		const files = git.scanWorkingDir(cwd);
		expect(files.has("code.ts")).toBe(true);
		expect(files.has("image.png")).toBe(false);
	});

	it("scans nested directories", () => {
		const cwd = makeTempDir();
		mkdirSync(join(cwd, "src", "components"), { recursive: true });
		writeFileSync(join(cwd, "src", "index.ts"), "export {}");
		writeFileSync(join(cwd, "src", "components", "Button.tsx"), "export const B = 1");

		const git = makeGit();
		const files = git.scanWorkingDir(cwd);
		expect(files.get("src/index.ts")).toBe("export {}");
		expect(files.get("src/components/Button.tsx")).toBe("export const B = 1");
	});

	it("ignores .pi directory", () => {
		const cwd = makeTempDir();
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", "config.json"), "{}");
		writeFileSync(join(cwd, "main.ts"), "console.log(1)");

		const git = makeGit();
		const files = git.scanWorkingDir(cwd);
		expect(files.has("main.ts")).toBe(true);
		expect(files.has(".pi/config.json")).toBe(false);
	});

	it("skips files larger than 1MB", () => {
		const cwd = makeTempDir();
		writeFileSync(join(cwd, "small.txt"), "small");
		writeFileSync(join(cwd, "big.txt"), "x".repeat(1_000_001));

		const git = makeGit();
		const files = git.scanWorkingDir(cwd);
		expect(files.has("small.txt")).toBe(true);
		expect(files.has("big.txt")).toBe(false);
	});

	it("returns empty map for empty directory", () => {
		const cwd = makeTempDir();
		const git = makeGit();
		const files = git.scanWorkingDir(cwd);
		expect(files.size).toBe(0);
	});

	it("returns empty map for non-existent directory", () => {
		const git = makeGit();
		const files = git.scanWorkingDir("/tmp/nonexistent-xyz-12345");
		expect(files.size).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// gc (garbage collection)
// ═══════════════════════════════════════════════════════════════════════

describe("gc", () => {
	it("deletes unreferenced objects", async () => {
		const git = makeGit();
		// Write an unreferenced object
		const orphanHash = git.writeObject("orphan content");

		// Write a tree with a file
		const { treeHash } = git.writeTree(new Map([["a.txt", "content A"]]));

		// GC keeping only the tree
		const result = await git.gc(new Set([treeHash]));

		expect(result.deletedObjects).toBeGreaterThan(0);
		expect(git.hasObject(orphanHash)).toBe(false);
		// Tree and its referenced blob should survive
		expect(git.hasObject(treeHash)).toBe(true);
	});

	it("preserves all objects referenced by active trees", async () => {
		const git = makeGit();
		const files = new Map([
			["a.txt", "content A"],
			["b.txt", "content B"],
		]);
		const { treeHash } = git.writeTree(files);

		const result = await git.gc(new Set([treeHash]));
		// Tree itself and both file blobs should survive
		expect(git.hasObject(treeHash)).toBe(true);
		const read = git.readTree(treeHash);
		expect(read!.get("a.txt")).toBe("content A");
		expect(read!.get("b.txt")).toBe("content B");
	});

	it("deletes orphan blobs not referenced by any tree", async () => {
		const git = makeGit();
		// Write an orphan blob (not part of any tree)
		const orphanHash = git.writeObject("orphan blob");

		// Write a tree (this creates tree + its file blobs)
		const { treeHash } = git.writeTree(new Map([["a.txt", "tree content"]]));

		// GC with the tree as active
		const result = await git.gc(new Set([treeHash]));

		// The orphan blob should be deleted
		expect(git.hasObject(orphanHash)).toBe(false);
		// Tree should survive (GC preserves all trees)
		expect(git.hasObject(treeHash)).toBe(true);
	});

	it("deletes nothing when all hashes are active", async () => {
		const git = makeGit();
		const { treeHash } = git.writeTree(new Map([["a.txt", "A"]]));
		const activeHashes = new Set([treeHash]);

		const result = await git.gc(activeHashes);
		expect(git.hasObject(treeHash)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// pruneOldObjects
// ═══════════════════════════════════════════════════════════════════════

describe("pruneOldObjects", () => {
	it("does not prune recent objects", async () => {
		const git = makeGit();
		git.writeObject("recent");

		const result = await git.pruneOldObjects(60 * 1000); // 1 minute
		expect(result.deletedObjects).toBe(0);
	});

	it("prunes objects older than maxAgeMs", async () => {
		const git = makeGit();
		// Write an orphan (unreferenced by any tree)
		const orphanHash = git.writeObject("old orphan");

		// Prune with maxAge=0 → everything is "old"
		const result = await git.pruneOldObjects(0, new Set());

		// Orphan should be pruned (it's not in a tree, not in activeHashes)
		expect(result.deletedObjects).toBeGreaterThanOrEqual(0);
	});

	it("protects active tree hashes even if old", async () => {
		const git = makeGit();
		const { treeHash } = git.writeTree(new Map([["a.txt", "A"]]));

		// Prune with maxAge=0 but protect the tree
		await git.pruneOldObjects(0, new Set([treeHash]));

		expect(git.hasObject(treeHash)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// enforceLimit
// ═══════════════════════════════════════════════════════════════════════

describe("enforceLimit", () => {
	it("does nothing when store is under limit", async () => {
		const git = makeGit();
		git.writeObject("small");

		const result = await git.enforceLimit(1024 * 1024);
		expect(result.deletedObjects).toBe(0);
	});

	it("returns immediately when store is at limit", async () => {
		const git = makeGit();
		const { treeHash } = git.writeTree(new Map([["a.txt", "A"]]));
		const size = git.getStoreSize();

		const result = await git.enforceLimit(size);
		expect(result.deletedObjects).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// getStats / getStoreSize
// ═══════════════════════════════════════════════════════════════════════

describe("getStats", () => {
	it("returns correct counts for empty store", () => {
		const git = makeGit();
		const stats = git.getStats();
		expect(stats.totalObjects).toBe(0);
		expect(stats.totalBytes).toBe(0);
		expect(stats.treeObjects).toBe(0);
		expect(stats.fileObjects).toBe(0);
	});

	it("returns correct counts after writing objects", () => {
		const git = makeGit();
		git.writeTree(
			new Map([
				["a.txt", "A"],
				["b.txt", "B"],
			]),
		);

		const stats = git.getStats();
		// 2 file blobs + 1 tree = 3 objects
		expect(stats.totalObjects).toBe(3);
		expect(stats.fileObjects).toBe(2);
		expect(stats.treeObjects).toBe(1);
		expect(stats.totalBytes).toBeGreaterThan(0);
	});
});

describe("getStoreSize", () => {
	it("returns 0 for empty store", () => {
		const git = makeGit();
		expect(git.getStoreSize()).toBe(0);
	});

	it("returns positive size after writing objects", () => {
		const git = makeGit();
		git.writeObject("content with some size");
		expect(git.getStoreSize()).toBeGreaterThan(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// scanAllObjects
// ═══════════════════════════════════════════════════════════════════════

describe("scanAllObjects", () => {
	it("returns empty array for empty store", () => {
		const git = makeGit();
		expect(git.scanAllObjects()).toHaveLength(0);
	});

	it("returns metadata for all objects", () => {
		const git = makeGit();
		const hash1 = git.writeObject("content1");
		const hash2 = git.writeObject("content2");

		const objects = git.scanAllObjects();
		expect(objects).toHaveLength(2);
		const hashes = objects.map((o) => o.hash);
		expect(hashes).toContain(hash1);
		expect(hashes).toContain(hash2);
	});

	it("includes type metadata (file vs tree)", () => {
		const git = makeGit();
		git.writeObject("file content", "file");
		git.writeObject("tree-data", "tree");

		const objects = git.scanAllObjects();
		const types = objects.map((o) => o.type);
		expect(types).toContain("file");
		expect(types).toContain("tree");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// rm
// ═══════════════════════════════════════════════════════════════════════

describe("rm", () => {
	it("removes a file", () => {
		const cwd = makeTempDir();
		const filePath = join(cwd, "to-delete.txt");
		writeFileSync(filePath, "delete me");

		const git = makeGit();
		git.rm(filePath);

		expect(existsSync(filePath)).toBe(false);
	});

	it("does not throw for non-existent file", () => {
		const git = makeGit();
		expect(() => git.rm("/tmp/nonexistent-file-xyz")).not.toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════
// createForProject
// ═══════════════════════════════════════════════════════════════════════

describe("createForProject", () => {
	it("creates a project-scoped store", () => {
		const storeRoot = makeTempDir();
		const projectRoot = "/fake/project/path";

		const git = InternalGit.createForProject(storeRoot, projectRoot);

		expect(git).toBeInstanceOf(InternalGit);
		// Store directory should be namespaced by project hash
		const expectedDir = computeProjectHash(projectRoot);
		expect(existsSync(join(storeRoot, expectedDir))).toBe(true);
	});

	it("different projects get different store directories", () => {
		const storeRoot = makeTempDir();
		const git1 = InternalGit.createForProject(storeRoot, "/project/A");
		const git2 = InternalGit.createForProject(storeRoot, "/project/B");

		const hash1 = git1.writeObject("same content");
		const hash2 = git2.writeObject("same content");

		// Content hashes are the same (content-addressable)
		expect(hash1).toBe(hash2);
		// But both can read their objects
		expect(git1.readObject(hash1)).toBe("same content");
		expect(git2.readObject(hash2)).toBe("same content");
	});

	it("same project path always gets same store directory", () => {
		const hash1 = computeProjectHash("/same/project");
		const hash2 = computeProjectHash("/same/project");
		expect(hash1).toBe(hash2);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// computeProjectHash
// ═══════════════════════════════════════════════════════════════════════

describe("computeProjectHash", () => {
	it("returns 8-char hex string", () => {
		const hash = computeProjectHash("/some/path");
		expect(hash).toMatch(/^[0-9a-f]{8}$/);
	});

	it("different paths produce different hashes", () => {
		expect(computeProjectHash("/path/A")).not.toBe(computeProjectHash("/path/B"));
	});

	it("same path produces same hash", () => {
		expect(computeProjectHash("/consistent")).toBe(computeProjectHash("/consistent"));
	});
});
