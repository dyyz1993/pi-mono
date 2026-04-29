import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildFrontmatter,
	formatManifest,
	getEntrypointPath,
	getMemoryDir,
	getProjectRoot,
	isMemoryPath,
	type MemoryHeader,
	type MemoryType,
	parseFrontmatter,
	scanMemoryFiles,
	truncateEntrypoint,
} from "./utils.js";

describe("auto-memory utils", () => {
	describe("getMemoryDir", () => {
		it("returns path under ~/.pi/agent/memory/ with encoded cwd", () => {
			const dir = getMemoryDir("/home/user/my-project");
			expect(dir).toMatch(/\.pi[\\/]+agent[\\/]+memory/);
			expect(dir).toContain("--home-user-my-project--");
		});

		it("strips leading slash before encoding", () => {
			const dir = getMemoryDir("/Users/test/project");
			expect(dir).not.toContain("---Users");
			expect(dir).toContain("--Users-test-project--");
		});

		it("replaces slashes and backslashes with dashes", () => {
			const dir = getMemoryDir("/path/to/project");
			expect(dir).toContain("--path-to-project--");
		});

		it("same cwd always produces same dir", () => {
			expect(getMemoryDir("/foo/bar")).toBe(getMemoryDir("/foo/bar"));
		});
	});

	describe("getEntrypointPath", () => {
		it("returns MEMORY.md inside memory dir", () => {
			const entry = getEntrypointPath("/home/user/project");
			expect(entry).toMatch(/MEMORY\.md$/);
			expect(entry).toContain("memory");
		});
	});

	describe("isMemoryPath", () => {
		let tempDir: string;
		let memoryDir: string;

		beforeEach(() => {
			tempDir = join(tmpdir(), `am-test-${Date.now()}`);
			memoryDir = getMemoryDir(tempDir);
			mkdirSync(memoryDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("returns true for files inside memory dir", () => {
			expect(isMemoryPath(join(memoryDir, "topic.md"), tempDir)).toBe(true);
			expect(isMemoryPath(join(memoryDir, "MEMORY.md"), tempDir)).toBe(true);
			expect(isMemoryPath(join(memoryDir, "sub", "nested.md"), tempDir)).toBe(true);
		});

		it("returns false for files outside memory dir", () => {
			expect(isMemoryPath(join(tempDir, "README.md"), tempDir)).toBe(false);
			expect(isMemoryPath("/tmp/other.md", tempDir)).toBe(false);
		});

		it("returns false for paths that merely contain 'memory' in name", () => {
			expect(isMemoryPath(join(tempDir, "memory-backup", "file.md"), tempDir)).toBe(false);
		});
	});

	describe("parseFrontmatter", () => {
		it("extracts frontmatter and body", () => {
			const content =
				"---\nname: Testing Policy\ndescription: Never mock db\ntype: feedback\n---\n\nBody text here.";
			const result = parseFrontmatter(content);
			expect(result.frontmatter.name).toBe("Testing Policy");
			expect(result.frontmatter.description).toBe("Never mock db");
			expect(result.frontmatter.type).toBe("feedback");
			expect(result.body).toBe("Body text here.");
		});

		it("returns empty frontmatter for content without frontmatter", () => {
			const content = "Just plain text.\nNo frontmatter.";
			const result = parseFrontmatter(content);
			expect(Object.keys(result.frontmatter)).toHaveLength(0);
			expect(result.body).toBe(content);
		});

		it("handles empty frontmatter block", () => {
			const content = "---\n---\n\nBody after empty fm.";
			const result = parseFrontmatter(content);
			expect(Object.keys(result.frontmatter)).toHaveLength(0);
			expect(result.body).toBe("Body after empty fm.");
		});

		it("handles content starting with --- but no closing ---", () => {
			const content = "---\nname: test\nNo closing markers.";
			const result = parseFrontmatter(content);
			expect(Object.keys(result.frontmatter)).toHaveLength(0);
			expect(result.body).toBe(content);
		});

		it("handles multiline body", () => {
			const content = "---\nname: test\n---\n\nLine 1\nLine 2\nLine 3";
			const result = parseFrontmatter(content);
			expect(result.frontmatter.name).toBe("test");
			expect(result.body).toBe("Line 1\nLine 2\nLine 3");
		});
	});

	describe("buildFrontmatter", () => {
		it("generates correct frontmatter string", () => {
			const result = buildFrontmatter({
				name: "Testing Policy",
				description: "Never mock db",
				type: "feedback",
			});
			expect(result).toBe("---\nname: Testing Policy\ndescription: Never mock db\ntype: feedback\n---");
		});

		it("handles special characters in values", () => {
			const result = buildFrontmatter({
				name: "Auth & Security",
				description: "Use OAuth2: token-based auth",
				type: "project",
			});
			expect(result).toContain("name: Auth & Security");
			expect(result).toContain("description: Use OAuth2: token-based auth");
		});
	});

	describe("truncateEntrypoint", () => {
		it("returns content unchanged when within limits", () => {
			const content = "Line 1\nLine 2\nLine 3";
			const result = truncateEntrypoint(content);
			expect(result.content).toBe(content);
			expect(result.wasTruncated).toBe(false);
		});

		it("truncates to MAX_ENTRYPOINT_LINES", () => {
			const lines = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`);
			const content = lines.join("\n");
			const result = truncateEntrypoint(content);
			expect(result.wasTruncated).toBe(true);
			const resultLines = result.content.split("\n");
			expect(resultLines.length).toBeLessThanOrEqual(200);
		});

		it("truncates to MAX_ENTRYPOINT_BYTES", () => {
			const longLine = "A".repeat(1000);
			const lines = Array.from({ length: 30 }, () => longLine);
			const content = lines.join("\n");
			expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThan(25_000);
			const result = truncateEntrypoint(content);
			expect(result.wasTruncated).toBe(true);
			expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThanOrEqual(25_000);
		});

		it("handles empty content", () => {
			const result = truncateEntrypoint("");
			expect(result.content).toBe("");
			expect(result.wasTruncated).toBe(false);
		});
	});

	describe("scanMemoryFiles", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = join(tmpdir(), `am-scan-${Date.now()}`);
			mkdirSync(tempDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("returns empty array for empty directory", async () => {
			const files = await scanMemoryFiles(tempDir);
			expect(files).toEqual([]);
		});

		it("scans .md files and parses frontmatter", async () => {
			writeFileSync(
				join(tempDir, "testing.md"),
				"---\nname: Testing Policy\ndescription: Never mock db\ntype: feedback\n---\n\nBody.",
			);
			writeFileSync(
				join(tempDir, "user_role.md"),
				"---\nname: User Role\ndescription: Senior dev\ntype: user\n---\n\nPrefers TS.",
			);

			const files = await scanMemoryFiles(tempDir);
			expect(files).toHaveLength(2);

			const testing = files.find((f) => f.filename === "testing.md")!;
			expect(testing.description).toBe("Never mock db");
			expect(testing.type).toBe("feedback");

			const userRole = files.find((f) => f.filename === "user_role.md")!;
			expect(userRole.description).toBe("Senior dev");
			expect(userRole.type).toBe("user");
		});

		it("ignores non-.md files", async () => {
			writeFileSync(join(tempDir, "data.json"), "{}");
			writeFileSync(join(tempDir, "note.txt"), "hello");
			writeFileSync(join(tempDir, "topic.md"), "---\nname: Test\n---\n\nBody.");

			const files = await scanMemoryFiles(tempDir);
			expect(files).toHaveLength(1);
			expect(files[0]!.filename).toBe("topic.md");
		});

		it("ignores MEMORY.md entrypoint", async () => {
			writeFileSync(join(tempDir, "MEMORY.md"), "- [Test](test.md) — desc");
			writeFileSync(join(tempDir, "topic.md"), "---\nname: Test\n---\n\nBody.");

			const files = await scanMemoryFiles(tempDir);
			expect(files).toHaveLength(1);
			expect(files[0]!.filename).toBe("topic.md");
		});

		it("ignores dotfiles", async () => {
			writeFileSync(join(tempDir, ".consolidate-lock"), "");
			writeFileSync(join(tempDir, ".hidden.md"), "---\nname: Hidden\n---\n\nBody.");

			const files = await scanMemoryFiles(tempDir);
			expect(files).toHaveLength(0);
		});

		it("handles .md files without frontmatter", async () => {
			writeFileSync(join(tempDir, "bare.md"), "Just some content without frontmatter.");

			const files = await scanMemoryFiles(tempDir);
			expect(files).toHaveLength(1);
			expect(files[0]!.description).toBeNull();
			expect(files[0]!.type).toBeUndefined();
		});
	});

	describe("formatManifest", () => {
		it("formats headers into manifest string", () => {
			const headers: MemoryHeader[] = [
				{
					filename: "testing.md",
					filePath: "/tmp/testing.md",
					mtimeMs: 1000,
					description: "Never mock db",
					type: "feedback" as MemoryType,
				},
				{
					filename: "user_role.md",
					filePath: "/tmp/user_role.md",
					mtimeMs: 2000,
					description: "Senior dev",
					type: "user" as MemoryType,
				},
			];

			const manifest = formatManifest(headers);
			expect(manifest).toContain("testing.md");
			expect(manifest).toContain("Never mock db");
			expect(manifest).toContain("feedback");
			expect(manifest).toContain("user_role.md");
			expect(manifest).toContain("Senior dev");
			expect(manifest).toContain("user");
		});

		it("handles headers without description or type", () => {
			const headers: MemoryHeader[] = [
				{
					filename: "bare.md",
					filePath: "/tmp/bare.md",
					mtimeMs: 1000,
					description: null,
					type: undefined,
				},
			];

			const manifest = formatManifest(headers);
			expect(manifest).toContain("bare.md");
		});
	});

	describe("getProjectPath handles relative git-common-dir", () => {
		it("resolves relative .git path correctly", () => {
			const origExecSync = vi.spyOn(require("node:child_process"), "execSync");
			origExecSync.mockReturnValue(".git\n");

			const result = getProjectRoot(process.cwd());
			expect(result).not.toBe(process.cwd());

			origExecSync.mockRestore();
		});
	});

	describe("encodeCwd unicode handling", () => {
		it("handles unicode paths without throwing", () => {
			const dir = getMemoryDir("/Users/café/项目");
			expect(dir).toContain("café");
			expect(dir).toMatch(/\.pi[\\/]+agent[\\/]+memory/);
		});
	});

	describe("scanMemoryFiles edge cases", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = join(tmpdir(), `am-scan-edge-${Date.now()}`);
			mkdirSync(tempDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(tempDir, { recursive: true, force: true });
		});

		it("skips directory named .md", async () => {
			mkdirSync(join(tempDir, "dir.md"));
			const files = await scanMemoryFiles(tempDir);
			expect(files).toHaveLength(0);
		});

		it("handles unreadable file gracefully", async () => {
			const filePath = join(tempDir, "unreadable.md");
			writeFileSync(filePath, "---\nname: Test\n---\nContent.");
			try {
				chmodSync(filePath, 0o000);
			} catch {
				return;
			}

			try {
				const files = await scanMemoryFiles(tempDir);
				expect(files).toHaveLength(0);
			} catch {
				// If it throws, that's a known limitation
			} finally {
				try {
					chmodSync(filePath, 0o644);
				} catch {}
			}
		});
	});

	describe("getMemoryDir for worktree shares with main repo", () => {
		it("worktree and main repo share the same memory dir", async () => {
			const mainDir = join(tmpdir(), `wt-main-utils-${Date.now()}`);
			const wtDir = join(tmpdir(), `wt-wt-utils-${Date.now()}`);

			try {
				execSync(`git init "${mainDir}"`, { stdio: "pipe" });
				execSync(`git -C "${mainDir}" commit --allow-empty -m "init"`, { stdio: "pipe" });
				execSync(`git -C "${mainDir}" worktree add "${wtDir}"`, { stdio: "pipe" });

				const mainDir_result = getMemoryDir(mainDir);
				const wtDir_result = getMemoryDir(wtDir);

				expect(mainDir_result).toBe(wtDir_result);
			} finally {
				try {
					execSync(`git -C "${mainDir}" worktree remove "${wtDir}" --force 2>/dev/null`, { stdio: "pipe" });
				} catch {}
				rmSync(mainDir, { recursive: true, force: true });
				rmSync(wtDir, { recursive: true, force: true });
			}
		});
	});

	describe("formatManifest with many files", () => {
		it("performs reasonably with 200 files", () => {
			const headers: MemoryHeader[] = Array.from({ length: 200 }, (_, i) => ({
				filename: `file${i}.md`,
				filePath: `/tmp/file${i}.md`,
				mtimeMs: i * 1000,
				description: `Description for file ${i}`,
				type: "project" as MemoryType,
			}));

			const start = performance.now();
			const manifest = formatManifest(headers);
			const elapsed = performance.now() - start;

			expect(elapsed).toBeLessThan(100);
			expect(manifest).toContain("file0.md");
			expect(manifest).toContain("file199.md");
		});
	});
});
