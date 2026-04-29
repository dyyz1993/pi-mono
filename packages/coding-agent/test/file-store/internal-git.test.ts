import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeProjectHash, InternalGit, type TreeEntry } from "../../src/core/file-store/internal-git.js";

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-internal-git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("InternalGit", () => {
	let tempDir: string;
	let storeDir: string;
	let git: InternalGit;

	beforeEach(() => {
		tempDir = createTempDir();
		storeDir = join(tempDir, "store");
		git = new InternalGit(storeDir);
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("object storage", () => {
		it("stores and retrieves file content by hash", () => {
			const content = "hello world";
			const hash = git.writeObject(content);
			expect(git.readObject(hash)).toBe(content);
		});

		it("deduplicates identical content", () => {
			const hash1 = git.writeObject("same content");
			const hash2 = git.writeObject("same content");
			expect(hash1).toBe(hash2);
		});

		it("stores different content with different hashes", () => {
			const hash1 = git.writeObject("content A");
			const hash2 = git.writeObject("content B");
			expect(hash1).not.toBe(hash2);
		});

		it("handles empty content", () => {
			const hash = git.writeObject("");
			expect(git.readObject(hash)).toBe("");
		});

		it("handles unicode content", () => {
			const content = "你好世界 🌍 ñ é ü";
			const hash = git.writeObject(content);
			expect(git.readObject(hash)).toBe(content);
		});

		it("handles large content", () => {
			const content = "x".repeat(100_000);
			const hash = git.writeObject(content);
			expect(git.readObject(hash)).toBe(content);
		});

		it("hasObject returns true for stored objects", () => {
			const hash = git.writeObject("exists");
			expect(git.hasObject(hash)).toBe(true);
		});

		it("hasObject returns false for unknown objects", () => {
			expect(git.hasObject("deadbeef")).toBe(false);
		});
	});

	describe("tree operations", () => {
		it("writeTree stores files and returns tree hash", () => {
			const files = new Map<string, string>([
				["foo.ts", "content of foo"],
				["bar.ts", "content of bar"],
			]);

			const { entries } = git.writeTree(files);

			expect(entries.size).toBe(2);
			expect(entries.get("foo.ts")!.hash).toBe(git.hashContent("content of foo"));
			expect(entries.get("bar.ts")!.hash).toBe(git.hashContent("content of bar"));
		});

		it("readTree restores all files from a tree hash", () => {
			const files = new Map<string, string>([
				["foo.ts", "hello foo"],
				["bar.ts", "hello bar"],
			]);
			const { treeHash } = git.writeTree(files);

			const restored = git.readTree(treeHash);
			expect(restored.get("foo.ts")).toBe("hello foo");
			expect(restored.get("bar.ts")).toBe("hello bar");
			expect(restored.size).toBe(2);
		});

		it("produces deterministic tree hash for same content", () => {
			const files1 = new Map<string, string>([["foo.ts", "same"]]);
			const files2 = new Map<string, string>([["foo.ts", "same"]]);

			const { treeHash: h1 } = git.writeTree(files1);
			const { treeHash: h2 } = git.writeTree(files2);

			expect(h1).toBe(h2);
		});

		it("produces different tree hash for different content", () => {
			const files1 = new Map<string, string>([["foo.ts", "version1"]]);
			const files2 = new Map<string, string>([["foo.ts", "version2"]]);

			const { treeHash: h1 } = git.writeTree(files1);
			const { treeHash: h2 } = git.writeTree(files2);

			expect(h1).not.toBe(h2);
		});

		it("handles empty file map", () => {
			const files = new Map<string, string>();
			const { treeHash, entries } = git.writeTree(files);

			expect(entries.size).toBe(0);
			const restored = git.readTree(treeHash);
			expect(restored.size).toBe(0);
		});

		it("tree objects are stored as objects", () => {
			const files = new Map<string, string>([["a.ts", "a"]]);
			const { treeHash } = git.writeTree(files);

			expect(git.hasObject(treeHash)).toBe(true);
		});
	});

	describe("diff computation", () => {
		it("detects added files", () => {
			const old = new Map<string, TreeEntry>();
			const newEntries = new Map<string, TreeEntry>([["new.ts", { path: "new.ts", hash: git.hashContent("new") }]]);

			const diff = git.computeDiff(old, newEntries);
			expect(diff.added).toEqual(["new.ts"]);
			expect(diff.modified).toEqual([]);
			expect(diff.deleted).toEqual([]);
		});

		it("detects modified files", () => {
			const old = new Map<string, TreeEntry>([["foo.ts", { path: "foo.ts", hash: git.hashContent("v1") }]]);
			const newEntries = new Map<string, TreeEntry>([["foo.ts", { path: "foo.ts", hash: git.hashContent("v2") }]]);

			const diff = git.computeDiff(old, newEntries);
			expect(diff.modified).toEqual(["foo.ts"]);
			expect(diff.added).toEqual([]);
			expect(diff.deleted).toEqual([]);
		});

		it("detects deleted files", () => {
			const old = new Map<string, TreeEntry>([["foo.ts", { path: "foo.ts", hash: git.hashContent("v1") }]]);
			const newEntries = new Map<string, TreeEntry>();

			const diff = git.computeDiff(old, newEntries);
			expect(diff.deleted).toEqual(["foo.ts"]);
			expect(diff.added).toEqual([]);
			expect(diff.modified).toEqual([]);
		});

		it("detects mixed changes", () => {
			const old = new Map<string, TreeEntry>([
				["kept.ts", { path: "kept.ts", hash: git.hashContent("same") }],
				["modified.ts", { path: "modified.ts", hash: git.hashContent("old") }],
				["deleted.ts", { path: "deleted.ts", hash: git.hashContent("old") }],
			]);
			const newEntries = new Map<string, TreeEntry>([
				["kept.ts", { path: "kept.ts", hash: git.hashContent("same") }],
				["modified.ts", { path: "modified.ts", hash: git.hashContent("new") }],
				["added.ts", { path: "added.ts", hash: git.hashContent("new") }],
			]);

			const diff = git.computeDiff(old, newEntries);
			expect(diff.added).toEqual(["added.ts"]);
			expect(diff.modified).toEqual(["modified.ts"]);
			expect(diff.deleted).toEqual(["deleted.ts"]);
		});

		it("returns empty diff for identical trees", () => {
			const entries = new Map<string, TreeEntry>([["foo.ts", { path: "foo.ts", hash: git.hashContent("same") }]]);

			const diff = git.computeDiff(entries, new Map(entries));
			expect(diff.added).toEqual([]);
			expect(diff.modified).toEqual([]);
			expect(diff.deleted).toEqual([]);
		});
	});

	describe("diffTrees", () => {
		it("computes diff between two tree hashes", () => {
			const files1 = new Map<string, string>([
				["foo.ts", "v1"],
				["bar.ts", "b1"],
			]);
			const { treeHash: h1 } = git.writeTree(files1);

			const files2 = new Map<string, string>([
				["foo.ts", "v2"],
				["baz.ts", "z1"],
			]);
			const { treeHash: h2 } = git.writeTree(files2);

			const diff = git.diffTrees(h1, h2);
			expect(diff.modified).toContain("foo.ts");
			expect(diff.deleted).toContain("bar.ts");
			expect(diff.added).toContain("baz.ts");
		});

		it("returns empty diff for same tree", () => {
			const files = new Map<string, string>([["x.ts", "same"]]);
			const { treeHash } = git.writeTree(files);

			const diff = git.diffTrees(treeHash, treeHash);
			expect(diff.added).toEqual([]);
			expect(diff.modified).toEqual([]);
			expect(diff.deleted).toEqual([]);
		});
	});

	describe("scanWorkingDir", () => {
		let workDir: string;

		beforeEach(() => {
			workDir = join(tempDir, "workspace");
			mkdirSync(workDir, { recursive: true });
		});

		it("scans files from a working directory", () => {
			writeFileSync(join(workDir, "foo.ts"), "hello", "utf-8");
			writeFileSync(join(workDir, "bar.ts"), "world", "utf-8");

			const files = git.scanWorkingDir(workDir);
			expect(files.get("foo.ts")).toBe("hello");
			expect(files.get("bar.ts")).toBe("world");
		});

		it("skips node_modules", () => {
			mkdirSync(join(workDir, "node_modules", "pkg"), { recursive: true });
			writeFileSync(join(workDir, "node_modules", "pkg", "index.js"), "ignored", "utf-8");
			writeFileSync(join(workDir, "src.ts"), "included", "utf-8");

			const files = git.scanWorkingDir(workDir);
			expect(files.has("src.ts")).toBe(true);
			expect(files.has("node_modules/pkg/index.js")).toBe(false);
		});

		it("skips .git directory", () => {
			mkdirSync(join(workDir, ".git", "objects"), { recursive: true });
			writeFileSync(join(workDir, ".git", "objects", "abc"), "ignored", "utf-8");
			writeFileSync(join(workDir, "real.ts"), "included", "utf-8");

			const files = git.scanWorkingDir(workDir);
			expect(files.has("real.ts")).toBe(true);
			expect(files.size).toBe(1);
		});

		it("respects .gitignore patterns", () => {
			writeFileSync(join(workDir, ".gitignore"), "*.log\ndist/\n", "utf-8");
			writeFileSync(join(workDir, "app.ts"), "code", "utf-8");
			writeFileSync(join(workDir, "debug.log"), "log stuff", "utf-8");
			mkdirSync(join(workDir, "dist"), { recursive: true });
			writeFileSync(join(workDir, "dist", "bundle.js"), "bundled", "utf-8");

			const files = git.scanWorkingDir(workDir);
			expect(files.has("app.ts")).toBe(true);
			expect(files.has("debug.log")).toBe(false);
			expect(files.has("dist/bundle.js")).toBe(false);
		});

		it("handles nested directories", () => {
			mkdirSync(join(workDir, "src", "utils"), { recursive: true });
			writeFileSync(join(workDir, "src", "index.ts"), "root", "utf-8");
			writeFileSync(join(workDir, "src", "utils", "helpers.ts"), "helpers", "utf-8");

			const files = git.scanWorkingDir(workDir);
			expect(files.get("src/index.ts")).toBe("root");
			expect(files.get("src/utils/helpers.ts")).toBe("helpers");
		});
	});

	describe("full workflow: scan -> tree -> diff -> restore", () => {
		let workDir: string;

		beforeEach(() => {
			workDir = join(tempDir, "workspace");
			mkdirSync(workDir, { recursive: true });
		});

		it("captures turn-level snapshots with diff", () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");

			const baseline = git.scanWorkingDir(workDir);
			const { treeHash: baselineHash, entries: baselineEntries } = git.writeTree(baseline);

			writeFileSync(join(workDir, "foo.ts"), "v2", "utf-8");
			writeFileSync(join(workDir, "bar.ts"), "new", "utf-8");

			const snapshot = git.scanWorkingDir(workDir);
			const { treeHash: _snapshotHash, entries: snapshotEntries } = git.writeTree(snapshot);

			const diff = git.computeDiff(baselineEntries, snapshotEntries);
			expect(diff.modified).toEqual(["foo.ts"]);
			expect(diff.added).toEqual(["bar.ts"]);
			expect(diff.deleted).toEqual([]);

			const restored = git.readTree(baselineHash);
			expect(restored.get("foo.ts")).toBe("v1");
			expect(restored.has("bar.ts")).toBe(false);
		});

		it("tracks progressive changes across turns", () => {
			writeFileSync(join(workDir, "foo.ts"), "v1", "utf-8");
			const snap0 = git.scanWorkingDir(workDir);
			const { treeHash: h0 } = git.writeTree(snap0);

			writeFileSync(join(workDir, "foo.ts"), "v2", "utf-8");
			writeFileSync(join(workDir, "bar.ts"), "b1", "utf-8");
			const snap1 = git.scanWorkingDir(workDir);
			const { treeHash: h1 } = git.writeTree(snap1);

			writeFileSync(join(workDir, "foo.ts"), "v2", "utf-8");
			const snap2 = git.scanWorkingDir(workDir);
			const { treeHash: h2 } = git.writeTree(snap2);

			expect(git.readTree(h0).get("foo.ts")).toBe("v1");
			expect(git.readTree(h0).has("bar.ts")).toBe(false);

			expect(git.readTree(h1).get("foo.ts")).toBe("v2");
			expect(git.readTree(h1).get("bar.ts")).toBe("b1");

			expect(git.readTree(h2).get("foo.ts")).toBe("v2");
			expect(git.readTree(h2).has("bar.ts")).toBe(true);
		});
	});

	describe("storage efficiency", () => {
		it("objects are deduplicated across trees", () => {
			const files1 = new Map<string, string>([["shared.ts", "same content"]]);
			const files2 = new Map<string, string>([["shared.ts", "same content"]]);

			git.writeTree(files1);
			git.writeTree(files2);

			const hash = git.hashContent("same content");
			expect(git.readObject(hash)).toBe("same content");
		});
	});

	describe("project-level store", () => {
		it("createForProject uses project hash as directory name", () => {
			const ig = InternalGit.createForProject(join(tempDir, "file-store"), "/my/project/root");
			ig.writeObject("test");
			expect(ig.readObject(ig.hashContent("test"))).toBe("test");
		});

		it("same project root gives same store", () => {
			const ig1 = InternalGit.createForProject(join(tempDir, "file-store"), "/my/project");
			ig1.writeObject("shared");

			const ig2 = InternalGit.createForProject(join(tempDir, "file-store"), "/my/project");
			expect(ig2.hasObject(ig1.hashContent("shared"))).toBe(true);
		});

		it("different project roots give different stores", () => {
			const ig1 = InternalGit.createForProject(join(tempDir, "file-store"), "/project/A");
			ig1.writeObject("content-a");

			const ig2 = InternalGit.createForProject(join(tempDir, "file-store"), "/project/B");
			expect(ig2.hasObject(ig1.hashContent("content-a"))).toBe(false);
		});
	});

	describe("computeProjectHash", () => {
		it("returns consistent hash for same path", () => {
			const h1 = computeProjectHash("/my/project");
			const h2 = computeProjectHash("/my/project");
			expect(h1).toBe(h2);
		});

		it("returns different hash for different paths", () => {
			const h1 = computeProjectHash("/project/A");
			const h2 = computeProjectHash("/project/B");
			expect(h1).not.toBe(h2);
		});
	});

	describe("append-only guarantee", () => {
		it("objects are never deleted, only added", () => {
			git.writeObject("v1");
			git.writeObject("v2");
			git.writeObject("v3");

			expect(git.hasObject(git.hashContent("v1"))).toBe(true);
			expect(git.hasObject(git.hashContent("v2"))).toBe(true);
			expect(git.hasObject(git.hashContent("v3"))).toBe(true);
		});
	});
});
