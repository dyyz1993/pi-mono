/**
 * Memory Context Provider for Learning Extension.
 *
 * Provides non-blocking memory selection (prefetch) for context injection.
 * Copied from legacy memory/index.ts MemoryPrefetch class and adapted
 * for the learning extension's event model.
 *
 * Key design: collect() returns immediately (null if not settled),
 * so the context handler never blocks the agent loop.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { CallLLMOptions } from "@dyyz1993/pi-coding-agent";
import {
  type HistoryEntry,
  type SkipRule,
  type SkipWordStore,
  type PurificationResult,
  addHistoryEntry,
  applyPurification,
  evaluateRules,
  getDefaultRules,
  loadSkipWordStore,
  saveSkipWordStore,
  getGlobalLearningDir,
} from "./skip-rules.ts";
import {
  SELECT_MEMORIES_PROMPT,
  MEMORY_SYSTEM_PROMPT,
  PURIFICATION_PROMPT,
} from "./prompts.ts";
import {
  formatManifest,
  scanMemoryFiles,
  MAX_RELEVANT_MEMORIES,
  truncateEntrypoint,
  stripMarkdownCodeBlock,
  messageText,
  findExistingMemoryContext,
  type CallLLMFn, logger
} from "./utils.ts";

// ============================================================================
// Prefetch Debug Info
// ============================================================================

interface PrefetchDebugInfo {
  selectedFiles: string[];
  durationMs: number;
  layer: "skip" | "llm" | "none" | "auto" | "unknown";
  skipHits: Array<{ pattern: string; mode: string }>;
  guardHits: Array<{ pattern: string; mode: string }>;
  availableFiles: number;
  excludedFiles?: number;
  query: string;
}

// ============================================================================
// Constants
// ============================================================================

const PREFETCH_MIN_INTERVAL_MS = 30_000;
const PREFETCH_REPEAT_THRESHOLD = 3;

// ============================================================================
// buildPrefetchUserMessage
// ============================================================================

export function buildPrefetchUserMessage(query: string, manifest: string, rules: SkipRule[], history: HistoryEntry[]): string {
  const customRules = rules.filter((r) => !r.builtin);
  const rulesSummary = customRules.length > 0
    ? customRules
      .map((r) => `{ "pattern": "${r.pattern}", "mode": "${r.mode}", "action": "${r.action}" }`)
      .join("\n")
    : "(no custom rules)";

  const historySummary = JSON.stringify(
    history.map((h) => ({
      query: h.query,
      selected: h.selected,
      skipped: h.skipped,
      userMarkedIrrelevant: h.userMarkedIrrelevant ?? false,
      irrelevantFiles: h.irrelevantFiles ?? [],
    })),
  );

  return `## 当前查询\n${query}\n\n## 可用文件\n${manifest}\n\n## 自定义规则库\n${rulesSummary}\n\n## 最近 Prefetch 历史\n${historySummary}`;
}

// ============================================================================
// MemoryPrefetch — Non-Blocking Memory Selection
// ============================================================================

export class MemoryPrefetch {
  private promise: Promise<string> | null = null;
  private settled = false;
  private result: string | null = null;
  private lastSelected: string[] = [];
  private resultEntryWritten = false;
  private _operationId: string | null = null;
  private store: SkipWordStore | null = null;
  private _debugInfo: PrefetchDebugInfo | null = null;
  private lastPrefetchTime = 0;
  private consecutiveSameCount = 0;
  private cachedFileCount = -1;
  private dirtyFiles = true;

  get debugInfo(): PrefetchDebugInfo | null {
    return this._debugInfo;
  }

  get selectedFiles(): string[] {
    return this.lastSelected;
  }

  get operationId(): string | null {
    return this._operationId;
  }

  markResultEntryWritten(operationId?: string): boolean {
    if (operationId && this._operationId !== operationId) return true;
    if (this.resultEntryWritten) return true;
    this.resultEntryWritten = true;
    return false;
  }

  markDirty(): void {
    this.dirtyFiles = true;
  }

  getStore(): SkipWordStore {
    return this.ensureStore();
  }

  start(query: string, memoryDir: string, callLLM: CallLLMFn, operationId: string): void {
    this._operationId = operationId;
    const now = Date.now();
    const elapsed = now - this.lastPrefetchTime;

    // Layer 0: 30s 内复用上次结果（必须是已 settle 的结果，避免覆盖进行中的 LLM 调用）
    if (this.settled && this.lastPrefetchTime > 0 && elapsed < PREFETCH_MIN_INTERVAL_MS) {
      this._debugInfo = {
        selectedFiles: this.lastSelected,
        durationMs: 0,
        layer: "skip",
        skipHits: [{ pattern: `min-interval(${Math.round(elapsed / 1000)}s<${PREFETCH_MIN_INTERVAL_MS / 1000}s)`, mode: "builtin" }],
        guardHits: [],
        availableFiles: this.cachedFileCount >= 0 ? this.cachedFileCount : 0,
        query: query.slice(0, 200),
      };
      this.settled = true;
      this.result = this.result ?? "";
      this.resultEntryWritten = false;
      this.promise = Promise.resolve(this.result);
      return;
    }

    // Layer 1: 文件少且没变化 → 直接全注入，不调 LLM
    if (!this.dirtyFiles && this.cachedFileCount >= 0 && this.cachedFileCount <= MAX_RELEVANT_MEMORIES && this.result !== null) {
      this._debugInfo = {
        selectedFiles: this.lastSelected,
        durationMs: 0,
        layer: "auto",
        skipHits: [{ pattern: `all-cached(${this.cachedFileCount}f)`, mode: "builtin" }],
        guardHits: [],
        availableFiles: this.cachedFileCount,
        query: query.slice(0, 200),
      };
      this.settled = true;
      this.resultEntryWritten = false;
      this.lastPrefetchTime = now;
      this.promise = this.runReadCached(this.lastSelected, memoryDir);
      void this.promise.then((r) => {
        this.result = r;
      });
      return;
    }

    // Layer 2: 连续相同结果检测
    if (this.consecutiveSameCount >= PREFETCH_REPEAT_THRESHOLD && this.lastSelected.length > 0) {
      this._debugInfo = {
        selectedFiles: this.lastSelected,
        durationMs: 0,
        layer: "skip",
        skipHits: [{ pattern: `repeat-detect(${this.consecutiveSameCount}x)`, mode: "builtin" }],
        guardHits: [],
        availableFiles: this.cachedFileCount >= 0 ? this.cachedFileCount : 0,
        query: query.slice(0, 200),
      };
      this.settled = true;
      this.resultEntryWritten = false;
      this.lastPrefetchTime = now;
      this.promise = this.runReadCached(this.lastSelected, memoryDir);
      void this.promise.then((r) => {
        this.result = r;
      });
      return;
    }

    // Layer 3: skip/guard 规则
    const store = this.ensureStore();
    const { shouldSkip, skipHits, guardHits } = evaluateRules(query, store.rules);
    if (shouldSkip) {
      const matchedRules = store.rules
        .filter((r) => skipHits.includes(r.pattern) || guardHits.includes(r.pattern))
        .map((r) => ({ pattern: r.pattern, mode: r.mode, action: r.action }));
      const matchedSkip = matchedRules.filter((r) => r.action === "skip").map(({ pattern, mode }) => ({ pattern, mode }));
      const matchedGuard = matchedRules.filter((r) => r.action !== "skip").map(({ pattern, mode }) => ({ pattern, mode }));

      this._debugInfo = {
        selectedFiles: [],
        durationMs: 0,
        layer: "skip",
        skipHits: matchedSkip,
        guardHits: matchedGuard,
        availableFiles: this.cachedFileCount >= 0 ? this.cachedFileCount : 0,
        query: query.slice(0, 200),
      };
      this.settled = true;
      this.result = "";
      this.resultEntryWritten = false;
      this.lastPrefetchTime = now;
      this.promise = Promise.resolve("");
      return;
    }

    // Layer 4: 走 LLM（或 auto-inject）
    this.lastPrefetchTime = now;
    this.settled = false;
    this.result = null;
    this._debugInfo = null;
    this.resultEntryWritten = false;
    this.promise = this.run(query, memoryDir, callLLM);
    void this.promise.then((r) => {
      this.result = r;
      this.settled = true;
    });
  }

  get started(): boolean {
    return this.promise !== null;
  }

  /**
   * Non-blocking: returns null if prefetch hasn't settled yet.
   * This is the safe API for context handlers that must not block the agent loop.
   */
  collect(): string | null {
    return this.settled ? this.result : null;
  }

  async awaitResult(timeoutMs = 30_000): Promise<string | null> {
    if (this.promise) {
      await Promise.race([
        this.promise,
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
    return this.collect();
  }

  async waitForOperation(operationId: string): Promise<string | null> {
    const promise = this.promise;
    if (!promise || this._operationId !== operationId) return null;
    try {
      const result = await promise;
      return this._operationId === operationId ? result : null;
    } catch {
      return this._operationId === operationId ? "" : null;
    }
  }

  private ensureStore(): SkipWordStore {
    if (!this.store) {
      this.store = loadSkipWordStore(getGlobalLearningDir());
    }
    return this.store;
  }

  private async run(query: string, memoryDir: string, callLLM: CallLLMFn): Promise<string> {
    try {
      let store = this.ensureStore();
      const { skipHits, guardHits } = evaluateRules(query, store.rules);

      const matchedRules = store.rules
        .filter((r) => skipHits.includes(r.pattern) || guardHits.includes(r.pattern))
        .map((r) => ({ pattern: r.pattern, mode: r.mode, action: r.action }));
      const matchedSkip = matchedRules.filter((r) => r.action === "skip").map(({ pattern, mode }) => ({ pattern, mode }));
      const matchedGuard = matchedRules.filter((r) => r.action !== "skip").map(({ pattern, mode }) => ({ pattern, mode }));

      const memories = await scanMemoryFiles(memoryDir);
      this.cachedFileCount = memories.length;

      // 用 excludeKeywords 过滤
      let filteredMemories = memories;
      if (store.excludeKeywords.length > 0) {
        const keywords = store.excludeKeywords.map((k) => k.toLowerCase());
        filteredMemories = memories.filter((m) => {
          const content = (m.filename + " " + (m.description ?? "")).toLowerCase();
          return !keywords.some((kw) => content.includes(kw));
        });
      }

      if (filteredMemories.length === 0) {
        this.dirtyFiles = false;
        this._debugInfo = {
          selectedFiles: [],
          durationMs: 0,
          layer: "none",
          skipHits: matchedSkip,
          guardHits: matchedGuard,
          availableFiles: memories.length,
          excludedFiles: memories.length - filteredMemories.length,
          query: query.slice(0, 200),
        };
        return "";
      }

      // Auto-inject: 文件少 → 全部注入，不调 LLM
      if (filteredMemories.length <= MAX_RELEVANT_MEMORIES) {
        const allFiles = filteredMemories.map((m) => m.filename);
        this.lastSelected = allFiles;
        this.dirtyFiles = false;
        this._debugInfo = {
          selectedFiles: allFiles,
          durationMs: 0,
          layer: "auto",
          skipHits: matchedSkip,
          guardHits: matchedGuard,
          availableFiles: filteredMemories.length,
          excludedFiles: memories.length - filteredMemories.length,
          query: query.slice(0, 200),
        };
        return await this.readFiles(allFiles, memoryDir);
      }

      const manifest = formatManifest(filteredMemories);
      const recentHistory = this.buildHistoryForLLM(store.history);
      const startTime = Date.now();

      const llmResult = await callLLM({
        systemPrompt: SELECT_MEMORIES_PROMPT,
        messages: [
          {
            role: "user",
            content: buildPrefetchUserMessage(query, manifest, store.rules, recentHistory),
          },
        ],
      });

      let parsed: { selected?: string[]; purification?: PurificationResult };
      try {
        parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
      } catch (err) {
        logger.warn("prefetch LLM parse failed", { error: err instanceof Error ? err.message : err });
        this._debugInfo = {
          selectedFiles: [],
          durationMs: Date.now() - startTime,
          layer: "llm",
          skipHits: matchedSkip,
          guardHits: matchedGuard,
          availableFiles: memories.length,
          query: query.slice(0, 200),
        };
        return "";
      }

      const selected = (parsed.selected ?? []).slice(0, MAX_RELEVANT_MEMORIES);

      if (this.arraysEqual(selected, this.lastSelected)) {
        this.consecutiveSameCount++;
      } else {
        this.consecutiveSameCount = 0;
      }
      this.lastSelected = selected;

      if (parsed.purification && typeof parsed.purification === "object") {
        try {
          store = applyPurification(store, parsed.purification);
        } catch (err) {
          logger.warn("purification failed", { error: err instanceof Error ? err.message : err });
        }
      }

      store = addHistoryEntry(store, {
        query: query.slice(0, 200),
        selected,
        skipped: false,
        skip_hits: skipHits,
        guard_hits: guardHits,
        timestamp: Date.now(),
      });
      this.store = store;
      await saveSkipWordStore(getGlobalLearningDir(), this.store);

      this._debugInfo = {
        selectedFiles: selected,
        durationMs: Date.now() - startTime,
        layer: "llm",
        skipHits: matchedSkip,
        guardHits: matchedGuard,
        availableFiles: memories.length,
        query: query.slice(0, 200),
      };

      if (selected.length === 0) return "";

      return await this.readFiles(selected, memoryDir);
    } catch (err) {
      logger.warn("prefetch failed", { error: err instanceof Error ? err.message : err });
      this._debugInfo = {
        selectedFiles: [],
        durationMs: 0,
        layer: "none",
        skipHits: [],
        guardHits: [],
        availableFiles: 0,
        query: query.slice(0, 200),
      };
      return "";
    }
  }

  private async readFiles(filenames: string[], memoryDir: string): Promise<string> {
    const parts: string[] = [];
    for (const name of filenames) {
      try {
        const content = await readFile(join(memoryDir, name), "utf-8");
        parts.push(`### ${name}\n${content}`);
      } catch (err) {
        logger.warn("memory file read failed", { error: err instanceof Error ? err.message : err });
      }
    }
    return parts.join("\n\n");
  }

  private async runReadCached(filenames: string[], memoryDir: string): Promise<string> {
    return await this.readFiles(filenames, memoryDir);
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every((item) => setB.has(item));
  }

  private buildHistoryForLLM(history: HistoryEntry[]): HistoryEntry[] {
    const recent = history.slice(-3);
    const marked = history.filter((h) => h.userMarkedIrrelevant);
    const seen = new Set(recent.map((h) => h.timestamp));
    const extra = marked.filter((h) => !seen.has(h.timestamp)).slice(-5);
    return [...recent, ...extra].sort((a, b) => a.timestamp - b.timestamp);
  }
}

// ============================================================================
// MaybePurify — Extract exclusion keywords from user-marked irrelevant history
// ============================================================================

export async function maybePurify(memoryDir: string, callLLM: CallLLMFn): Promise<string[] | null> {
  const store = loadSkipWordStore(getGlobalLearningDir());
  const unprocessed = store.history.filter((h) => h.userMarkedIrrelevant && h.irrelevantFiles?.length);

  if (unprocessed.length < 2) return null;

  const fileSet = new Set<string>();
  for (const entry of unprocessed) {
    for (const f of entry.irrelevantFiles ?? []) {
      fileSet.add(f);
    }
  }

  const markedFiles: Array<{ filename: string; content: string }> = [];
  for (const filename of fileSet) {
    const filePath = join(memoryDir, filename);
    if (!existsSync(filePath)) continue;
    try {
      const content = await readFile(filePath, "utf-8");
      markedFiles.push({ filename, content });
    } catch {
      markedFiles.push({ filename, content: "" });
    }
  }

  if (markedFiles.length === 0) return null;

  const llmResult = await callLLM({
    systemPrompt: PURIFICATION_PROMPT(markedFiles, store.excludeKeywords),
    messages: [{ role: "user", content: "Extract exclusion keywords from the marked files." }],
  });

  let parsed: { keywords?: string[] };
  try {
    parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
  } catch (err) {
    logger.warn("purification LLM parse failed", { error: err instanceof Error ? err.message : err });
    return null;
  }

  const newKeywords = (parsed.keywords ?? []).filter(
    (k) => typeof k === "string" && k.length >= 2 && k.length <= 30 && !store.excludeKeywords.includes(k),
  );

  if (newKeywords.length === 0) return null;

  store.excludeKeywords = [...store.excludeKeywords, ...newKeywords];
  await saveSkipWordStore(getGlobalLearningDir(), store);

  return newKeywords;
}
