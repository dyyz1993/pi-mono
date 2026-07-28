/**
 * Bookmark Creator for Learning Extension.
 *
 * Copied from legacy memory/index.ts BookmarkCreator class with minimal changes.
 */

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scanMemoryFiles, isBookmarkType, buildBookmarkFrontmatter, formatManifest, updateMemoryIndex, stripMarkdownCodeBlock, logger } from "./utils.ts";
import { BOOKMARK_SUMMARY_PROMPT } from "./prompts.ts";
import type { CallLLMOptions } from "@dyyz1993/pi-coding-agent";

export class BookmarkCreator {
  async create(
    messageContent: string,
    sessionId: string,
    messageIds: string[],
    memoryDir: string,
    callLLM: (opts: CallLLMOptions) => Promise<string>,
  ): Promise<{ filename: string; filePath: string } | null> {
    try {
      const manifest = formatManifest((await scanMemoryFiles(memoryDir)).filter((m) => isBookmarkType(m)));

      const llmResult = await callLLM({
        systemPrompt: BOOKMARK_SUMMARY_PROMPT(messageContent, manifest),
        messages: [{ role: "user", content: "Create a bookmark summary for this content." }],
      });

      let parsed: { title?: string; description?: string; summary?: string; tags?: string[] };
      try {
        parsed = JSON.parse(stripMarkdownCodeBlock(llmResult));
      } catch (err) {
        logger.warn("bookmark LLM parse failed", { error: err instanceof Error ? err.message : err });
        return null;
      }

      if (!parsed.title) return null;

      const safeTitle = parsed.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_").slice(0, 50);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const baseName = `${timestamp}_${safeTitle}`;
      let filename = `${baseName}.md`;
      let filePath = join(memoryDir, filename);
      let suffix = 2;
      while (existsSync(filePath)) {
        filename = `${baseName}-${suffix}.md`;
        filePath = join(memoryDir, filename);
        suffix += 1;
      }

      const fm = buildBookmarkFrontmatter({
        name: parsed.title,
        description: parsed.description ?? "",
        sourceSession: sessionId,
        sourceMessageIds: messageIds,
        tags: parsed.tags ?? [],
        createdAt: new Date().toISOString(),
      });

      const body = `## ${parsed.title}\n\n${parsed.summary ?? ""}\n\n---\n\n## 原始内容预览\n\n> ${messageContent.slice(0, 500)}${messageContent.length > 500 ? "..." : ""}`;

      await writeFile(filePath, `${fm}\n\n${body}`);
      await updateMemoryIndex(memoryDir);

      return { filename, filePath };
    } catch (err) {
      logger.warn("bookmark creation failed", { error: err instanceof Error ? err.message : err });
      return null;
    }
  }
}
