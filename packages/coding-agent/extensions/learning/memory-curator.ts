/**
 * Memory Curator — Dream Consolidation for Learning Extension.
 *
 * 架构变更（2026-07-19）：
 * 之前 maybeRun() 会直接调用 applyDreamActions() 修改 memory 文件（writeFile/unlink），
 * 完全绕过 candidate 审批系统。现在改为 dry-run only：
 * - LLM 生成 consolidation plan（merges/deletions/updates）
 * - 只返回 plan，不执行任何文件修改
 * - 调用方（index.ts）把 plan 写入 run 历史供用户查看
 * - 用户想真正执行时，通过 store.runCurator({ domain: "memory", mode: "apply" }) 手动触发
 *
 * 这样彻底解决 Dream 绕过审批的问题，且不增加审批负担。
 */

import { existsSync } from "node:fs";
import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  scanMemoryFiles,
  ENTRYPOINT_NAME,
  DREAM_MIN_HOURS,
  DREAM_MIN_SESSIONS,
  stripMarkdownCodeBlock,
  type MemoryHeader,
  type CallLLMFn,
  logger,
} from "./utils.ts";

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

async function countSessionsSince(memoryDir: string): Promise<number> {
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
    logger.warn("session count update failed", { error: err instanceof Error ? err.message : err });
    return DREAM_MIN_SESSIONS;
  }
}

// ============================================================================
// Dream plan type
// ============================================================================

export interface DreamPlan {
  merges: Array<{ sources?: string[]; target?: string; content?: string }>;
  deletions: string[];
  updates: Array<{ filename?: string; newContent?: string }>;
  newIndex?: string;
}

// ============================================================================
// MemoryCurator — Dry-Run Only
// ============================================================================

export class MemoryCurator {
  /**
   * 检查是否应该运行 dream consolidation。
   * 只在满足条件时（24h + 5 session）运行，且只生成 plan 不执行。
   */
  async maybeRun(
    memoryDir: string,
    callLLM: CallLLMFn,
  ): Promise<DreamPlan | null> {
    const lockPath = join(memoryDir, ".consolidate-lock");

    if (!existsSync(lockPath)) {
      await writeFile(lockPath, "");
      await utimes(lockPath, new Date(0), new Date(0));
    }

    let lockStat: Awaited<ReturnType<typeof stat>>;
    try {
      lockStat = await stat(lockPath);
    } catch (err) {
      logger.warn("dream lock stat failed", { error: err instanceof Error ? err.message : err });
      return null;
    }
    const hoursSince = (Date.now() - lockStat.mtimeMs) / 3_600_000;
    if (hoursSince < DREAM_MIN_HOURS) return null;

    const sessionCount = await countSessionsSince(memoryDir);
    if (sessionCount < DREAM_MIN_SESSIONS) return null;

    try {
      const plan = await this.generatePlan(memoryDir, callLLM);
      // 更新 lock 时间，避免频繁触发
      await utimes(lockPath, new Date(), new Date());
      // 重置 session 计数器：dream 已触发，重新累积"自上次 dream 以来的 session 数"
      const sessionsPath = join(memoryDir, ".session-count");
      if (existsSync(sessionsPath)) {
        await writeFile(sessionsPath, "0");
      }
      return plan;
    } catch (err) {
      logger.warn("dream plan generation failed", { error: err instanceof Error ? err.message : err });
      await utimes(lockPath, new Date(lockStat.mtimeMs), new Date(lockStat.mtimeMs));
      return null;
    }
  }

  /**
   * 生成 dream consolidation plan（不执行任何文件修改）。
   */
  private async generatePlan(
    memoryDir: string,
    callLLM: CallLLMFn,
  ): Promise<DreamPlan | null> {
    const memories = await scanMemoryFiles(memoryDir);
    if (memories.length === 0) return null;

    const allContent = await readAllMemoryContents(memories);
    const entrypointPath = join(memoryDir, ENTRYPOINT_NAME);
    let indexContent = "";
    try {
      indexContent = await readFile(entrypointPath, "utf-8");
    } catch {
      // entrypoint 可能不存在，忽略
    }

    const llmResult = await callLLM({
      systemPrompt: DREAM_PROMPT(allContent, indexContent),
      messages: [
        {
          role: "user",
          content: "Perform dream consolidation. Analyze memories and decide what to merge, delete, or update.",
        },
      ],
    });

    let parsed: DreamPlan;
    try {
      parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
    } catch (err) {
      logger.warn("dream LLM parse failed", { error: err instanceof Error ? err.message : err });
      return null;
    }

    return {
      merges: parsed.merges ?? [],
      deletions: parsed.deletions ?? [],
      updates: parsed.updates ?? [],
      newIndex: parsed.newIndex,
    };
  }

}
