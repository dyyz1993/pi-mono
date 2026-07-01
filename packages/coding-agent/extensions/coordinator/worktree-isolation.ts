import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Create an isolated git worktree for a delegated/subagent session.
 *
 * The worktree is placed under $PI_WORKTREE_ROOT (default ~/.pi/worktrees)
 * using the pattern `<repoName>-<safeBranch>`, matching the path computed by
 * the app-side getWorktreePath() in pi-agent-paths.ts and the shell
 * worktree-create.sh script.
 *
 * Returns the absolute path to the created worktree. Throws on failure.
 */
export function createIsolatedWorktree(
  repoPath: string,
  branch: string,
  sourceBranch?: string,
): string {
  const worktreeRoot = process.env.PI_WORKTREE_ROOT ?? join(homedir(), ".pi", "worktrees");
  const repoName = repoPath.split("/").pop() ?? "repo";
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, "_");
  const wtPath = join(worktreeRoot, `${repoName}-${safeBranch}`);

  const gitArgs = ["worktree", "add", wtPath, "-b", branch];
  if (sourceBranch) gitArgs.push(sourceBranch);

  const proc = spawnSync("git", gitArgs, { cwd: repoPath });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    const stderr = proc.stderr.toString().trim();
    throw new Error(stderr || `git worktree add failed (exit ${proc.status})`);
  }
  return wtPath;
}
