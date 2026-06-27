import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryPrefetch, buildPrefetchUserMessage } from "../context-provider.ts";
import type { SkipRule, HistoryEntry } from "../skip-rules.ts";

// Mock utils: scanMemoryFiles returns 6 files (> MAX_RELEVANT_MEMORIES=5) to force LLM selection path
vi.mock("../utils.ts", () => ({
  scanMemoryFiles: vi.fn().mockResolvedValue([
    { filename: "a.md", filePath: "/tmp/memory/a.md", mtimeMs: 100, description: "A", type: "user" },
    { filename: "b.md", filePath: "/tmp/memory/b.md", mtimeMs: 99, description: "B", type: "project" },
    { filename: "c.md", filePath: "/tmp/memory/c.md", mtimeMs: 98, description: "C", type: "feedback" },
    { filename: "d.md", filePath: "/tmp/memory/d.md", mtimeMs: 97, description: "D", type: "reference" },
    { filename: "e.md", filePath: "/tmp/memory/e.md", mtimeMs: 96, description: "E", type: "user" },
    { filename: "f.md", filePath: "/tmp/memory/f.md", mtimeMs: 95, description: "F", type: "project" },
  ]),
  formatManifest: vi.fn((headers: any[]) => headers.map((h: any) => h.filename).join("\n")),
  MAX_RELEVANT_MEMORIES: 5,
  MAX_MEMORY_BYTES_PER_FILE: 8000,
  ENTRYPOINT_NAME: "MEMORY.md",
  isBookmarkType: vi.fn(() => false),
}));

// Mock node:fs/promises for readFile
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("mock file content"),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock skip-rules: return "no skip" always
vi.mock("../skip-rules.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skip-rules.ts")>();
  return {
    ...actual,
    evaluateRules: vi.fn().mockReturnValue({ shouldSkip: false, skipHits: [], guardHits: [] }),
    loadSkipWordStore: vi.fn().mockReturnValue({ rules: [], history: [], excludeKeywords: [] }),
    saveSkipWordStore: vi.fn().mockResolvedValue(undefined),
    addHistoryEntry: vi.fn((store: any, entry: any) => ({
      ...store,
      history: [...(store.history ?? []), entry],
    })),
    applyPurification: vi.fn((store: any) => store),
  };
});

// ============================================================================
// buildPrefetchUserMessage tests
// ============================================================================

function extractHistoryJSON(output: string): unknown[] {
  const marker = "## 最近 Prefetch 历史\n";
  const idx = output.indexOf(marker);
  if (idx === -1) throw new Error("history section not found in output");
  const json = output.slice(idx + marker.length);
  return JSON.parse(json);
}

function makeHistory(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    query: "test query",
    selected: ["file1.md"],
    skipped: false,
    skip_hits: [],
    guard_hits: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("buildPrefetchUserMessage", () => {
  it("serializes history entry with userMarkedIrrelevant: true", () => {
    const history = [makeHistory({ userMarkedIrrelevant: true })];
    const output = buildPrefetchUserMessage("q", "manifest", [], history);
    const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
    expect(parsed[0].userMarkedIrrelevant).toBe(true);
  });

  it("serializes history entry with userMarkedIrrelevant: false", () => {
    const history = [makeHistory({ userMarkedIrrelevant: false })];
    const output = buildPrefetchUserMessage("q", "manifest", [], history);
    const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
    expect(parsed[0].userMarkedIrrelevant).toBe(false);
  });

  it("serializes history entry with irrelevantFiles", () => {
    const history = [makeHistory({ irrelevantFiles: ["a.ts", "b.ts"] })];
    const output = buildPrefetchUserMessage("q", "manifest", [], history);
    const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
    expect(parsed[0].irrelevantFiles).toEqual(["a.ts", "b.ts"]);
  });

  it("produces valid output with empty history", () => {
    const output = buildPrefetchUserMessage("q", "manifest", [], []);
    const parsed = extractHistoryJSON(output);
    expect(parsed).toEqual([]);
    expect(output).toContain("## 当前查询\nq");
    expect(output).toContain("## 可用文件\nmanifest");
  });

  it("includes custom rules when present", () => {
    const baseRule: SkipRule = { pattern: "test", mode: "exact", action: "skip", builtin: true };
    const customRule: SkipRule = { pattern: "custom_", mode: "prefix", action: "skip", builtin: false };
    const output = buildPrefetchUserMessage("q", "manifest", [baseRule, customRule], []);
    expect(output).toContain('"pattern": "custom_"');
    expect(output).toContain('"mode": "prefix"');
    expect(output).toContain('"action": "skip"');
  });

  it('shows "(no custom rules)" when no custom rules', () => {
    const baseRule: SkipRule = { pattern: "test", mode: "exact", action: "skip", builtin: true };
    const output = buildPrefetchUserMessage("q", "manifest", [baseRule], []);
    expect(output).toContain("(no custom rules)");
  });

  it("serializes multiple history entries", () => {
    const history = [
      makeHistory({ query: "q1", selected: ["a.md"] }),
      makeHistory({ query: "q2", selected: ["b.md"] }),
      makeHistory({ query: "q3", selected: ["c.md"] }),
    ];
    const output = buildPrefetchUserMessage("q", "manifest", [], history);
    const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(3);
    expect(parsed[0].query).toBe("q1");
    expect(parsed[1].query).toBe("q2");
    expect(parsed[2].query).toBe("q3");
  });

  it("handles large history (>5 entries) without crashing", () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      makeHistory({ query: `q${i}`, selected: [`f${i}.md`], timestamp: 1000 + i }),
    );
    const output = buildPrefetchUserMessage("q", "manifest", [], history);
    const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(10);
    expect(parsed[0].query).toBe("q0");
    expect(parsed[9].query).toBe("q9");
  });

  it("includes query in output", () => {
    const output = buildPrefetchUserMessage("find all todos", "manifest", [], []);
    expect(output).toContain("## 当前查询\nfind all todos");
  });

  it("includes manifest in output", () => {
    const output = buildPrefetchUserMessage("q", "file list here", [], []);
    expect(output).toContain("## 可用文件\nfile list here");
  });

  it("serializes entry with both userMarkedIrrelevant and irrelevantFiles", () => {
    const history = [
      makeHistory({ userMarkedIrrelevant: true, irrelevantFiles: ["x.ts", "y.ts"], query: "bad query" }),
    ];
    const output = buildPrefetchUserMessage("q", "manifest", [], history);
    const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
    expect(parsed[0].userMarkedIrrelevant).toBe(true);
    expect(parsed[0].irrelevantFiles).toEqual(["x.ts", "y.ts"]);
    expect(parsed[0].query).toBe("bad query");
  });

  it("handles entry without userMarkedIrrelevant field (backward compat)", () => {
    const history: HistoryEntry[] = [
      { query: "old query", selected: ["old.md"], skipped: false, skip_hits: [], guard_hits: [], timestamp: 5000 },
    ];
    const output = buildPrefetchUserMessage("q", "manifest", [], history);
    const parsed = extractHistoryJSON(output) as Array<Record<string, unknown>>;
    expect(parsed[0].userMarkedIrrelevant).toBe(false);
    expect(parsed[0].irrelevantFiles).toEqual([]);
  });
});

