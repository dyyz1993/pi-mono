import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCanonicalGitRoot } from "../src/config.js";
import { getDefaultSessionDir } from "../src/core/session-manager.js";

function runGit(cwd: string, ...args: string[]): string {
	const { execSync } = require("child_process");
	return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

describe("findCanonicalGitRoot", () => {
	let tempDir: string;

	beforeEach(() => {
		const raw = join(tmpdir(), `pi-git-root-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(raw, { recursive: true });
		tempDir = realpathSync(raw);
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("returns null when no git repository exists", () => {
		const result = findCanonicalGitRoot(tempDir);
		expect(result).toBeNull();
	});

	it("returns cwd for a regular (non-worktree) git repo", () => {
		runGit(tempDir, "init");
		const result = findCanonicalGitRoot(tempDir);
		expect(result).toBe(tempDir);
	});

	it("finds git root from a subdirectory", () => {
		runGit(tempDir, "init");
		const subdir = join(tempDir, "src", "components");
		mkdirSync(subdir, { recursive: true });
		const result = findCanonicalGitRoot(subdir);
		expect(result).toBe(tempDir);
	});

	it("returns canonical root for a worktree", () => {
		const mainDir = join(tempDir, "main");
		mkdirSync(mainDir, { recursive: true });
		runGit(mainDir, "init");
		runGit(mainDir, "commit", "--allow-empty", "-m", "initial");
		runGit(mainDir, "branch", "worker-branch");

		const worktreeDir = join(tempDir, "worker");
		runGit(mainDir, "worktree", "add", worktreeDir, "worker-branch");

		const result = findCanonicalGitRoot(worktreeDir);
		expect(result).toBe(mainDir);
	});

	it("returns same canonical root for multiple worktrees", () => {
		const mainDir = join(tempDir, "main");
		mkdirSync(mainDir, { recursive: true });
		runGit(mainDir, "init");
		runGit(mainDir, "commit", "--allow-empty", "-m", "initial");

		runGit(mainDir, "branch", "w1-branch");
		runGit(mainDir, "branch", "w2-branch");

		const worktree1 = join(tempDir, "w1");
		const worktree2 = join(tempDir, "w2");
		runGit(mainDir, "worktree", "add", worktree1, "w1-branch");
		runGit(mainDir, "worktree", "add", worktree2, "w2-branch");

		const root1 = findCanonicalGitRoot(worktree1);
		const root2 = findCanonicalGitRoot(worktree2);
		const rootMain = findCanonicalGitRoot(mainDir);

		expect(root1).toBe(mainDir);
		expect(root2).toBe(mainDir);
		expect(rootMain).toBe(mainDir);
		expect(root1).toBe(root2);
	});

	it("returns null for a bare repo with no working tree", () => {
		const bareDir = join(tempDir, "bare");
		runGit(tempDir, "init", "--bare", bareDir);
		const result = findCanonicalGitRoot(bareDir);
		expect(result).toBeNull();
	});

	it("returns null when .git file points to non-existent path", () => {
		mkdirSync(join(tempDir, "fake-repo"));
		writeFileSync(join(tempDir, "fake-repo", ".git"), "gitdir: /nonexistent/path/.git");
		const result = findCanonicalGitRoot(join(tempDir, "fake-repo"));
		expect(result).toBeNull();
	});
});

describe("getDefaultSessionDir with git worktrees", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		const raw = join(tmpdir(), `pi-session-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(raw, { recursive: true });
		tempDir = realpathSync(raw);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("uses cwd when no git repo exists", () => {
		const sessionDir = getDefaultSessionDir(tempDir, agentDir);
		const encoded = tempDir.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
		expect(sessionDir).toContain(encoded);
	});

	it("uses git root for a regular repo", () => {
		runGit(tempDir, "init");
		const sessionDir = getDefaultSessionDir(tempDir, agentDir);
		const encoded = tempDir.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
		expect(sessionDir).toContain(encoded);
	});

	it("uses canonical git root for a worktree (shared session dir)", () => {
		const mainDir = join(tempDir, "main");
		mkdirSync(mainDir, { recursive: true });
		runGit(mainDir, "init");
		runGit(mainDir, "commit", "--allow-empty", "-m", "initial");
		runGit(mainDir, "branch", "worker-branch");

		const worktreeDir = join(tempDir, "worker");
		runGit(mainDir, "worktree", "add", worktreeDir, "worker-branch");

		const mainSessionDir = getDefaultSessionDir(mainDir, agentDir);
		const workerSessionDir = getDefaultSessionDir(worktreeDir, agentDir);

		expect(mainSessionDir).toBe(workerSessionDir);
	});

	it("all worktrees produce the same session dir", () => {
		const mainDir = join(tempDir, "main");
		mkdirSync(mainDir, { recursive: true });
		runGit(mainDir, "init");
		runGit(mainDir, "commit", "--allow-empty", "-m", "initial");

		runGit(mainDir, "branch", "w1-branch");
		runGit(mainDir, "branch", "w2-branch");

		const worktree1 = join(tempDir, "w1");
		const worktree2 = join(tempDir, "w2");
		runGit(mainDir, "worktree", "add", worktree1, "w1-branch");
		runGit(mainDir, "worktree", "add", worktree2, "w2-branch");

		const dirs = [mainDir, worktree1, worktree2].map((d) => getDefaultSessionDir(d, agentDir));

		expect(dirs[0]).toBe(dirs[1]);
		expect(dirs[1]).toBe(dirs[2]);
	});

	it("session dir uses git root path encoding, not cwd", () => {
		const mainDir = join(tempDir, "main");
		mkdirSync(mainDir, { recursive: true });
		runGit(mainDir, "init");
		runGit(mainDir, "commit", "--allow-empty", "-m", "initial");
		runGit(mainDir, "branch", "worker-branch");

		const worktreeDir = join(tempDir, "worker");
		runGit(mainDir, "worktree", "add", worktreeDir, "worker-branch");

		const sessionDir = getDefaultSessionDir(worktreeDir, agentDir);
		const mainEncoded = mainDir.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
		expect(sessionDir).toContain(mainEncoded);
	});
});
