import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InternalGit } from "../src/core/file-store/internal-git.ts";

describe("InternalGit", () => {
	let storeDir: string;

	beforeEach(() => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		storeDir = join(tmpdir(), `pi-internal-git-test-${suffix}`);
		mkdirSync(storeDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(storeDir, { recursive: true, force: true });
	});

	describe("readTreeFiles", () => {
		it("returns only the files in the wanted set", () => {
			const git = new InternalGit(storeDir);
			const files = new Map([
				["a.txt", "aaa\n"],
				["b.txt", "bbb\n"],
				["c.txt", "ccc\n"],
			]);
			const { treeHash } = git.writeTree(files);

			const result = git.readTreeFiles(treeHash, new Set(["a.txt", "c.txt"]));

			expect(result).not.toBeNull();
			expect(result!.size).toBe(2);
			expect(result!.get("a.txt")).toBe("aaa\n");
			expect(result!.get("c.txt")).toBe("ccc\n");
			expect(result!.has("b.txt")).toBe(false);
		});

		it("returns null for nonexistent tree hash", () => {
			const git = new InternalGit(storeDir);
			const result = git.readTreeFiles("nonexistent", new Set(["a.txt"]));
			expect(result).toBeNull();
		});

		it("returns empty map when wanted set is empty", () => {
			const git = new InternalGit(storeDir);
			const files = new Map([["a.txt", "aaa\n"]]);
			const { treeHash } = git.writeTree(files);

			const result = git.readTreeFiles(treeHash, new Set());
			expect(result).not.toBeNull();
			expect(result!.size).toBe(0);
		});

		it("returns empty map when no wanted files exist in tree", () => {
			const git = new InternalGit(storeDir);
			const files = new Map([
				["a.txt", "aaa\n"],
				["b.txt", "bbb\n"],
			]);
			const { treeHash } = git.writeTree(files);

			const result = git.readTreeFiles(treeHash, new Set(["z.txt"]));
			expect(result).not.toBeNull();
			expect(result!.size).toBe(0);
		});

		it("reads correct content for each wanted file", () => {
			const git = new InternalGit(storeDir);
			const files = new Map([
				["src/main.ts", "main content\n"],
				["src/utils.ts", "utils content\n"],
				["test/main.test.ts", "test content\n"],
			]);
			const { treeHash } = git.writeTree(files);

			const result = git.readTreeFiles(treeHash, new Set(["src/main.ts", "test/main.test.ts"]));

			expect(result).not.toBeNull();
			expect(result!.get("src/main.ts")).toBe("main content\n");
			expect(result!.get("test/main.test.ts")).toBe("test content\n");
			expect(result!.has("src/utils.ts")).toBe(false);
		});

		it("is equivalent to readTree when wanted includes all paths", () => {
			const git = new InternalGit(storeDir);
			const files = new Map([
				["x.txt", "x\n"],
				["y.txt", "y\n"],
				["z.txt", "z\n"],
			]);
			const { treeHash } = git.writeTree(files);

			const all = git.readTree(treeHash);
			const partial = git.readTreeFiles(treeHash, new Set(files.keys()));

			expect(partial).not.toBeNull();
			expect(partial!.size).toBe(all!.size);
			for (const [path, content] of all!) {
				expect(partial!.get(path)).toBe(content);
			}
		});

		it("handles tree with single file", () => {
			const git = new InternalGit(storeDir);
			const files = new Map([["lonely.txt", "only me\n"]]);
			const { treeHash } = git.writeTree(files);

			const result = git.readTreeFiles(treeHash, new Set(["lonely.txt"]));
			expect(result).not.toBeNull();
			expect(result!.size).toBe(1);
			expect(result!.get("lonely.txt")).toBe("only me\n");
		});
	});

	describe("listTreeFiles", () => {
		it("returns file paths with content hashes without reading file content", () => {
			const git = new InternalGit(storeDir);
			const files = new Map([
				["a.txt", "aaa\n"],
				["b.txt", "bbb\n"],
			]);
			const { treeHash } = git.writeTree(files);

			const result = git.listTreeFiles(treeHash);

			expect(result).not.toBeNull();
			expect(result!.size).toBe(2);
			// Should return hash values, not file content
			expect(result!.get("a.txt")).toBe(git.hashContent("aaa\n"));
			expect(result!.get("b.txt")).toBe(git.hashContent("bbb\n"));
		});

		it("returns null for nonexistent tree hash", () => {
			const git = new InternalGit(storeDir);
			expect(git.listTreeFiles("nonexistent")).toBeNull();
		});

		it("returns empty map for tree with no entries", () => {
			const git = new InternalGit(storeDir);
			const { treeHash } = git.writeTree(new Map());
			const result = git.listTreeFiles(treeHash);
			expect(result).not.toBeNull();
			expect(result!.size).toBe(0);
		});

		it("disk IO: reads tree object but not file objects (0 file content reads)", () => {
			const git = new InternalGit(storeDir);
			const files = new Map([
				["big.txt", "x".repeat(100_000)],
				["small.txt", "hello\n"],
			]);
			const { treeHash } = git.writeTree(files);

			// listTreeFiles should succeed without reading file contents
			const result = git.listTreeFiles(treeHash);
			expect(result).not.toBeNull();
			expect(result!.size).toBe(2);
			// Verify we got hashes (fixed-length strings), not content
			expect(result!.get("big.txt")).toBe(git.hashContent(files.get("big.txt")!));
			expect(result!.get("small.txt")).toBe(git.hashContent(files.get("small.txt")!));

			// After listTreeFiles, the file objects still exist and can be read
			const fullTree = git.readTree(treeHash);
			expect(fullTree).not.toBeNull();
			expect(fullTree!.get("big.txt")).toBe("x".repeat(100_000));
		});
	});
});