// ============================================================================
// MemoryPrefetch.collect() tests
// ============================================================================

describe("MemoryPrefetch.collect() — 非阻塞上下文注入", () => {
  let prefetch: MemoryPrefetch;

  beforeEach(() => {
    prefetch = new MemoryPrefetch();
  });

  it("collect() 在 prefetch 未启动时返回 null", () => {
    expect(prefetch.collect()).toBeNull();
  });

  it("collect() 在 prefetch 启动后立即返回 null（不阻塞）", () => {
    const neverEnd = new Promise<string>(() => { });
    const callLLM = vi.fn().mockReturnValue(neverEnd);

    prefetch.start("test query", "/tmp/memory", callLLM, "op-1");
    expect(prefetch.collect()).toBeNull(); // ✅ 直接返回 null，不等待
  });

  it("collect() 在 prefetch 完成后返回结果", async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({ selected: ["a.md", "b.md", "c.md"] }));

    prefetch.start("test query", "/tmp/memory", callLLM, "op-2");
    expect(prefetch.collect()).toBeNull();

    await new Promise((r) => setTimeout(r, 50));

    const result = prefetch.collect();
    expect(result).not.toBeNull();
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it("collect() 多次调用返回相同结果（幂等）", async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({ selected: ["a.md"] }));

    prefetch.start("test", "/tmp/memory", callLLM, "op-3");
    await new Promise((r) => setTimeout(r, 50));

    const first = prefetch.collect();
    const second = prefetch.collect();
    expect(first).toBe(second);
  });

  it("collect() 不依赖 operationId，有 settled 结果就返回", async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({ selected: ["b.md", "c.md"] }));

    prefetch.start("test", "/tmp/memory", callLLM, "op-4");
    await new Promise((r) => setTimeout(r, 50));

    const result = prefetch.collect();
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });
});

describe("MemoryPrefetch — context handler 非阻塞集成行为", () => {
  let prefetch: MemoryPrefetch;

  beforeEach(() => {
    prefetch = new MemoryPrefetch();
  });

  it("prefetch 未启动时 collect() 返回 null，context 可安全跳过", () => {
    const memoryText = prefetch.collect();
    expect(memoryText).toBeNull();
  });

  it("时序验证：start → collect()=null → LLM完成 → collect()=结果", async () => {
    const deferred = Promise.withResolvers<string>();
    const callLLM = vi.fn().mockReturnValue(deferred.promise);

    prefetch.start("user query", "/tmp/memory", callLLM, "op-flow-1");

    await new Promise((r) => setTimeout(r, 5));

    const round1Result = prefetch.collect();
    expect(round1Result).toBeNull(); // ✅ 不阻塞，跳过注入

    deferred.resolve(JSON.stringify({ selected: ["a.md"] }));
    await new Promise((r) => setTimeout(r, 10));

    const round2Result = prefetch.collect();
    expect(round2Result).not.toBeNull();
  });

  it("多轮次：prefetch 完成后每次 collect 都可获取结果", async () => {
    const callLLM = vi.fn().mockResolvedValue(JSON.stringify({ selected: ["a.md", "b.md", "c.md"] }));

    prefetch.start("query", "/tmp/memory", callLLM, "op-flow-2");
    await new Promise((r) => setTimeout(r, 50));

    const r1 = prefetch.collect();
    const r2 = prefetch.collect();
    const r3 = prefetch.collect();
    expect(r1).toBeTruthy();
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });
});
