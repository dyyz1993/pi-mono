import type { ExtensionAPI, ExtensionContext, SessionTreeEvent, TurnEndEvent, GCResult } from "@dyyz1993/pi-coding-agent";
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface GitApi {
  gc: (hashes: Set<string>) => Promise<GCResult>;
  pruneOldObjects: (age: number, hashes: Set<string>) => Promise<GCResult>;
  getStats: () => { totalObjects: number; totalBytes: number; treeObjects: number; fileObjects: number };
  enforceLimit: (limit: number, hashes: Set<string>) => Promise<GCResult>;
  readTree: (hash: string) => Map<string, string>;
}

interface FileSnapshotManagerInternal {
  git: GitApi;
  sessionStartTreeHash: string | null;
  lastCommittedTreeHash: string | null;
}

type DynamicEventEmitter = { on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) => void };

function getGitApi(mgr: { git: GitApi }): GitApi {
  return mgr.git;
}

function getInternal(mgr: unknown): FileSnapshotManagerInternal {
  return mgr as FileSnapshotManagerInternal;
}

/**
 * Scan all JSONL files in a session directory for step-snapshot hashes.
 * Returns a Set of snapshotTreeHash and baselineTreeHash values found.
 * Exported for testing.
 */
export function collectSnapshotHashesFromDir(sessionDir: string, into?: Set<string>): Set<string> {
  const hashes = into ?? new Set<string>();
  try {
    const files = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = join(sessionDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        for (const line of content.split("\n")) {
          if (!line.includes("step-snapshot")) continue;
          try {
            const entry = JSON.parse(line) as {
              customType?: string;
              data?: { snapshotTreeHash?: string; baselineTreeHash?: string };
            };
            if (entry.customType === "step-snapshot" && entry.data) {
              if (entry.data.snapshotTreeHash) {
                hashes.add(entry.data.snapshotTreeHash);
              }
              if (entry.data.baselineTreeHash) {
                hashes.add(entry.data.baselineTreeHash);
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Session directory may not exist
  }
  return hashes;
}

const DEFAULT_GC_CONFIG = {
  // Auto GC on session shutdown
  autoGCOnShutdown: true,
  // Enforce disk limit (default 100MB)
  maxStoreSizeBytes: 100 * 1024 * 1024,
  // Prune objects older than 30 days
  pruneAgeMs: 30 * 24 * 60 * 60 * 1000,
};

export default function fileSnapshot(pi: ExtensionAPI) {
  let ctx: ExtensionContext | null = null;

  // Create typed channel (registerChannel only available in RPC mode)
  let channel: ReturnType<typeof createTypedChannel>["server"] | null = null;
  try {
    const raw = pi.registerChannel("file-snapshot");
    channel = createTypedChannel(raw).server;
  } catch {
    // registerChannel only available in RPC mode
  }

  channel?.handle("snapshot.list", () => {
    const mgr = ctx?.fileSnapshotManager;
    if (!mgr || !ctx) return [];
    return mgr.getModifiedFiles({});
  });

  channel?.handle("snapshot.rollback", async (params: unknown) => {
    if (!ctx) return { ok: false, error: "Extension context not available" };
    const mgr = ctx.fileSnapshotManager;
    if (!mgr) return { ok: false, error: "fileSnapshotManager not available" };
    const { snapshotId, files } = params as { snapshotId: string; files?: string[] };
    const result = await mgr.restoreFiles(ctx.cwd, {
      targetEntryId: snapshotId,
      files,
      entries: ctx.sessionManager.getEntries() as import("@dyyz1993/pi-coding-agent").SessionEntry[],
      appendEntry: (type: string, data: unknown) => {
        return pi.appendEntry(type, data) ?? undefined;
      },
    });
    return {
      ok: true,
      restoredFiles: [...result.restored, ...result.deleted],
      skippedFiles: result.skipped,
    };
  });

  channel?.handle("snapshot.unrevert", async (params: unknown) => {
    if (!ctx) return { ok: false, error: "Extension context not available" };
    const mgr = ctx.fileSnapshotManager;
    if (!mgr) return { ok: false, error: "fileSnapshotManager not available" };
    const { snapshotId } = params as { snapshotId: string };
    const entries = ctx.sessionManager.getEntries() as import("@dyyz1993/pi-coding-agent").SessionEntry[];
    for (const entry of entries) {
      if (entry.type !== "custom") continue;
      const custom = entry as { customType: string; data: { rolledBackToLeaf: string; preRollbackTreeHash: string | null } };
      if (custom.customType === "unrevert-point" && custom.data.rolledBackToLeaf === snapshotId) {
        const restoreResult = await mgr.restoreFiles(ctx.cwd, {
          snapshotHash: custom.data.preRollbackTreeHash ?? undefined,
          entries,
          appendEntry: (type: string, data: unknown) => {
            return pi.appendEntry(type, data) ?? undefined;
          },
        });
        return {
          ok: true,
          restoredFiles: [...restoreResult.restored, ...restoreResult.deleted],
        };
      }
    }
    return { ok: false, error: "Unrevert point not found" };
  });

  channel?.handle("snapshot.get", (params: unknown) => {
    const mgr = ctx?.fileSnapshotManager;
    if (!mgr || !ctx) return null;
    const { snapshotId } = params as { snapshotId: string };
    const data = mgr.getSnapshotAtEntry(snapshotId);
    if (!data) return null;
    const diff = data.diff ?? { added: [], modified: [], deleted: [] };
    return {
      id: snapshotId,
      stepIndex: data.turnIndex,
      treeHash: data.snapshotTreeHash,
      diff,
      files: Object.fromEntries([
        ...diff.added.map((f) => [f, "added"]),
        ...diff.modified.map((f) => [f, "modified"]),
        ...diff.deleted.map((f) => [f, "deleted"]),
      ]),
      rolledBack: false,
    };
  });

  channel?.handle("snapshot.restoreByHash", async (params: unknown) => {
    if (!ctx) return { restored: [] };
    const mgr = ctx.fileSnapshotManager;
    if (!mgr) return { restored: [] };
    const { snapshotTreeHash, files } = params as { snapshotTreeHash: string; files?: string[] };
    const result = await mgr.restoreFiles(ctx.cwd, {
      snapshotHash: snapshotTreeHash,
      files,
      entries: ctx.sessionManager.getEntries() as import("@dyyz1993/pi-coding-agent").SessionEntry[],
      appendEntry: (type: string, data: unknown) => {
        return pi.appendEntry(type, data) ?? undefined;
      },
    });
    return {
      restored: [...result.restored, ...result.deleted],
    };
  });

  channel?.handle("snapshot.gc", () => {
    const mgr = ctx?.fileSnapshotManager;
    if (!mgr) return { deletedObjects: 0, freedBytes: 0 };
    const activeHashes = mgr.getActiveTreeHashes();
    return getGitApi(getInternal(mgr)).gc(activeHashes);
  });

  channel?.handle("snapshot.prune", (params: unknown) => {
    const mgr = ctx?.fileSnapshotManager;
    if (!mgr) return { deletedObjects: 0, freedBytes: 0 };
    const { maxAgeMs } = params as { maxAgeMs?: number };
    const activeHashes = mgr.getActiveTreeHashes();
    const age = maxAgeMs ?? DEFAULT_GC_CONFIG.pruneAgeMs;
    return getGitApi(getInternal(mgr)).pruneOldObjects(age, activeHashes);
  });

  channel?.handle("snapshot.stats", () => {
    const mgr = ctx?.fileSnapshotManager;
    if (!mgr) return { totalObjects: 0, totalBytes: 0, treeObjects: 0, fileObjects: 0 };
    return getGitApi(getInternal(mgr)).getStats();
  });

  channel?.handle("snapshot.enforceLimit", (params: unknown) => {
    const mgr = ctx?.fileSnapshotManager;
    if (!mgr) return { deletedObjects: 0, freedBytes: 0 };
    const { maxBytes } = params as { maxBytes?: number };
    const activeHashes = mgr.getActiveTreeHashes();
    const limit = maxBytes ?? DEFAULT_GC_CONFIG.maxStoreSizeBytes;
    return getGitApi(getInternal(mgr)).enforceLimit(limit, activeHashes);
  });

  pi.on("session_start", async (event: unknown, context: ExtensionContext) => {
    ctx = context;
    const mgr = ctx.fileSnapshotManager;
    if (!mgr) return;
    await mgr.initialize(ctx.cwd);
  });

  pi.on("turn_end", async (event: TurnEndEvent, _ctx: ExtensionContext) => {
    const mgr = _ctx.fileSnapshotManager;
    if (!mgr) return;
    mgr.onTurnEnd(_ctx.cwd, event.turnIndex, (type, data) => {
      return pi.appendEntry(type, data, { display: false }) ?? undefined;
    });
  });

  (pi as unknown as DynamicEventEmitter).on("session_tree", async (event: unknown, _ctx: ExtensionContext) => {
    const e = event as SessionTreeEvent;
    if (e.skipFiles) return;
    const mgr = _ctx.fileSnapshotManager;
    if (!mgr) return;

    const targetEntryId = e.newLeafId ?? undefined;

    const result = await mgr.restoreFiles(_ctx.cwd, {
      targetEntryId,
      preview: e.preview,
      currentLeafId: e.oldLeafId,
      entries: _ctx.sessionManager.getEntries() as import("@dyyz1993/pi-coding-agent").SessionEntry[],
      appendEntry: (type: string, data: unknown) => {
        return pi.appendEntry(type, data) ?? undefined;
      },
    });

    // If restoreFiles returned empty but target is null (rollback to root with empty start),
    // we need to handle this case by reading current files and deleting them.
    if (!e.preview && targetEntryId === undefined && result.deleted.length === 0 && result.restored.length === 0) {
      // Check if sessionStartTreeHash is null (empty dir at start)
      const internal = getInternal(mgr);
      const sessionStartHash = internal.sessionStartTreeHash;
      const lastCommittedHash = internal.lastCommittedTreeHash;
      const compareTo = lastCommittedHash ?? sessionStartHash;

      if (sessionStartHash === null && compareTo !== null) {
        const { readdirSync, rmSync } = await import("node:fs");
        const { join: joinPath } = await import("node:path");
        const git = getGitApi(internal);
        if (git && typeof git.readTree === "function") {
          const currentFiles = git.readTree(compareTo);
          if (currentFiles) {
            for (const filePath of currentFiles.keys()) {
              try {
                rmSync(joinPath(_ctx.cwd, filePath));
              } catch {
                // File may already be deleted
              }
            }
          }
        }
      }
    }

    // Return preview result so previewRollback() can read it
    return { restored: result.restored, deleted: result.deleted, skipped: result.skipped };
  });

  // Auto GC on session shutdown
  pi.on("session_shutdown", async (_event: unknown, _ctx: ExtensionContext) => {
    if (!DEFAULT_GC_CONFIG.autoGCOnShutdown) return;

    const mgr = _ctx.fileSnapshotManager;
    if (!mgr) return;

    try {
      const activeHashes = typeof mgr.getActiveTreeHashes === "function"
        ? mgr.getActiveTreeHashes()
        : new Set<string>();

      // Scan all JSONL files in the project session directory to collect
      // snapshot hashes from other sessions (delegates, etc.) so GC
      // doesn't delete objects still in use by those sessions.
      const sessionDir = _ctx.sessionManager.getSessionDir();
      collectSnapshotHashesFromDir(sessionDir, activeHashes);

      const git = getGitApi(getInternal(mgr));

      // Run GC to clean up unreferenced objects
      const gcResult = await git.gc(activeHashes);
      if (gcResult.deletedObjects > 0) {
        console.log(`[file-snapshot] GC: deleted ${gcResult.deletedObjects} objects, freed ${gcResult.freedBytes} bytes`);
      }

      // Enforce disk limit
      const limitResult = await git.enforceLimit(DEFAULT_GC_CONFIG.maxStoreSizeBytes, activeHashes);
      if (limitResult.deletedObjects > 0) {
        console.log(`[file-snapshot] Limit: deleted ${limitResult.deletedObjects} objects, freed ${limitResult.freedBytes} bytes`);
      }
    } catch (error) {
      console.error("[file-snapshot] GC failed:", error);
    }
  });
}