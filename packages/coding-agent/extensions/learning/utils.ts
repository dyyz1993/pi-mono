/**
 * Utility functions for the Learning Extension.
 *
 * Copied from legacy memory/utils.ts with minimal changes:
 * - getMemoryDir now uses getLearningPaths().memoryDir (consistent with store.ts)
 * - getGlobalMemoryDir → getGlobalLearningDir (from skip-rules.ts)
 * - All core constants and scanning functions preserved
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CallLLMOptions } from "@dyyz1993/pi-coding-agent";

export type CallLLMFn = (options: CallLLMOptions) => Promise<string>;

// ============================================================================
// Constants
// ============================================================================

export const ENTRYPOINT_NAME = "MEMORY.md";
export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25_000;
export const MAX_MEMORY_FILES = 200;
export const MAX_RELEVANT_MEMORIES = 5;
export const MAX_MEMORY_BYTES_PER_FILE = 8000;
export const DREAM_MIN_HOURS = 24;
export const DREAM_MIN_SESSIONS = 5;

export type MemoryType = "user" | "feedback" | "project" | "reference" | "bookmark";

export interface MemoryHeader {
  filename: string;
  filePath: string;
  mtimeMs: number;
  description: string | null;
  type: MemoryType | undefined;
  sourceSession?: string | null;
  tags?: string[] | null;
}

// ============================================================================
// Frontmatter utilities
// ============================================================================

export function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (!normalized.startsWith("---")) {
    return { frontmatter: {}, body: normalized };
  }

  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const frontmatterText = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 4).trim();

  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterText.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

export function isBookmarkType(header: MemoryHeader): boolean {
  return header.type === "bookmark";
}

export function buildFrontmatter(fields: { name: string; description: string; type: MemoryType }): string {
  return `---\nname: ${fields.name}\ndescription: ${fields.description}\ntype: ${fields.type}\n---`;
}

export interface BookmarkFrontmatterFields {
  name: string;
  description: string;
  sourceSession: string;
  sourceMessageIds: string[];
  tags: string[];
  createdAt: string;
}

export function buildBookmarkFrontmatter(fields: BookmarkFrontmatterFields): string {
  const tagsStr = fields.tags.join(", ");
  return `---\nname: ${fields.name}\ndescription: ${fields.description}\ntype: bookmark\nsourceSession: ${fields.sourceSession}\nsourceMessageIds: ${fields.sourceMessageIds.join(", ")}\ntags: [${tagsStr}]\ncreatedAt: ${fields.createdAt}\n---`;
}

// ============================================================================
// Entrypoint truncation
// ============================================================================

export function truncateEntrypoint(raw: string): { content: string; wasTruncated: boolean } {
  if (!raw) {
    return { content: "", wasTruncated: false };
  }

  let lines = raw.split("\n");
  let truncated = false;

  if (lines.length > MAX_ENTRYPOINT_LINES) {
    lines = lines.slice(0, MAX_ENTRYPOINT_LINES);
    truncated = true;
  }

  let content = lines.join("\n");

  if (Buffer.byteLength(content, "utf-8") > MAX_ENTRYPOINT_BYTES) {
    truncated = true;
    const bytes = Buffer.from(content, "utf-8");
    content = bytes.slice(0, MAX_ENTRYPOINT_BYTES).toString("utf-8");
    const lastNewline = content.lastIndexOf("\n");
    if (lastNewline !== -1) {
      content = content.slice(0, lastNewline);
    }
  }

  return { content, wasTruncated: truncated };
}

// ============================================================================
// Memory file scanning
// ============================================================================

export async function scanMemoryFiles(memoryDir: string): Promise<MemoryHeader[]> {
  if (!existsSync(memoryDir)) {
    return [];
  }

  const entries = readdirSync(memoryDir);
  const headers: MemoryHeader[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (entry === ENTRYPOINT_NAME) continue;
    if (!entry.endsWith(".md")) continue;

    const filePath = join(memoryDir, entry);
    const s = statSync(filePath);
    if (!s.isFile()) continue;

    const content = await readFile(filePath, "utf-8");
    const { frontmatter } = parseFrontmatter(content);

    headers.push({
      filename: entry,
      filePath,
      mtimeMs: s.mtimeMs,
      description: frontmatter.description ?? null,
      type: frontmatter.type as MemoryType | undefined,
      sourceSession: frontmatter.sourceSession ?? null,
      tags: frontmatter.tags
        ? frontmatter.tags
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
        : null,
    });
  }

  headers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return headers;
}

// ============================================================================
// Manifest formatting
// ============================================================================

export function formatManifest(headers: MemoryHeader[]): string {
  return headers
    .map((h) => {
      const parts = [h.filename];
      if (h.description) parts.push(h.description);
      if (h.type) parts.push(`[${h.type}]`);
      return parts.join(" — ");
    })
    .join("\n");
}

export async function updateMemoryIndex(memoryDir: string): Promise<void> {
  const memories = await scanMemoryFiles(memoryDir);
  const lines = memories.map((m) => {
    const title = m.filename.replace(/\.md$/, "");
    const desc = m.description ? ` — ${m.description}` : "";
    const line = "- [" + title + "](" + "../memory/" + m.filename + ")" + desc;
    return line.slice(0, 150);
  });

  const truncated = truncateEntrypoint(lines.join("\n"));
  await writeFile(join(memoryDir, ENTRYPOINT_NAME), truncated.content);
}
