import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isInsidePath, serializeMemory, serializeSkill, LearningStore } from "../store.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "node:path";

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

describe("LearningStore.listActiveSkillBodies", () => {
  let tempProject: string;
  let store: LearningStore;

  beforeEach(() => {
    tempProject = mkdtempSync(join(tmpdir(), "store-skill-bodies-"));
    store = new LearningStore(tempProject);
  });

  afterEach(() => {
    if (existsSync(tempProject)) rmSync(tempProject, { recursive: true, force: true });
  });

  it("returns empty array when no skills exist", async () => {
    const result = await store.listActiveSkillBodies();
    expect(result).toEqual([]);
  });

  it("returns active skills with name, description, body", async () => {
    await store.applySkillCandidate(
      {
        name: "create-file",
        description: "Create a file",
        body: "# Skill: create-file\n\n## Procedure\n1. Use write",
      },
      {
        version: 1,
        id: "test-1",
        domain: "skill",
        action: "create-skill",
        status: "approved",
        title: "Create file",
        summary: "Create file skill",
        confidence: "medium",
        sourceSessionId: undefined,
        sourceMessageIds: [],
        createdAt: Date.now(),
        payload: {
          name: "create-file",
          description: "Create a file",
          body: "# Skill: create-file\n\n## Procedure\n1. Use write",
        },
        fileRefs: [],
        decision: "approved",
        decidedAt: Date.now(),
      },
    );
    const result = await store.listActiveSkillBodies();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("create-file");
    expect(result[0]!.description).toBe("Create a file");
    expect(result[0]!.body).toContain("# Skill: create-file");
    expect(result[0]!.body).toContain("## Procedure");
  });

  it("sorts by usageCount DESC (apply multiple times increments usage)", async () => {
    const lowPayload = { name: "low-use", description: "d1", body: "b1" };
    const highPayload = { name: "high-use", description: "d2", body: "b2" };
    const mkCandidate = (id: string, payload: { name: string; description: string; body: string }) => ({
      version: 1 as const, id, domain: "skill" as const, action: "create-skill" as const,
      status: "approved" as const, title: id, summary: id, confidence: "medium" as const,
      sourceSessionId: undefined, sourceMessageIds: [], createdAt: Date.now(),
      payload, fileRefs: [], decision: "approved" as const, decidedAt: Date.now(),
    });
    await store.applySkillCandidate(lowPayload, mkCandidate("c1", lowPayload));
    // Apply high-use 3 times to bump usageCount to 3
    await store.applySkillCandidate(highPayload, mkCandidate("c2", highPayload));
    await store.applySkillCandidate(highPayload, mkCandidate("c3", highPayload));
    await store.applySkillCandidate(highPayload, mkCandidate("c4", highPayload));

    const result = await store.listActiveSkillBodies();
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("high-use");
    expect(result[1]!.name).toBe("low-use");
    expect(result[0]!.usageCount).toBeGreaterThan(result[1]!.usageCount);
  });
});

describe("LearningStore global memory scope", () => {
  let tempProject: string;
  let tempAgentDir: string;
  let store: LearningStore;

  beforeEach(() => {
    tempProject = mkdtempSync(join(tmpdir(), "store-global-mem-"));
    // Isolate agentDir so global-scope writes do NOT pollute ~/.pi/agent/learning/memory.
    // Regression guard: previously this test group wrote 99 garbage files into production.
    tempAgentDir = mkdtempSync(join(tmpdir(), "store-global-agent-"));
    store = new LearningStore(tempProject, { agentDir: tempAgentDir });
  });

  afterEach(() => {
    if (existsSync(tempProject)) rmSync(tempProject, { recursive: true, force: true });
    if (existsSync(tempAgentDir)) rmSync(tempAgentDir, { recursive: true, force: true });
  });

  function approvedMemoryCandidate(id: string, payload: { filename: string; description: string; memoryType: "user" | "project"; content: string; scope?: "project" | "global" }) {
    return {
      version: 1 as const,
      id,
      domain: "memory" as const,
      action: "create-memory" as const,
      status: "approved" as const,
      title: id,
      summary: id,
      confidence: "medium" as const,
      sourceSessionId: undefined,
      sourceMessageIds: [],
      createdAt: Date.now(),
      payload,
      fileRefs: [],
      decision: "approved" as const,
      decidedAt: Date.now(),
    };
  }

  it("writes to project memory dir when scope is 'project' or undefined", async () => {
    const payload = { filename: "project-thing.md", description: "project thing", memoryType: "project" as const, content: "project content" };
    await store.applyMemoryCandidate(payload, approvedMemoryCandidate("c1", payload));
    const projectExists = existsSync(join(store.paths.memoryDir, "project-thing.md"));
    const globalExists = existsSync(join(store.paths.globalMemoryDir, "project-thing.md"));
    expect(projectExists).toBe(true);
    expect(globalExists).toBe(false);
  });

  it("writes to global memory dir when scope is 'global'", async () => {
    const payload = { filename: "user-role.md", description: "user role", memoryType: "user" as const, content: "user is a backend dev", scope: "global" as const };
    await store.applyMemoryCandidate(payload, approvedMemoryCandidate("c2", payload));
    const projectExists = existsSync(join(store.paths.memoryDir, "user-role.md"));
    const globalExists = existsSync(join(store.paths.globalMemoryDir, "user-role.md"));
    expect(projectExists).toBe(false);
    expect(globalExists).toBe(true);
  });

  it("listMemoryFiles returns memories from both scopes", async () => {
    const projectPayload = { filename: "proj.md", description: "proj", memoryType: "project" as const, content: "proj" };
    const globalPayload = { filename: "glob.md", description: "glob", memoryType: "user" as const, content: "glob", scope: "global" as const };
    await store.applyMemoryCandidate(projectPayload, approvedMemoryCandidate("c1", projectPayload));
    await store.applyMemoryCandidate(globalPayload, approvedMemoryCandidate("c2", globalPayload));

    const files = await store.listMemoryFiles();
    const filenames = files.map((f) => f.filename);
    expect(filenames).toContain("proj.md");
    expect(filenames).toContain("glob.md");
  });

  it("maintains separate MEMORY.md entrypoints for each scope", async () => {
    const projectPayload = { filename: "proj.md", description: "proj desc", memoryType: "project" as const, content: "proj" };
    const globalPayload = { filename: "glob.md", description: "glob desc", memoryType: "user" as const, content: "glob", scope: "global" as const };
    await store.applyMemoryCandidate(projectPayload, approvedMemoryCandidate("c1", projectPayload));
    await store.applyMemoryCandidate(globalPayload, approvedMemoryCandidate("c2", globalPayload));

    const projectEntry = readFileSync(join(store.paths.memoryDir, "MEMORY.md"), "utf-8");
    const globalEntry = readFileSync(join(store.paths.globalMemoryDir, "MEMORY.md"), "utf-8");

    expect(projectEntry).toContain("proj desc");
    expect(projectEntry).not.toContain("glob desc");

    expect(globalEntry).toContain("glob desc");
    expect(globalEntry).not.toContain("proj desc");
  });
});
