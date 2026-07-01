import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createIsolatedWorktree } from "./worktree-isolation.ts";

const tempDirs: string[] = [];
const originalWorktreeRoot = process.env.PI_WORKTREE_ROOT;

afterEach(() => {
  if (originalWorktreeRoot === undefined) {
    delete process.env.PI_WORKTREE_ROOT;
  } else {
    process.env.PI_WORKTREE_ROOT = originalWorktreeRoot;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const proc = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (proc.status !== 0) {
    throw new Error(proc.stderr.toString() || proc.stdout.toString());
  }
}

function createRepo(): string {
  const repo = tempDir("pi-worktree-repo-");
  git(repo, ["init"]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}

describe("createIsolatedWorktree", () => {
  it("creates an isolated git worktree under PI_WORKTREE_ROOT", () => {
    const repo = createRepo();
    const root = join(tempDir("pi-worktree-root-"), "nested", "worktrees");
    process.env.PI_WORKTREE_ROOT = root;

    const worktreePath = createIsolatedWorktree(repo, "codex/feature-one");

    expect(worktreePath).toBe(join(root, `${basename(repo)}-codex_feature-one`));
    expect(existsSync(worktreePath)).toBe(true);

    const branch = spawnSync("git", ["branch", "--show-current"], {
      cwd: worktreePath,
    }).stdout.toString().trim();
    expect(branch).toBe("codex/feature-one");
  });
});
