import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryCurator } from "../memory-curator.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(tmpdir() + "/learning-curator-test-");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function seedMemory(filename: string, content: string): void {
  writeFileSync(join(tempDir, filename), content);
}

function mockLLM(response: object) {
  return vi.fn().mockResolvedValue(JSON.stringify(response)) as any;
}

function recentLock(): Promise<Date> {
  return stat(join(tempDir, ".consolidate-lock")).then((s) => s.mtime);
}

describe("MemoryCurator.maybeRun", () => {
  it("returns null when memory dir is empty", async () => {
    const curator = new MemoryCurator();
    const result = await curator.maybeRun(tempDir, mockLLM({}));
    expect(result).toBeNull();
  });

  it("returns null when lock is fresh (< 24h)", async () => {
    seedMemory("a.md", "---\nname: a\ndescription: a\ntype: user\n---\nbody a");
    // First call seeds the lock with mtime=epoch (1970)
    const curator = new MemoryCurator();
    const first = await curator.maybeRun(tempDir, mockLLM({ merges: [] }));
    // First call would proceed past lock check because lock mtime is epoch
    // (lock is fresh in file age but mtime = 0, so hoursSince is huge)
    // After first call successful, lock mtime updated to now
    if (first !== null) {
      const lockDate = await recentLock();
      expect(lockDate.getTime()).toBeGreaterThan(Date.now() - 60_000);
    }
    // Second call: lock is now fresh → should return null
    const second = await curator.maybeRun(tempDir, mockLLM({ merges: [] }));
    expect(second).toBeNull();
  });

  it("returns null when session count below threshold", async () => {
    seedMemory("a.md", "---\nname: a\ndescription: a\ntype: user\n---\nbody a");
    // Pre-seed lock with old mtime (so hoursSince > 24)
    const lockPath = join(tempDir, ".consolidate-lock");
    await writeFile(lockPath, "");
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000);
    await import("node:fs/promises").then(({ utimes }) =>
      utimes(lockPath, oldDate, oldDate),
    );
    // No .session-count yet: maybeRun initializes it to "1", then threshold (5) not met → null
    const curator = new MemoryCurator();
    const result = await curator.maybeRun(tempDir, mockLLM({}));
    expect(result).toBeNull();

    // session count file should now exist with value "1" (first call seeds it)
    const countPath = join(tempDir, ".session-count");
    expect(existsSync(countPath)).toBe(true);
    const count = await readFile(countPath, "utf-8");
    expect(Number.parseInt(count.trim(), 10)).toBe(1);
  });

  it("returns dream plan when threshold met and LLM succeeds", async () => {
    seedMemory("a.md", "---\nname: a\ndescription: a\ntype: user\n---\nbody a");
    seedMemory("b.md", "---\nname: b\ndescription: b\ntype: user\n---\nbody b");

    // Set lock to old time
    const lockPath = join(tempDir, ".consolidate-lock");
    await writeFile(lockPath, "");
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000);
    await import("node:fs/promises").then(({ utimes }) =>
      utimes(lockPath, oldDate, oldDate),
    );

    // Set session count to 10 (> threshold of 5)
    await writeFile(join(tempDir, ".session-count"), "10");

    const curator = new MemoryCurator();
    const result = await curator.maybeRun(
      tempDir,
      mockLLM({
        merges: [{ sources: ["a.md", "b.md"], target: "merged.md", content: "combined" }],
        deletions: [],
        updates: [],
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.merges).toHaveLength(1);
    expect(result!.merges[0]?.target).toBe("merged.md");

    // Plan was generated → session count should be reset to 0
    const count = await readFile(join(tempDir, ".session-count"), "utf-8");
    expect(count.trim()).toBe("0");

    // Lock mtime should be updated to now
    const lockDate = await recentLock();
    expect(lockDate.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("returns null when LLM returns invalid JSON", async () => {
    seedMemory("a.md", "---\nname: a\ndescription: a\ntype: user\n---\nbody a");
    const lockPath = join(tempDir, ".consolidate-lock");
    await writeFile(lockPath, "");
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000);
    await import("node:fs/promises").then(({ utimes }) =>
      utimes(lockPath, oldDate, oldDate),
    );
    await writeFile(join(tempDir, ".session-count"), "10");

    const curator = new MemoryCurator();
    const result = await curator.maybeRun(tempDir, vi.fn().mockResolvedValue("not json") as any);
    expect(result).toBeNull();
  });

  it("does not write or delete any memory files (dry-run only)", async () => {
    seedMemory("a.md", "---\nname: a\ndescription: a\ntype: user\n---\nbody a");
    seedMemory("b.md", "---\nname: b\ndescription: b\ntype: user\n---\nbody b");
    const lockPath = join(tempDir, ".consolidate-lock");
    await writeFile(lockPath, "");
    const oldDate = new Date(Date.now() - 48 * 3600 * 1000);
    await import("node:fs/promises").then(({ utimes }) =>
      utimes(lockPath, oldDate, oldDate),
    );
    await writeFile(join(tempDir, ".session-count"), "10");

    const curator = new MemoryCurator();
    await curator.maybeRun(
      tempDir,
      mockLLM({
        merges: [{ sources: ["a.md", "b.md"], target: "merged.md", content: "x" }],
        deletions: ["a.md", "b.md"],
        updates: [],
      }),
    );

    // Dry-run: both source files must still exist
    expect(existsSync(join(tempDir, "a.md"))).toBe(true);
    expect(existsSync(join(tempDir, "b.md"))).toBe(true);
    // Target file must NOT have been created
    expect(existsSync(join(tempDir, "merged.md"))).toBe(false);
  });
});
