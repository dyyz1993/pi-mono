import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentMessage, AgentToolResult } from "@dyyz1993/pi-agent-core";
import { Type } from "typebox";
import {
  createTypedChannel,
  type ExtensionAPI,
  type ExtensionContext,
} from "@dyyz1993/pi-coding-agent";
import {
  LEARNING_CHANNEL_NAME,
  type LearningChannelContract,
  type LearningCandidateDecisionParams,
  type LearningRunCuratorParams,
  type LearningSetConfigParams,
  type LearningRun,
  type LearningSnapshot,
} from "./contract.ts";
import { BookmarkCreator } from "./bookmark-creator.ts";
import { MemoryCurator } from "./memory-curator.ts";
import { MemoryPrefetch, maybePurify } from "./context-provider.ts";
import { maybeExtractMemory } from "./memory-provider.ts";
import { LearningCuratorScheduler } from "./scheduler.ts";
import { maybeDistillSkill } from "./skill-provider.ts";
import { LearningStore } from "./store.ts";
import {
  scanMemoryFiles,
  buildFrontmatter,
  updateMemoryIndex,
  ENTRYPOINT_NAME,
  MAX_MEMORY_BYTES_PER_FILE,
  MAX_RELEVANT_MEMORIES,
} from "./utils.ts";
import { loadSkipWordStore, addHistoryEntry, saveSkipWordStore, getGlobalLearningDir, getDefaultRules } from "./skip-rules.ts";
import { MEMORY_SYSTEM_PROMPT } from "./prompts.ts";
import { getExtensionRuntimeResourcePolicy } from "../runtime-policy.ts";

function sourceMessageIds(messages: AgentMessage[]): string[] {
  return messages
    .map((message) => {
      const record = message as { id?: unknown };
      return typeof record.id === "string" ? record.id : undefined;
    })
    .filter((id): id is string => id !== undefined);
}

function disabledSnapshot(projectRoot: string): LearningSnapshot {
  return {
    version: 1,
    projectRoot,
    dirs: { learningDir: "", memoryDir: "", skillsDir: "" },
    config: {
      version: 1,
      enabled: false,
      memory: {
        recallEnabled: false,
        extractMode: "off",
        curatorMode: "dry-run",
        curatorSchedule: { enabled: false, intervalMinutes: 1440 },
      },
      skills: {
        distillMode: "off",
        curatorMode: "dry-run",
        curatorSchedule: { enabled: false, intervalMinutes: 1440 },
      },
    },
    overview: {
      memoryFiles: 0,
      activeSkills: 0,
      disabledSkills: 0,
      archivedSkills: 0,
      pendingCandidates: 0,
      warnings: 1,
      lastRunAt: null,
    },
    memory: { files: [], entrypoint: null, diagnostics: ["Learning memory is unavailable in quick SSH sandbox mode."] },
    skills: { items: [], diagnostics: ["Learning skills are unavailable in quick SSH sandbox mode."] },
    candidates: [],
    runs: [],
  };
}

function disabledRun(domain: LearningRunCuratorParams["domain"]): LearningRun {
  const now = Date.now();
  return {
    version: 1,
    id: `learning-disabled-${now}`,
    domain: "curator",
    type: domain === "memory" ? "memory-curator" : "skill-curator",
    mode: "manual",
    status: "failed",
    startedAt: now,
    completedAt: now,
    summary: "Learning curator is unavailable in quick SSH sandbox mode.",
    actions: [],
    error: "learning-unavailable-quick-ssh-sandbox",
  };
}

function slugifyMemoryFilename(input: string, fallback = "memory"): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, 64);
  return `${base || fallback}.md`;
}

async function uniqueMemoryFilePath(memoryDir: string, filename: string): Promise<{ filename: string; filePath: string }> {
  const stem = filename.replace(/\.md$/i, "") || "memory";
  let candidate = `${stem}.md`;
  let filePath = join(memoryDir, candidate);
  let suffix = 2;
  while (existsSync(filePath)) {
    candidate = `${stem}-${suffix}.md`;
    filePath = join(memoryDir, candidate);
    suffix += 1;
  }
  return { filename: candidate, filePath };
}

