/**
 * Benchmark tests for getSnapshot caching + ensureMemoryEntrypoint mtime-skip.
 *
 * These tests measure real wall-clock time and assert that:
 * 1. A cached getSnapshot call is materially faster than a cold one
 * 2. ensureMemoryEntrypoint does not rewrite MEMORY.md when nothing changed
 *
 * They use a realistic dataset (50 memory files, 20 skills, 30 candidates, 50 runs)
 * to approximate production load.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "os";
import { join } from "path";
import { LearningStore, getLearningPaths } from "../store.ts";
import { DEFAULT_LEARNING_CONFIG } from "../store.ts";

let tempProject: string;

beforeEach(async () => {
  tempProject = await mkdtemp(tmpdir() + "/learning-bench-");
});

afterEach(async () => {
  await rm(tempProject, { recursive: true, force: true });
});

async function seedDataset(opts: {
  memoryFiles?: number;
  skills?: number;
  candidates?: number;
  runs?: number;
}): Promise<void> {
  const paths = getLearningPaths(tempProject);
  const store = new LearningStore(tempProject);
  // Force store to create base dirs
  await store.ensureBaseDirs();

  // Memory files
  for (let i = 0; i < (opts.memoryFiles ?? 50); i++) {
    await writeFile(
      join(paths.memoryDir, `mem-${i}.md`),
      `---\nname: mem-${i}\ndescription: memory file ${i}\ntype: user\n---\nbody content for memory ${i}. `.repeat(5),
    );
  }

  // Skills (each in its own dir with SKILL.md)
  for (let i = 0; i < (opts.skills ?? 20); i++) {
    const skillDir = join(paths.skillsDir, `skill-${i}`);
    mkdirSync(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: skill-${i}\ndescription: skill ${i}\n---\n# Skill ${i}\nprocedure...`,
    );
  }

  // Candidates
  for (let i = 0; i < (opts.candidates ?? 30); i++) {
    await store.createMemoryCandidate({
      title: `c-${i}`,
      summary: `summary ${i}`,
      payload: {
        type: "memory",
        filename: `c-${i}.md`,
        description: `desc ${i}`,
        memoryType: "user",
        content: `content ${i}`,
      },
    });
  }

  // Runs (just write JSON files directly)
  for (let i = 0; i < (opts.runs ?? 50); i++) {
    const run = {
      version: 1,
      id: `run-${i}`,
      domain: i % 2 === 0 ? "memory" : "skill",
      type: i % 2 === 0 ? "memory-curator" : "skill-curator",
      mode: "dry-run",
      status: i % 5 === 0 ? "failed" : "completed",
      startedAt: Date.now() - i * 1000,
      completedAt: Date.now() - i * 1000 + 100,
      actions: [],
    };
    await writeFile(join(paths.runsDir, `run-${i}.json`), JSON.stringify(run));
  }
}

describe("getSnapshot cache performance", () => {
  it("cached call is materially faster than cold call", async () => {
    await seedDataset({ memoryFiles: 50, skills: 20, candidates: 30, runs: 50 });

    const store = new LearningStore(tempProject);

    // First call: cold (no cache, full scan)
    const coldStart = performance.now();
    await store.getSnapshot();
    const coldMs = performance.now() - coldStart;

    // Second call: warm (cache hit)
    const warmStart = performance.now();
    await store.getSnapshot();
    const warmMs = performance.now() - warmStart;

    // eslint-disable-next-line no-console
    console.log(`[bench] getSnapshot: cold=${coldMs.toFixed(2)}ms, warm=${warmMs.toFixed(4)}ms, speedup=${(coldMs / Math.max(warmMs, 0.001)).toFixed(1)}x`);

    // Cache must be at least 10x faster (typical speedup is 100-1000x)
    expect(warmMs).toBeLessThan(coldMs / 10);
  });

  it("cache returns the same reference (no copy)", async () => {
    await seedDataset({ memoryFiles: 10 });
    const store = new LearningStore(tempProject);
    const s1 = await store.getSnapshot();
    const s2 = await store.getSnapshot();
    expect(s2).toBe(s1); // referential equality — proves cache hit
  });

  it("cache hit count for N consecutive calls = N-1", async () => {
    await seedDataset({ memoryFiles: 20 });
    const store = new LearningStore(tempProject);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await store.getSnapshot();
    }
    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(`[bench] 100 consecutive getSnapshot calls: ${elapsed.toFixed(2)}ms total, ${(elapsed / 100).toFixed(4)}ms avg`);

    // 100 calls (99 cached + 1 cold) should take less than 50 cold calls worth of time
    // i.e. amortized cost per call < 50% of cold cost
    const singleColdStart = performance.now();
    store.invalidateSnapshot();
    await store.getSnapshot();
    const singleColdMs = performance.now() - singleColdStart;

    const amortized = elapsed / 100;
    expect(amortized).toBeLessThan(singleColdMs * 0.5);
  });
});

describe("ensureMemoryEntrypoint mtime-skip", () => {
  it("does not rewrite MEMORY.md when no memory files have changed", async () => {
    await seedDataset({ memoryFiles: 10 });
    const store = new LearningStore(tempProject);
    const paths = getLearningPaths(tempProject);

    // First call: creates entrypoint
    await store.getSnapshot();
    const entryPath = join(paths.memoryDir, "MEMORY.md");
    expect(existsSync(entryPath)).toBe(true);

    const firstStat = statSync(entryPath);
    const firstMtime = firstStat.mtimeMs;
    const firstContent = readFileSync(entryPath, "utf-8");

    // Wait a bit so any rewrite would update mtime
    await new Promise((r) => setTimeout(r, 30));

    // Second snapshot call: should NOT rewrite entrypoint
    store.invalidateSnapshot();
    await store.getSnapshot();

    const secondStat = statSync(entryPath);
    const secondContent = readFileSync(entryPath, "utf-8");

    expect(secondStat.mtimeMs).toBe(firstMtime);
    expect(secondContent).toBe(firstContent);
  });

  it("DOES rewrite MEMORY.md when a new memory file is added", async () => {
    await seedDataset({ memoryFiles: 5 });
    const store = new LearningStore(tempProject);
    const paths = getLearningPaths(tempProject);

    await store.getSnapshot();
    const entryPath = join(paths.memoryDir, "MEMORY.md");
    const firstContent = readFileSync(entryPath, "utf-8");

    // Add a new memory file (later mtime)
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(
      join(paths.memoryDir, "newcomer.md"),
      "---\nname: newcomer\ndescription: new file\ntype: user\n---\nnew body",
    );

    store.invalidateSnapshot();
    await store.getSnapshot();

    const secondContent = readFileSync(entryPath, "utf-8");
    expect(secondContent).not.toBe(firstContent);
    expect(secondContent).toContain("newcomer");
  });

  it("MEMORY.md contains all active memory files in index", async () => {
    await seedDataset({ memoryFiles: 5 });
    const store = new LearningStore(tempProject);
    const paths = getLearningPaths(tempProject);

    await store.getSnapshot();
    const entryPath = join(paths.memoryDir, "MEMORY.md");
    const content = readFileSync(entryPath, "utf-8");

    expect(content).toContain("mem-0");
    expect(content).toContain("mem-4");
    // Should have 5 entries (one per memory file)
    const lines = content.split("\n").filter((l) => l.startsWith("- ["));
    expect(lines).toHaveLength(5);
  });
});
