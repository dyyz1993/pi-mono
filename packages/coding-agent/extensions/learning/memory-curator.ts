/**
 * Memory Curator — Dream Consolidation for Learning Extension.
 *
 * Copied from legacy memory/index.ts MemoryDream class with minimal changes:
 * - CallLLMFn import from context-provider
 * - scanMemoryFiles / utils from ./utils.ts
 * - Uses learning memory dir
 */

import { existsSync, type Stats } from "node:fs";
import { readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  scanMemoryFiles,
  truncateEntrypoint,
  isBookmarkType,
  ENTRYPOINT_NAME,
  DREAM_MIN_HOURS,
  DREAM_MIN_SESSIONS,
  type MemoryHeader,
} from "./utils.ts";
import type { CallLLMFn } from "./context-provider.ts";

// ============================================================================
// Strip markdown code blocks
// ============================================================================

function stripMarkdownCodeBlock(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) cleaned = cleaned.slice(firstNewline + 1);
    const lastBacktick = cleaned.lastIndexOf("```");
    if (lastBacktick !== -1) cleaned = cleaned.slice(0, lastBacktick);
    cleaned = cleaned.trim();
  }
  return cleaned;
}

// ============================================================================
// Dream prompt
// ============================================================================

import { DREAM_PROMPT } from "./prompts.ts";

// ============================================================================
// Read all memories helper
// ============================================================================

async function readAllMemoryContents(memories: MemoryHeader[]): Promise<string> {
  const parts = await Promise.all(
    memories.map(async (m) => {
      const content = await readFile(m.filePath, "utf-8");
      return `=== ${m.filename} ===\n${content}`;
    }),
  );
  return parts.join("\n\n");
}

// ============================================================================
// Session counter helper
// ============================================================================

async function countSessionsSince(memoryDir: string, _sinceMs: number): Promise<number> {
  try {
    const sessionsPath = join(memoryDir, ".session-count");
    if (!existsSync(sessionsPath)) {
      await writeFile(sessionsPath, "1");
      return 1;
    }
    const content = await readFile(sessionsPath, "utf-8");
    const count = Number.parseInt(content.trim(), 10) || 0;
    await writeFile(sessionsPath, String(count + 1));
    return count + 1;
  } catch (err) {
    console.debug("[learning] session count update failed:", err instanceof Error ? err.message : err);
    return DREAM_MIN_SESSIONS;
  }
}

// ============================================================================
// MemoryCurator (formerly MemoryDream)
// ============================================================================

export class MemoryCurator {
  async maybeRun(
    memoryDir: string,
    callLLM: CallLLMFn,
  ): Promise<{ merges: number; deletions: number; updates: number } | null> {
    const lockPath = join(memoryDir, ".consolidate-lock");

    if (!existsSync(lockPath)) {
      await writeFile(lockPath, "");
      await utimes(lockPath, new Date(0), new Date(0));
    }

    let lockStat: Stats;
    try {
      lockStat = await stat(lockPath);
    } catch (err) {
      console.debug("[learning] dream lock stat failed:", err instanceof Error ? err.message : err);
      return null;
    }
    const hoursSince = (Date.now() - lockStat.mtimeMs) / 3_600_000;
    if (hoursSince < DREAM_MIN_HOURS) return null;

    const sessionCount = await countSessionsSince(memoryDir, lockStat.mtimeMs);
    if (sessionCount < DREAM_MIN_SESSIONS) return null;

    try {
      const result = await this.runDream(memoryDir, callLLM);
      await utimes(lockPath, new Date(), new Date());
      return result;
    } catch (err) {
      console.debug("[learning] dream consolidation failed:", err instanceof Error ? err.message : err);
      await utimes(lockPath, new Date(lockStat.mtimeMs), new Date(lockStat.mtimeMs));
      return null;
    }
  }

  private async runDream(
    memoryDir: string,
    callLLM: CallLLMFn,
  ): Promise<{ merges: number; deletions: number; updates: number } | null> {
    const memories = await scanMemoryFiles(memoryDir);
    if (memories.length === 0) return null;

    const allContent = await readAllMemoryContents(memories);
    const entrypointPath = join(memoryDir, ENTRYPOINT_NAME);
    let indexContent = "";
    try {
      indexContent = await readFile(entrypointPath, "utf-8");
    } catch (err) {
      console.debug("[learning] dream entrypoint read failed:", err instanceof Error ? err.message : err);
    }

    const llmResult = await callLLM({
      systemPrompt: DREAM_PROMPT(allContent, indexContent, memoryDir),
      messages: [
        {
          role: "user",
          content: "Perform dream consolidation. Analyze memories and decide what to merge, delete, or update.",
        },
      ],
    });

    let parsed: {
      merges?: Array<{ sources?: string[]; target?: string; content?: string }>;
      deletions?: string[];
      updates?: Array<{ filename?: string; newContent?: string }>;
      newIndex?: string;
    };
    try {
      parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
    } catch (err) {
      console.debug("[learning] dream LLM parse failed:", err instanceof Error ? err.message : err);
      return null;
    }

    return await this.applyDreamActions(parsed, memoryDir);
  }

  private async applyDreamActions(
    parsed: {
      merges?: Array<{ sources?: string[]; target?: string; content?: string }>;
      deletions?: string[];
      updates?: Array<{ filename?: string; newContent?: string }>;
      newIndex?: string;
    },
    memoryDir: string,
  ): Promise<{ merges: number; deletions: number; updates: number }> {
    const allHeaders = await scanMemoryFiles(memoryDir);
    const bookmarkSet = new Set(allHeaders.filter(isBookmarkType).map((h) => h.filename));

    if (parsed.merges) {
      for (const merge of parsed.merges) {
        if (!merge.sources || !merge.target || merge.content === undefined) continue;

        const sources = merge.sources;
        const hasBookmark = sources.some((s) => bookmarkSet.has(s));
        const hasNonBookmark = sources.some((s) => !bookmarkSet.has(s));
        if (hasBookmark && hasNonBookmark) continue;

        await writeFile(join(memoryDir, merge.target), merge.content);
        for (const source of sources) {
          if (source === merge.target) continue;
          const sourcePath = join(memoryDir, source);
          if (existsSync(sourcePath)) {
            await unlink(sourcePath);
          }
        }
      }
    }

    if (parsed.deletions) {
      for (const filename of parsed.deletions) {
        if (bookmarkSet.has(filename)) continue;
        const filePath = join(memoryDir, filename);
        if (existsSync(filePath)) {
          await unlink(filePath);
        }
      }
    }

    if (parsed.updates) {
      for (const update of parsed.updates) {
        if (!update.filename || !update.newContent) continue;
        await writeFile(join(memoryDir, update.filename), update.newContent);
      }
    }

    const mergeCount = parsed.merges?.length ?? 0;
    const deletionCount = parsed.deletions?.length ?? 0;
    const updateCount = parsed.updates?.length ?? 0;

    if (parsed.newIndex !== undefined) {
      const { content } = truncateEntrypoint(parsed.newIndex);
      await writeFile(join(memoryDir, ENTRYPOINT_NAME), content);
    }

    return { merges: mergeCount, deletions: deletionCount, updates: updateCount };
  }
}