function buildMemoryFrontmatter(fields: { name: string; description: string; type: string }): string {
  return `---\nname: ${fields.name}\ndescription: ${fields.description}\ntype: ${fields.type}\n---`;
}

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

function extractMessageText(message: AgentMessage): string {
  if (!("content" in message)) return "";
  const content = (message as { content: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: "text"; text: string } => {
        const record = part as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string";
      })
      .map((part) => part.text)
      .join("");
  }
  return "";
}

function findExistingMemoryContext(messages: AgentMessage[]): string | null {
  for (const msg of messages) {
    const match = extractMessageText(msg).match(/<memory_context\s+fingerprint="([^"]+)"/);
    if (match) return match[1]!;
  }
  return null;
}

export default function learningExtension(pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let store: LearningStore | null = null;
  let scheduler: LearningCuratorScheduler | null = null;
  const runtimePolicy = getExtensionRuntimeResourcePolicy();
  const learningAvailable =
    runtimePolicy.canLoadUserMemory ||
    runtimePolicy.canLoadProjectMemory ||
    runtimePolicy.canLoadUserSkills ||
    runtimePolicy.canLoadProjectSkills;

  const bookmarkCreator = new BookmarkCreator();
  const memoryCurator = new MemoryCurator();
  const prefetch = new MemoryPrefetch();

  let memoryDir = "";

  const MEMORY_PREFETCH_PHASE = {
    start: { phase: "prefetch_started", phaseOrder: 1 },
    result: { phase: "prefetch_result", phaseOrder: 2 },
    inject: { phase: "inject", phaseOrder: 3 },
  } as const;

  const writtenMemoryInjectEntries = new Set<string>();
  const writtenMemoryInjectEntryOrder: string[] = [];
  const maxWrittenMemoryInjectEntries = 200;
  const activeInjectedMemoryFingerprints = new Set<string>();
  const activeInjectedMemoryFingerprintOrder: string[] = [];
  const maxActiveInjectedMemoryFingerprints = 200;
  const injectedFingerprintStateFileName = "learning-injected-fingerprints.json";

  function getInjectedFingerprintStateFile(): string | null {
    const sessionDataDir = (ctx as (ExtensionContext & { sessionDataDir?: string }) | undefined)?.sessionDataDir;
    return sessionDataDir ? join(sessionDataDir, injectedFingerprintStateFileName) : null;
  }

  function persistActiveInjectedMemoryFingerprints(): void {
    const filePath = getInjectedFingerprintStateFile();
    if (!filePath) return;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(
        filePath,
        JSON.stringify(
          {
            version: 1,
            fingerprints: activeInjectedMemoryFingerprintOrder.filter((fingerprint) =>
              activeInjectedMemoryFingerprints.has(fingerprint),
            ),
          },
          null,
          2,
        ),
        "utf-8",
      );
    } catch (error) {
      console.debug("[learning] persist injected memory fingerprints failed:", error instanceof Error ? error.message : error);
    }
  }

  function restoreActiveInjectedMemoryFingerprints(): void {
    const filePath = getInjectedFingerprintStateFile();
    if (!filePath || !existsSync(filePath)) return;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { fingerprints?: unknown };
      const fingerprints = Array.isArray(parsed.fingerprints)
        ? parsed.fingerprints.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
      for (const fingerprint of fingerprints.slice(-maxActiveInjectedMemoryFingerprints)) {
        markActiveInjectedMemoryFingerprint(fingerprint, { persist: false });
      }
    } catch (error) {
      console.debug("[learning] restore injected memory fingerprints failed:", error instanceof Error ? error.message : error);
    }
  }

  function clearActiveInjectedMemoryFingerprints(options: { persist?: boolean } = {}): void {
    activeInjectedMemoryFingerprints.clear();
    activeInjectedMemoryFingerprintOrder.length = 0;
    writtenMemoryInjectEntries.clear();
    writtenMemoryInjectEntryOrder.length = 0;
    if (options.persist !== false) persistActiveInjectedMemoryFingerprints();
  }

  function markMemorySelectionDirty(): void {
    prefetch.markDirty();
    clearActiveInjectedMemoryFingerprints();
  }

  function hasActiveInjectedMemoryFingerprint(fingerprint: string): boolean {
    return activeInjectedMemoryFingerprints.has(fingerprint);
  }

  function markActiveInjectedMemoryFingerprint(fingerprint: string, options: { persist?: boolean } = {}): void {
    if (activeInjectedMemoryFingerprints.has(fingerprint)) return;
    activeInjectedMemoryFingerprints.add(fingerprint);
    activeInjectedMemoryFingerprintOrder.push(fingerprint);
    while (activeInjectedMemoryFingerprintOrder.length > maxActiveInjectedMemoryFingerprints) {
      const oldest = activeInjectedMemoryFingerprintOrder.shift();
      if (oldest) activeInjectedMemoryFingerprints.delete(oldest);
    }
    if (options.persist !== false) persistActiveInjectedMemoryFingerprints();
  }

  function markMemoryInjectEntryWritten(entryKey: string): boolean {
    if (writtenMemoryInjectEntries.has(entryKey)) return true;
    writtenMemoryInjectEntries.add(entryKey);
    writtenMemoryInjectEntryOrder.push(entryKey);
    while (writtenMemoryInjectEntryOrder.length > maxWrittenMemoryInjectEntries) {
      const oldest = writtenMemoryInjectEntryOrder.shift();
      if (oldest) writtenMemoryInjectEntries.delete(oldest);
    }
    return false;
  }

  function appendPrefetchResult(memoryText: string | null): void {
    const debug = prefetch.debugInfo;
    const selectedFiles = debug?.selectedFiles ?? [];
    if (prefetch.markResultEntryWritten(prefetch.operationId ?? undefined)) return;
    ctx?.ui.setStatus("learning", memoryText ? "learning memories selected" : "learning no memories found");
    pi.appendEntry("memory_prefetch_result", {
      operationId: prefetch.operationId,
      ...MEMORY_PREFETCH_PHASE.result,
      occurredAt: Date.now(),
      summary: memoryText ? "Selected relevant memories" : "No relevant memories",
      snippet: memoryText ? memoryText.slice(0, 500) : "",
      injectedBytes: memoryText ? memoryText.length : 0,
      selectedFiles,
      durationMs: debug?.durationMs ?? 0,
      layer: debug?.layer ?? "unknown",
      skipHits: debug?.skipHits ?? [],
      guardHits: debug?.guardHits ?? [],
      availableFiles: debug?.availableFiles ?? 0,
      source: "learning",
    });
  }

  function appendMemoryInject(memoryText: string, selectedFiles: string[], fingerprint: string): void {
    const operationId = prefetch.operationId ?? "unknown";
    const entryKey = `${operationId}:${fingerprint}`;
    if (markMemoryInjectEntryWritten(entryKey)) return;
    markActiveInjectedMemoryFingerprint(fingerprint);
    ctx?.ui.setStatus("learning", "learning memories injected");
    pi.appendEntry("memory_inject", {
      operationId,
      ...MEMORY_PREFETCH_PHASE.inject,
      occurredAt: Date.now(),
      summary: "Injected memory context",
      snippet: memoryText.slice(0, 500),
      injectedBytes: memoryText.length,
      selectedFiles,
      fingerprint,
      source: "learning",
    });
  }

  function appendMemoryInjectSkipped(
    memoryText: string,
    selectedFiles: string[],
    fingerprint: string,
    reason: "already_in_context" | "already_in_session",
  ): void {
    const operationId = prefetch.operationId ?? "unknown";
    if (writtenMemoryInjectEntries.has(`${operationId}:${fingerprint}`)) return;
    const entryKey = `${operationId}:${fingerprint}:skipped:${reason}`;
    if (markMemoryInjectEntryWritten(entryKey)) return;
    ctx?.ui.setStatus("learning", "learning memory already injected");
    pi.appendEntry("memory_inject", {
      operationId,
      ...MEMORY_PREFETCH_PHASE.inject,
      occurredAt: Date.now(),
      summary: "Memory context already injected",
      snippet: memoryText.slice(0, 500),
      injectedBytes: 0,
      originalBytes: memoryText.length,
      selectedFiles,
      fingerprint,
      skipped: true,
      alreadyInjected: true,
      skipReason: reason,
      source: "learning",
    });
  }

  function getStore(): LearningStore {
    if (store) return store;
    const projectRoot = ctx?.projectRoot ?? ctx?.cwd ?? process.cwd();
    store = new LearningStore(projectRoot);
    return store;
  }

  const callLLMWithRetry = async (opts: Parameters<ExtensionAPI["callLLM"]>[0]): Promise<string> => {
    try {
      return await pi.callLLM(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/stale/i.test(msg)) throw err;
      console.debug("[learning] LLM call failed:", msg);
      throw err;
    }
  };

  let channel: ReturnType<typeof createTypedChannel<LearningChannelContract>>["server"] | null = null;
  try {
    channel = createTypedChannel<LearningChannelContract>(pi.registerChannel(LEARNING_CHANNEL_NAME)).server;
  } catch {
    channel = null;
  }

  function memoryChannelEmit(eventType: string, data: unknown): void {
    if (!channel) return;
    channel.emit(eventType as keyof LearningChannelContract["events"], data as never);
  }

  function emptyMemoryStatus() {
    return {
      skipRules: { builtin: [], custom: [] },
      guardRules: { builtin: [], custom: [] },
      excludeKeywords: [],
      recentQueries: [],
      dream: { lastRunAt: null },
    };
  }

  function toMemoryFileInfo(header: Awaited<ReturnType<typeof scanMemoryFiles>>[number]) {
    return {
      filename: header.filename,
      filePath: header.filePath,
      description: header.description ?? null,
      type: header.type ?? null,
      mtimeMs: header.mtimeMs,
    };
  }

  function registerDisabledMemoryChannelHandlers(): void {
    channel?.handle("learning.memory.list", async () => ({
      type: "list_result" as const,
      files: [],
      entrypointContent: null,
      memoryDir: "",
    }));
    channel?.handle("learning.memory.userRemember", async () => ({ ok: false }));
    channel?.handle("learning.memory.markIrrelevant", async () => ({ ok: false }));
    channel?.handle("learning.memory.getStatus", async () => emptyMemoryStatus());
    channel?.handle("learning.memory.removeRule", async () => ({ ok: false }));
    channel?.handle("learning.memory.addRule", async () => ({ ok: false }));
  }

  function registerMemoryChannelHandlers(): void {
    channel?.handle("learning.memory.list", async () => {
      try {
        const memories = await scanMemoryFiles(memoryDir);
        let entrypointContent: string | null = null;
        try {
          entrypointContent = await readFile(join(memoryDir, ENTRYPOINT_NAME), "utf-8");
        } catch (error) {
          console.debug("[learning] entrypoint read failed:", error instanceof Error ? error.message : error);
        }
        return {
          type: "list_result" as const,
          files: memories.map(toMemoryFileInfo),
          entrypointContent,
          memoryDir,
        };
      } catch (error) {
        console.debug("[learning] memory list failed:", error instanceof Error ? error.message : error);
        return { type: "list_result" as const, files: [], entrypointContent: null, memoryDir };
      }
    });

    channel?.handle("learning.memory.userRemember", async (data) => {
      memoryChannelEmit("bookmark_creating", { type: "bookmark_creating" });
      pi.appendEntry("memory_creating", { content: data.content?.slice(0, 200), source: "learning" });
      try {
        const sessionId = data.sourceSessionId ?? ctx?.sessionManager?.getSessionId() ?? "";
        const result = await bookmarkCreator.create(
          data.content ?? "",
          sessionId,
          data.sourceMessageIds ?? [],
          memoryDir,
          callLLMWithRetry,
        );
        if (result) {
          markMemorySelectionDirty();
          pi.appendEntry("memory_created", { filename: result.filename, source: "learning" });
          const updatedMemories = await scanMemoryFiles(memoryDir);
          memoryChannelEmit("memory_updated", {
            type: "memory_updated",
            files: updatedMemories.map(toMemoryFileInfo),
          });
        } else {
          pi.appendEntry("memory_failed", { reason: "LLM failed", source: "learning" });
          memoryChannelEmit("memory_update_failed", { type: "memory_update_failed", reason: "LLM failed" });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/stale/i.test(message)) return { ok: true };
        pi.appendEntry("memory_failed", { reason: message, source: "learning" });
        ctx?.ui.notify(`Learning bookmark error: ${message}`, "warning");
        memoryChannelEmit("memory_update_failed", { type: "memory_update_failed", reason: "Error" });
      }
      return { ok: true };
    });

    channel?.handle("learning.memory.markIrrelevant", async (data) => {
      const query = (data.query ?? "").slice(0, 200);
      const selectedFiles = Array.isArray(data.selectedFiles)
        ? (data.selectedFiles as string[]).slice(0, MAX_RELEVANT_MEMORIES)
        : [];

      if (!query || selectedFiles.length === 0) return { ok: false };

      let skipStore = loadSkipWordStore(getGlobalLearningDir());
      skipStore = addHistoryEntry(skipStore, {
        query,
        selected: selectedFiles,
        skipped: false,
        skip_hits: [],
        guard_hits: [],
        timestamp: Date.now(),
        userMarkedIrrelevant: true,
        irrelevantFiles: selectedFiles,
      });
      await saveSkipWordStore(getGlobalLearningDir(), skipStore);

      pi.appendEntry("memory_irrelevant_marked", { query, selectedFiles, source: "learning" });
      memoryChannelEmit("memory_irrelevant_marked", {
        type: "memory_irrelevant_marked",
        query,
        selectedFiles,
      });

      return { ok: true };
    });

    channel?.handle("learning.memory.getStatus", async () => {
      const skipStore = prefetch.getStore();
      const defaultRules = getDefaultRules();
      const builtinSkips = defaultRules.filter((rule) => rule.action === "skip").map((rule) => ({ pattern: rule.pattern, mode: rule.mode }));
      const builtinGuards = defaultRules.filter((rule) => rule.action === "guard").map((rule) => ({ pattern: rule.pattern, mode: rule.mode }));
      const customSkips = skipStore.rules
        .filter((rule) => rule.action === "skip" && !rule.builtin)
        .map((rule) => ({ pattern: rule.pattern, mode: rule.mode }));
      const customGuards = skipStore.rules
        .filter((rule) => rule.action === "guard" && !rule.builtin)
        .map((rule) => ({ pattern: rule.pattern, mode: rule.mode }));
      const recentQueries = skipStore.history.slice(-10).map((entry) => ({
        query: entry.query,
        selected: entry.selected,
        skipped: entry.skipped,
        skip_hits: entry.skip_hits,
        guard_hits: entry.guard_hits,
        timestamp: entry.timestamp,
      }));

      let lastDreamAt: number | null = null;
      try {
        const lockPath = join(memoryDir, ".consolidate-lock");
        if (existsSync(lockPath)) {
          const lockStat = await stat(lockPath);
          lastDreamAt = lockStat.mtimeMs;
        }
      } catch {}

      return {
        skipRules: { builtin: builtinSkips, custom: customSkips },
        guardRules: { builtin: builtinGuards, custom: customGuards },
        excludeKeywords: skipStore.excludeKeywords,
        recentQueries,
        dream: { lastRunAt: lastDreamAt },
      };
    });

    channel?.handle("learning.memory.removeRule", async (data) => {
      const skipStore = prefetch.getStore();
      let modified = false;

      if (data.rule) {
        const index = skipStore.rules.findIndex(
          (rule) => rule.pattern === data.rule!.pattern && rule.mode === data.rule!.mode && !rule.builtin,
        );
        if (index !== -1) {
          skipStore.rules.splice(index, 1);
          modified = true;
        }
      }

      if (data.excludeKeyword) {
        const index = skipStore.excludeKeywords.indexOf(data.excludeKeyword);
        if (index !== -1) {
          skipStore.excludeKeywords.splice(index, 1);
          modified = true;
        }
      }

      if (modified) {
        await saveSkipWordStore(getGlobalLearningDir(), skipStore);
        markMemorySelectionDirty();
      }

      return { ok: modified };
    });

    channel?.handle("learning.memory.addRule", async (data) => {
      const skipStore = prefetch.getStore();
      const exists = skipStore.rules.some(
        (rule) => rule.pattern === data.pattern && rule.mode === data.mode && rule.action === data.action,
      );
      if (!exists) {
        skipStore.rules.push({ pattern: data.pattern, mode: data.mode, action: data.action, builtin: false });
        await saveSkipWordStore(getGlobalLearningDir(), skipStore);
        markMemorySelectionDirty();
      }
      return { ok: true };
    });
  }

  if (learningAvailable) {
    registerMemoryChannelHandlers();
  } else {
    registerDisabledMemoryChannelHandlers();
  }

  // --- Session lifecycle ---

  pi.on("session_start", async (_event, context) => {
    ctx = context as ExtensionContext;
    clearActiveInjectedMemoryFingerprints({ persist: false });
    restoreActiveInjectedMemoryFingerprints();
    store = new LearningStore(ctx.projectRoot ?? ctx.cwd);
    memoryDir = store.paths.memoryDir;
    await mkdir(memoryDir, { recursive: true });
    if (!learningAvailable) {
      ctx.ui.setStatus("learning", "learning unavailable for quick SSH sandbox");
      return;
    }
    scheduler?.stop();
    scheduler = new LearningCuratorScheduler({
      getStore,
      emitRun: (run) => channel?.emit("learning.run", run),
      emitSnapshot: (snapshot) => channel?.emit("learning.snapshot", snapshot),
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        ctx?.ui.setStatus("learning", "learning scheduler error");
        ctx?.ui.notify(`Learning scheduler error: ${message}`, "warning");
      },
    });
    await scheduler.start();
    ctx.ui.setStatus("learning", "learning ready");
  });

  pi.on("session_shutdown", () => {
    scheduler?.stop();
    scheduler = null;
  });

  pi.on("session_compact", () => {
    markMemorySelectionDirty();
  });

  // --- Tool registrations ---

  if (learningAvailable) {
  pi.registerTool({
    name: "create_bookmark",
    label: "create_bookmark",
    description:
      "Create a bookmark memory file from analyzed content. Use this tool to save a structured bookmark with title, description, summary and tags.",
    parameters: Type.Object({
      title: Type.String({ description: "Bookmark title, concise and descriptive" }),
      description: Type.String({ description: "One-line description of the bookmark" }),
      summary: Type.String({ description: "Detailed summary of the bookmarked content" }),
      tags: Type.Array(Type.String(), { description: "Relevant tags for categorization" }),
    }),
    execute: async (
      _toolCallId: string,
      params: { title: string; description: string; summary: string; tags: string[] },
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      _ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ filename: string } | null>> => {
      const content = `## ${params.title}\n\n${params.summary}`;
      const sessionId = ctx?.sessionManager?.getSessionId() ?? "";
      const result = await bookmarkCreator.create(content, sessionId, [], memoryDir, callLLMWithRetry);
      if (result) {
        markMemorySelectionDirty();
        pi.appendEntry("memory_created", { filename: result.filename, source: "learning" });
        return {
          content: [{ type: "text", text: `Bookmark created: ${result.filename}` }],
          details: { filename: result.filename },
        };
      }
      return { content: [{ type: "text", text: "Failed to create bookmark" }], details: null };
    },
  });

  pi.registerTool({
    name: "save_memory",
    label: "save_memory",
    description:
      "Persist a durable memory entry through the memory system. Use this instead of write/edit/bash for memory files, especially in SSH or remote runtime sessions.",
    parameters: Type.Object({
      name: Type.String({ description: "Short stable memory name" }),
      description: Type.String({ description: "One-line description used in the memory index" }),
      type: Type.Union(
        [
          Type.Literal("user"),
          Type.Literal("feedback"),
          Type.Literal("project"),
          Type.Literal("reference"),
        ],
        { description: "Memory category. Do not use bookmark here." },
      ),
      content: Type.String({
        description: "Memory body. Include Why and How to apply for feedback/project entries.",
      }),
      filename: Type.Optional(Type.String({ description: "Optional markdown filename. The system will sanitize it." })),
    }),
    execute: async (
      _toolCallId: string,
      params: {
        name: string;
        description: string;
        type: "user" | "feedback" | "project" | "reference";
        content: string;
        filename?: string;
      },
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      _ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ filename: string }>> => {
      await mkdir(memoryDir, { recursive: true });
      const requestedFilename = slugifyMemoryFilename(params.filename ?? params.name, "memory");
      const { filename, filePath } = await uniqueMemoryFilePath(memoryDir, requestedFilename);
      const fm = buildFrontmatter({
        name: params.name,
        description: params.description,
        type: params.type,
      });
      const body = params.content.trim().slice(0, MAX_MEMORY_BYTES_PER_FILE);
      await writeFile(filePath, `${fm}\n\n${body}\n`, "utf-8");
      await updateMemoryIndex(memoryDir);
      markMemorySelectionDirty();
      pi.appendEntry("memory_created", { filename, source: "learning" });
      return {
        content: [{ type: "text", text: `Memory saved: ${filename}` }],
        details: { filename },
      };
    },
  });
  }

  // --- Before agent start: inject MEMORY.md index ---

  pi.on("before_agent_start", async (event) => {
    if (!learningAvailable || !memoryDir) return;
    let memoryContent = "";
    try {
      memoryContent = await readFile(join(memoryDir, "MEMORY.md"), "utf-8");
    } catch {
      // No MEMORY.md yet, that's fine
    }
    const truncated = (() => {
      const lines = memoryContent.split("\n");
      const sliced = lines.slice(0, 200);
      let c = sliced.join("\n");
      if (Buffer.byteLength(c, "utf-8") > 25000) {
        const bytes = Buffer.from(c, "utf-8");
        c = bytes.slice(0, 25000).toString("utf-8");
        const lastNewline = c.lastIndexOf("\n");
        if (lastNewline !== -1) c = c.slice(0, lastNewline);
      }
      return { content: c, wasTruncated: lines.length > 200 || Buffer.byteLength(memoryContent, "utf-8") > 25000 };
    })();
    const memoryPrompt = MEMORY_SYSTEM_PROMPT(memoryDir, truncated.content);

    const lastUserText = event.prompt ?? "";
    if (lastUserText && learningAvailable) {
      const operationId = `learning-prefetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pi.appendEntry("memory_prefetch", {
        operationId,
        ...MEMORY_PREFETCH_PHASE.start,
        occurredAt: Date.now(),
        query: lastUserText.slice(0, 200),
        availableFiles: (await scanMemoryFiles(memoryDir)).length,
        source: "learning",
      });
      prefetch.start(lastUserText, memoryDir, callLLMWithRetry, operationId);
      void prefetch.waitForOperation(operationId).then((memoryText) => {
        if (prefetch.operationId !== operationId) return;
        appendPrefetchResult(memoryText);
      });
    }

    return { systemPrompt: `${event.systemPrompt}\n\n${memoryPrompt}` };
  });

  // --- Context: non-blocking memory injection ---

  pi.on("context", async (event) => {
    if (!learningAvailable || !memoryDir) return;
    const operationId = prefetch.operationId;
    const memoryText = operationId
      ? await prefetch.waitForOperation(operationId)
      : prefetch.collect();
    if (!memoryText) return;

    const selectedFiles = prefetch.selectedFiles;
    const fingerprint = selectedFiles.slice().sort().join(",") + "|" + memoryText.length;

    const existingMemory = findExistingMemoryContext(event.messages);
    if (existingMemory && existingMemory === fingerprint) {
      markActiveInjectedMemoryFingerprint(fingerprint);
      appendPrefetchResult(memoryText);
      appendMemoryInjectSkipped(memoryText, selectedFiles, fingerprint, "already_in_context");
      return;
    }
    if (hasActiveInjectedMemoryFingerprint(fingerprint)) {
      appendPrefetchResult(memoryText);
      appendMemoryInjectSkipped(memoryText, selectedFiles, fingerprint, "already_in_session");
      return;
    }

    const xmlContent = `<memory_context fingerprint="${fingerprint}">
<files count="${selectedFiles.length}" source="learning">
${memoryText}
</files>
</memory_context>`;

    appendPrefetchResult(memoryText);
    appendMemoryInject(memoryText, selectedFiles, fingerprint);

    return { messages: [...event.messages, { role: "user" as const, content: [{ type: "text" as const, text: xmlContent }], timestamp: Date.now() }] };
  });

  // --- Agent end: memory extraction, dream, purification + skill distill ---

  pi.on("agent_end", async (event) => {
    if (!learningAvailable) return;
    const activeStore = getStore();
    const messages = event.messages as AgentMessage[];
    const sessionId = ctx?.sessionManager?.getSessionId();
    try {
      await maybeExtractMemory({
        store: activeStore,
        messages,
        sourceSessionId: sessionId,
        sourceMessageIds: sourceMessageIds(messages),
      });
      await maybeDistillSkill({
        store: activeStore,
        messages,
        sourceSessionId: sessionId,
        sourceMessageIds: sourceMessageIds(messages),
      });

      // Dream consolidation
      const dreamResult = await memoryCurator.maybeRun(memoryDir, callLLMWithRetry);
      if (dreamResult) {
        markMemorySelectionDirty();
        pi.appendEntry("memory_dream_result", {
          status: "completed",
          merges: dreamResult.merges,
          deletions: dreamResult.deletions,
          updates: dreamResult.updates,
          source: "learning",
        });
      }

      // Purification
      const purifyResult = await maybePurify(memoryDir, callLLMWithRetry);
      if (purifyResult) {
        markMemorySelectionDirty();
        pi.appendEntry("memory_dream_result", { status: "purified", keywords: purifyResult, source: "learning" });
      }

      const snapshot = await activeStore.getSnapshot();
      channel?.emit("learning.snapshot", snapshot);
      ctx?.ui.setStatus("learning", "learning idle");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      ctx?.ui.setStatus("learning", "learning error");
      ctx?.ui.notify(`Learning error: ${message}`, "warning");
    }
  });

  // --- Channel handlers ---

  channel?.handle("learning.getSnapshot", async () => {
    if (!learningAvailable) return disabledSnapshot(ctx?.projectRoot ?? ctx?.cwd ?? process.cwd());
    return getStore().getSnapshot();
  });

  channel?.handle("learning.setConfig", async (params: LearningSetConfigParams) => {
    if (!learningAvailable) return disabledSnapshot(ctx?.projectRoot ?? ctx?.cwd ?? process.cwd());
    const activeStore = getStore();
    await activeStore.setConfig(params.config);
    await scheduler?.reload();
    const snapshot = await activeStore.getSnapshot();
    channel?.emit("learning.snapshot", snapshot);
    return snapshot;
  });

  channel?.handle("learning.listCandidates", async () => {
    if (!learningAvailable) return { candidates: [] };
    return { candidates: await getStore().listCandidates(false) };
  });

  channel?.handle("learning.approveCandidate", async (params: LearningCandidateDecisionParams) => {
    if (!learningAvailable) return disabledSnapshot(ctx?.projectRoot ?? ctx?.cwd ?? process.cwd());
    const activeStore = getStore();
    await activeStore.approveCandidate(params.candidateId, { mergeTargetSkillName: params.mergeTargetSkillName });
    const snapshot = await activeStore.getSnapshot();
    channel?.emit("learning.snapshot", snapshot);
    return snapshot;
  });

  channel?.handle("learning.rejectCandidate", async (params: LearningCandidateDecisionParams) => {
    if (!learningAvailable) return disabledSnapshot(ctx?.projectRoot ?? ctx?.cwd ?? process.cwd());
    const activeStore = getStore();
    await activeStore.rejectCandidate(params.candidateId);
    const snapshot = await activeStore.getSnapshot();
    channel?.emit("learning.snapshot", snapshot);
    return snapshot;
  });

  channel?.handle("learning.runCurator", async (params: LearningRunCuratorParams) => {
    if (!learningAvailable) return disabledRun(params.domain);
    const run = await getStore().runCurator(params);
    channel?.emit("learning.run", run);
    return run;
  });
}
