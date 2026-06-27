/**
 * Bookmark Creator for Learning Extension.
 *
 * Copied from legacy memory/index.ts BookmarkCreator class with minimal changes.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scanMemoryFiles, isBookmarkType, buildBookmarkFrontmatter, formatManifest, updateMemoryIndex } from "./utils.ts";
import { BOOKMARK_SUMMARY_PROMPT } from "./prompts.ts";
import type { CallLLMOptions } from "@dyyz1993/pi-coding-agent";

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
        console.debug("[learning] bookmark LLM parse failed:", err instanceof Error ? err.message : err);
        return null;
      }

      if (!parsed.title) return null;

      const safeTitle = parsed.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_").slice(0, 50);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `${timestamp}_${safeTitle}.md`;
      const filePath = join(memoryDir, filename);

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
      console.debug("[learning] bookmark creation failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }
}
