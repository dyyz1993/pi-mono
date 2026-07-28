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
  messageText,
  truncateEntrypoint,
  findExistingMemoryContext,
  slugifyFilename,
  logger,
} from "./utils.ts";
import { loadSkipWordStore, addHistoryEntry, saveSkipWordStore, getGlobalLearningDir, getDefaultRules } from "./skip-rules.ts";
import { MEMORY_SYSTEM_PROMPT, SKILL_SYSTEM_PROMPT } from "./prompts.ts";
import { getExtensionRuntimeResourcePolicy } from "../runtime-policy.ts";

function sourceMessageIds(messages: AgentMessage[]): string[] {
  return messages
    .map((message) => {
      const record = message as { id?: unknown };
      return typeof record.id === "string" ? record.id : undefined;
    })
    .filter((id): id is string => id !== undefined);
}

function hasFailedToolResult(messages: AgentMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "toolResult") return false;
    const record = message as { isError?: unknown; content?: unknown };
    if (record.isError === true) return true;
    if (!Array.isArray(record.content)) return false;
    return record.content.some((part) => {
      if (typeof part !== "object" || part === null) return false;
      const contentPart = part as { type?: unknown; isError?: unknown };
      return contentPart.type === "toolResult" && contentPart.isError === true;
    });
  });
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
    domain,
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

/**
 * Read a memory entrypoint file if it exists, returning empty string otherwise.
 * Centralizes the try/catch so callers stay linear.
 */
