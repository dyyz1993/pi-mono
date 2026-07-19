import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isInsidePath, serializeMemory, serializeSkill, LearningStore } from "../store.ts";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

describe("isInsidePath", () => {
  it("returns true for identical paths", () => {
    expect(isInsidePath("/foo/bar", "/foo/bar")).toBe(true);
  });

  it("returns true for nested child", () => {
    expect(isInsidePath("/foo/bar/baz.txt", "/foo/bar")).toBe(true);
    expect(isInsidePath("/foo/bar/sub/deep.md", "/foo/bar")).toBe(true);
  });

  it("returns false for sibling", () => {
    expect(isInsidePath("/foo/baz", "/foo/bar")).toBe(false);
  });

  it("returns false for path outside", () => {
    expect(isInsidePath("/etc/passwd", "/foo/bar")).toBe(false);
    expect(isInsidePath("../../etc/passwd", "/foo/bar")).toBe(false);
  });

  it("returns false for similar-prefix sibling", () => {
    // regression: prefix-based check would wrongly accept /foo/barbaz as inside /foo/bar
    expect(isInsidePath("/foo/barbaz", "/foo/bar")).toBe(false);
  });

  it("rejects ./escape attempts (single dot in path)", () => {
    // Mutation guard: startsWith('.') would wrongly accept /foo/.bar as "starts with .."
    // Real ../ should be rejected, .bar (a normal subdir name) inside /foo is fine
    expect(isInsidePath("/foo/../etc/passwd", "/foo/bar")).toBe(false);
    expect(isInsidePath("/foo/bar/.hidden", "/foo/bar")).toBe(true);
  });

  it("resolves relative paths against process cwd", () => {
    // relative paths resolve against process.cwd(), not baseDir
    const cwd = process.cwd();
    expect(isInsidePath("sub/file.md", cwd)).toBe(true);
  });
});

describe("serializeMemory", () => {
  it("builds frontmatter with name derived from filename", () => {
    const payload = {
      type: "memory" as const,
      filename: "user-prefs.md",
      description: "user preferences",
      memoryType: "user" as const,
      content: "body text",
    };
    const result = serializeMemory(payload, {});
    expect(result).toContain("name: user-prefs");
    expect(result).toContain("description: user preferences");
    expect(result).toContain("type: user");
    expect(result).toContain("body text");
  });

  it("includes sourceSession when provided", () => {
    const payload = {
      type: "memory" as const,
      filename: "x.md",
      description: "d",
      memoryType: "project" as const,
      content: "c",
    };
    const result = serializeMemory(payload, { sourceSessionId: "sess-123" });
    expect(result).toContain("sourceSession: sess-123");
  });

  it("strips .md extension from name", () => {
    const payload = {
      type: "memory" as const,
      filename: "My-Cool-Memory.md",
      description: "d",
      memoryType: "user" as const,
      content: "c",
    };
    expect(serializeMemory(payload, {})).toContain("name: My-Cool-Memory");
  });
});

describe("serializeSkill", () => {
  it("builds frontmatter with name + description", () => {
    const payload = {
      type: "skill" as const,
      name: "create-file",
      description: "creates a file",
      body: "procedure text",
      files: [],
    };
    const result = serializeSkill(payload);
    expect(result).toContain("name: create-file");
    expect(result).toContain("description: creates a file");
    expect(result).toContain("procedure text");
  });
});

// ============================================================================
// LearningStore snapshot cache
// ============================================================================

let tempProject: string;

beforeEach(async () => {
  tempProject = await mkdtemp(tmpdir() + "/learning-store-test-");
});

afterEach(async () => {
  await rm(tempProject, { recursive: true, force: true });
});

describe("LearningStore.getSnapshot cache", () => {
  it("returns the same snapshot shape on consecutive calls (cache hit)", async () => {
    const store = new LearningStore(tempProject);
    const snap1 = await store.getSnapshot();
    const snap2 = await store.getSnapshot();
    // Cache returns the same reference within TTL
    expect(snap2).toBe(snap1);
  });

  it("returns a fresh snapshot after invalidateSnapshot", async () => {
    const store = new LearningStore(tempProject);
    const snap1 = await store.getSnapshot();
    store.invalidateSnapshot();
    const snap2 = await store.getSnapshot();
    expect(snap2).not.toBe(snap1);
    // Same content shape though
    expect(snap2.version).toBe(snap1.version);
    expect(snap2.overview.memoryFiles).toBe(snap1.overview.memoryFiles);
  });

  it("respects TTL: cache stays valid within TTL window", async () => {
    const store = new LearningStore(tempProject);
    const snap1 = await store.getSnapshot();

    // Backdate by 1000ms (well under SNAPSHOT_TTL_MS=5000)
    // Original (TTL=5000): 1000 < 5000 → cache valid → SAME reference
    // Mutation (TTL=0): 1000 > 0 → cache invalid → NEW reference
    (store as any).snapshotCache.ts = Date.now() - 1000;

    const snap2 = await store.getSnapshot();
    expect(snap2).toBe(snap1); // still cached
  });

  it("respects TTL: cache expires when backdated beyond TTL", async () => {
    const store = new LearningStore(tempProject);
    const snap1 = await store.getSnapshot();

    // Backdate by 10s (well over TTL=5000)
    (store as any).snapshotCache.ts = Date.now() - 10_000;

    const snap2 = await store.getSnapshot();
    expect(snap2).not.toBe(snap1); // expired → fresh
  });

  it("returns fresh snapshot after a mutation (createMemoryCandidate invalidates)", async () => {
    const store = new LearningStore(tempProject);
    const snap1 = await store.getSnapshot();
    expect(snap1.overview.pendingCandidates).toBe(0);

    await store.createMemoryCandidate({
      title: "test",
      summary: "test",
      payload: {
        type: "memory",
        filename: "test.md",
        description: "test",
        memoryType: "user",
        content: "test content",
      },
    });

    const snap2 = await store.getSnapshot();
    expect(snap2).not.toBe(snap1);
    expect(snap2.overview.pendingCandidates).toBe(1);
  });
});
