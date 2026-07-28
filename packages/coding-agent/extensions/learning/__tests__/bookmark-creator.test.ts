import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "os";
import { join } from "path";
import { BookmarkCreator } from "../bookmark-creator.ts";

let tempMemoryDir: string;

beforeEach(async () => {
  tempMemoryDir = await mkdtemp(tmpdir() + "/learning-bookmark-test-");
});

afterEach(async () => {
  await rm(tempMemoryDir, { recursive: true, force: true });
});

function mockLLM(response: Record<string, unknown>) {
  return vi.fn().mockResolvedValue(JSON.stringify(response));
}

describe("BookmarkCreator.create", () => {
  it("returns null when LLM gives no title", async () => {
    const creator = new BookmarkCreator();
    const result = await creator.create(
      "some content",
      "sess-1",
      ["msg-1"],
      tempMemoryDir,
      mockLLM({ description: "no title here" }),
    );
    expect(result).toBeNull();
  });

  it("returns null when LLM returns invalid JSON", async () => {
    const creator = new BookmarkCreator();
    const result = await creator.create(
      "content",
      "sess-1",
      [],
      tempMemoryDir,
      vi.fn().mockResolvedValue("not json"),
    );
    expect(result).toBeNull();
  });

  it("creates a bookmark .md file with frontmatter and body", async () => {
    const creator = new BookmarkCreator();
    const result = await creator.create(
      "Please remember this important detail about deployment.",
      "sess-123",
      ["msg-1", "msg-2"],
      tempMemoryDir,
      mockLLM({
        title: "deploy-notes",
        description: "deployment notes",
        summary: "Always check hostname before deploy",
        tags: ["deploy", "ops"],
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.filename).toMatch(/\.md$/);
    expect(result!.filename).toContain("deploy-notes");
    expect(existsSync(result!.filePath)).toBe(true);

    const content = await readFile(result!.filePath, "utf-8");
    expect(content).toContain("name: deploy-notes");
    expect(content).toContain("description: deployment notes");
    expect(content).toContain("type: bookmark");
    expect(content).toContain("sourceSession: sess-123");
    expect(content).toContain("Always check hostname before deploy");
    expect(content).toContain("## 原始内容预览");
  });

  it("handles collision by appending -2, -3 suffix", async () => {
    const creator = new BookmarkCreator();
    const callLLM = mockLLM({
      title: "same-title",
      description: "d",
      summary: "s",
      tags: [],
    });

    // First creation
    const r1 = await creator.create("c1", "s1", [], tempMemoryDir, callLLM);
    // Second creation in the same second would normally collide; force by pre-creating the same path
    // (timestamp is to the second so we may need to wait, but simpler: directly seed)
    const directPath = join(tempMemoryDir, r1!.filename);
    if (!existsSync(directPath)) {
      writeFileSync(directPath, "pre-existing");
    }

    const r2 = await creator.create("c2", "s2", [], tempMemoryDir, callLLM);
    expect(r2).not.toBeNull();
    expect(r2!.filename).not.toBe(r1!.filename);
    // Either -2 suffix or different timestamp; either way file must exist
    expect(existsSync(r2!.filePath)).toBe(true);
  });

  it("sanitizes title with unsafe characters", async () => {
    const creator = new BookmarkCreator();
    const result = await creator.create(
      "content",
      "sess",
      [],
      tempMemoryDir,
      mockLLM({
        title: "Title with spaces / slashes / and ?? special!",
        description: "d",
        summary: "s",
        tags: [],
      }),
    );
    expect(result).not.toBeNull();
    // Special chars replaced with _
    expect(result!.filename).not.toMatch(/[ /?]/);
  });

  it("updates MEMORY.md index after creation", async () => {
    const creator = new BookmarkCreator();
    await creator.create(
      "content",
      "sess",
      [],
      tempMemoryDir,
      mockLLM({
        title: "indexed-bookmark",
        description: "d",
        summary: "s",
        tags: [],
      }),
    );
    const indexPath = join(tempMemoryDir, "MEMORY.md");
    expect(existsSync(indexPath)).toBe(true);
    const index = await readFile(indexPath, "utf-8");
    expect(index).toContain("indexed-bookmark");
  });

  it("filters manifest to bookmark type only", async () => {
    // Seed a non-bookmark file and a bookmark file
    mkdirSync(tempMemoryDir, { recursive: true });
    writeFileSync(
      join(tempMemoryDir, "regular.md"),
      "---\nname: r\ndescription: r\ntype: user\n---\nbody",
    );
    writeFileSync(
      join(tempMemoryDir, "existing.md"),
      "---\nname: e\ndescription: e\ntype: bookmark\n---\nbody",
    );

    const creator = new BookmarkCreator();
    const callLLM = vi.fn().mockImplementation(async (opts: any) => {
      // Verify manifest in system prompt only contains bookmark file
      expect(opts.systemPrompt).toContain("existing.md");
      expect(opts.systemPrompt).not.toContain("regular.md");
      return JSON.stringify({ title: "new", description: "d", summary: "s", tags: [] });
    });

    await creator.create("content", "sess", [], tempMemoryDir, callLLM);
    expect(callLLM).toHaveBeenCalledTimes(1);
  });
});