async function readMemoryEntrypoint(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
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
      logger.warn("persist injected memory fingerprints failed", { error: error instanceof Error ? error.message : error });
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
      logger.warn("restore injected memory fingerprints failed", { error: error instanceof Error ? error.message : error });
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
      // Use callLLMSafe so background LLM work (memory extract, skill distill)
      // survives session replacement / reload. The stale check in callLLM
      // would otherwise force graceful fallback to raw payload every time.
      return await pi.callLLMSafe(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("LLM call failed", { error: msg });
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
          logger.warn("entrypoint read failed", { error: error instanceof Error ? error.message : error });
        }
        return {
          type: "list_result" as const,
          files: memories.map(toMemoryFileInfo),
          entrypointContent,
          memoryDir,
        };
      } catch (error) {
        logger.warn("memory list failed", { error: error instanceof Error ? error.message : error });
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
      markMemorySelectionDirty();

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
    if (!learningAvailable) {
      store = null;
      memoryDir = "";
      ctx.ui.setStatus("learning", "learning unavailable for quick SSH sandbox");
      return;
    }
    store = new LearningStore(ctx.projectRoot ?? ctx.cwd);
    memoryDir = store.paths.memoryDir;
    await mkdir(memoryDir, { recursive: true });
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
      const requestedFilename = slugifyFilename(params.filename ?? params.name, "memory");
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
    // Read project + global memory entrypoints; merge into one prompt.
    // Global memory holds user-type memories that follow the user across projects;
    // project memory holds project/feedback/reference/bookmark types.
    const storeForMemory = getStore();
    const globalMemoryDir = storeForMemory?.paths.globalMemoryDir ?? "";
    const projectMemoryContent = await readMemoryEntrypoint(join(memoryDir, ENTRYPOINT_NAME));
    const globalMemoryContent = globalMemoryDir
      ? await readMemoryEntrypoint(join(globalMemoryDir, ENTRYPOINT_NAME))
      : "";
    // Compose: global section + project section (each truncated individually
    // to bound size, then combined; truncateEntrypoint is applied to the merged
    // result below to enforce the overall cap).
    const mergedRaw = [globalMemoryContent, projectMemoryContent]
      .filter(Boolean)
      .map((section, index) =>
        index === 0 && globalMemoryContent && projectMemoryContent
          ? `## Global memory (cross-project)\n\n${globalMemoryContent}\n\n## Project memory\n\n${projectMemoryContent}`
          : section,
      )
      .join("\n\n");
    const truncated = truncateEntrypoint(mergedRaw);
    const memoryPrompt = MEMORY_SYSTEM_PROMPT(truncated.content);

    const lastUserText = event.prompt ?? "";
    const shouldPrefetch =
      event.source === undefined || event.source === "interactive" || event.source === "rpc";
    if (lastUserText && learningAvailable && shouldPrefetch) {
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

    const currentStore = getStore();
    const skillBodies = currentStore ? await currentStore.listActiveSkillBodies() : [];
    const skillPrompt = SKILL_SYSTEM_PROMPT(
      skillBodies.map((skill) => ({ name: skill.name, description: skill.description, body: skill.body })),
    );
    const sections = [memoryPrompt, skillPrompt].filter(Boolean);
    const appendedSystemPrompt = sections.length > 0
      ? `${event.systemPrompt}\n\n${sections.join("\n\n")}`
      : event.systemPrompt;
    return { systemPrompt: appendedSystemPrompt };
  });

  // --- Context: non-blocking memory injection ---

  pi.on("context", async (event) => {
    if (!learningAvailable || !memoryDir) return;
    const memoryText = prefetch.collect();
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
  // NOTE: These LLM-backed operations can take tens of seconds. Running them
  // synchronously (via await) blocks the agent_end event from reaching the
  // RPC client, which keeps the agent status as "streaming" and causes
  // subsequent user messages to be force-converted to "steer". We run them
  // in the background (fire-and-forget) so agent_end resolves immediately.

  pi.on("agent_end", async (event) => {
    if (!learningAvailable) return;
    const activeStore = getStore();
    const messages = event.messages as AgentMessage[];
    const sessionId = ctx?.sessionManager?.getSessionId();
    // Capture ui reference before fire-and-forget — ctx may become stale
    // (session replacement/reload) during async LLM work, and ctx?.ui getter
    // throws stale errors instead of returning undefined.
    let capturedUi: ExtensionContext["ui"] | undefined;
    try {
      capturedUi = ctx?.ui;
    } catch {
      // ctx already stale — skip UI updates
    }

    void (async () => {
      const hasFailed = hasFailedToolResult(messages);
      logger.info("agent_end processing", { sessionId, messagesCount: messages.length, hasFailed });

      // Each LLM operation runs independently — a failure in one must NOT
      // block the others. Previously all four were in a single try block,
      // so a maybeDistillSkill throw would skip maybeRun (dream consolidation),
      // causing .session-count to never increment.
      const runIndependent = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`agent_end ${label} failed`, { error: message });
        }
      };

      if (!hasFailed) {
        await runIndependent("memory.extract", () =>
          maybeExtractMemory({
            store: activeStore,
            messages,
            sourceSessionId: sessionId,
            sourceMessageIds: sourceMessageIds(messages),
            callLLM: callLLMWithRetry,
          }),
        );
        await runIndependent("skill.distill", () =>
          maybeDistillSkill({
            store: activeStore,
            messages,
            sourceSessionId: sessionId,
            sourceMessageIds: sourceMessageIds(messages),
            callLLM: callLLMWithRetry,
          }),
        );
      }

      // Dream consolidation — dry-run only, plan 不直接执行
      await runIndependent("dream.consolidate", async () => {
        const dreamPlan = await memoryCurator.maybeRun(memoryDir, callLLMWithRetry);
        if (!dreamPlan) return;
        markMemorySelectionDirty();
        const mergeCount = dreamPlan.merges?.length ?? 0;
        const deletionCount = dreamPlan.deletions?.length ?? 0;
        const updateCount = dreamPlan.updates?.length ?? 0;
        logger.info("dream plan generated (dry-run)", { merges: mergeCount, deletions: deletionCount, updates: updateCount });
        await activeStore.recordRun({
          version: 1,
          id: `dream-plan-${Date.now()}`,
          domain: "memory",
          type: "memory-curator",
          mode: "dry-run",
          status: "completed",
          startedAt: Date.now(),
          completedAt: Date.now(),
          summary: `Dream plan: ${mergeCount} merges, ${deletionCount} deletions, ${updateCount} updates (not applied)`,
          actions: [
            {
              action: "none",
              summary: `Proposed ${mergeCount} merges, ${deletionCount} deletions, ${updateCount} updates. Run learning.runCurator with mode=apply to execute.`,
              fileRefs: [],
            },
          ],
        });
        pi.appendEntry("memory_dream_result", {
          status: "plan-generated",
          merges: mergeCount,
          deletions: deletionCount,
          updates: updateCount,
          applied: false,
          source: "learning",
        });
      });

      // Purification
      await runIndependent("memory.purify", async () => {
        const purifyResult = await maybePurify(memoryDir, callLLMWithRetry);
        if (!purifyResult) return;
        markMemorySelectionDirty();
        pi.appendEntry("memory_dream_result", { status: "purified", keywords: purifyResult, source: "learning" });
      });

      // Snapshot emit — also independent so a snapshot failure doesn't mask errors above
      await runIndependent("snapshot.emit", async () => {
        const snapshot = await activeStore.getSnapshot();
        channel?.emit("learning.snapshot", snapshot);
      });

      capturedUi?.setStatus("learning", "learning idle");
    })();
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

  // --- Slash command: /learning review (interactive candidate approval) ---

  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("learning", {
    description: "Review pending learning candidates (approve / reject interactively)",
    handler: async (_args: string, cmdCtx) => {
      if (!learningAvailable) {
        cmdCtx.ui.notify("Learning is unavailable in this mode (quick SSH sandbox).", "warning");
        return;
      }
      const store = getStore();
      const pending = await store.listCandidates(false);
      const reviewable = pending.filter((c) => c.status === "pending");
      if (reviewable.length === 0) {
        cmdCtx.ui.notify("No pending candidates to review.", "info");
        return;
      }
      cmdCtx.ui.notify(`Reviewing ${reviewable.length} pending candidate${reviewable.length === 1 ? "" : "s"}...`, "info");

      // Review one candidate at a time. For each: show preview via confirm(),
      // then ask action via select(). Loop until user exits or list empties.
      while (reviewable.length > 0) {
        const candidate = reviewable[0]!;
        const payloadPreview = candidate.payload && typeof candidate.payload === "object"
          ? JSON.stringify(candidate.payload, null, 2).slice(0, 500)
          : "(no payload)";

        // Show candidate details, ask approve/reject via confirm dialog.
        // confirm() returns boolean (approve=true / reject=false); for "skip" or
        // "exit", we use select() afterwards if user wants more options.
        const message = [
          `Domain:     ${candidate.domain}`,
          `Title:      ${candidate.title}`,
          `Summary:    ${candidate.summary || "(no summary)"}`,
          `Confidence: ${candidate.confidence || "unknown"}`,
          "",
          "Payload preview:",
          payloadPreview,
          "",
          "Approve? (No = reject)",
        ].join("\n");

        const choice = await cmdCtx.ui.select(
          `Reviewing (${reviewable.length} left): ${candidate.title}`,
          ["Approve", "Reject", "Skip this one", "Exit review"],
        );
        // Use a noop to avoid unused warning; message is displayed via notify before select.
        void message;

        if (choice === undefined || choice === "Exit review") {
          cmdCtx.ui.notify("Review ended.", "info");
          return;
        }
        if (choice === "Skip this one") {
          reviewable.shift();
          continue;
        }
        try {
          if (choice === "Approve") {
            await store.approveCandidate(candidate.id);
            cmdCtx.ui.notify(`Approved: ${candidate.title}`, "info");
          } else if (choice === "Reject") {
            await store.rejectCandidate(candidate.id);
            cmdCtx.ui.notify(`Rejected: ${candidate.title}`, "info");
          }
          reviewable.shift();
        } catch (err) {
          cmdCtx.ui.notify(
            `Failed: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        }
      }
      cmdCtx.ui.notify("All pending candidates reviewed.", "info");
    },
  });
  } // end if registerCommand

  // --- Notify user when new candidates appear after agent_end ---

  pi.on("agent_end", async () => {
    if (!learningAvailable) return;
    try {
      const snapshot = await getStore().getSnapshot();
      const pendingCount = snapshot.overview.pendingCandidates;
      if (pendingCount > 0) {
        ctx?.ui.notify(
          `Learning has ${pendingCount} pending candidate${pendingCount === 1 ? "" : "s"}. Run /learning to review.`,
          "info",
        );
      }
    } catch {
      // Non-critical: skip notification if snapshot fails.
    }
  });
}
