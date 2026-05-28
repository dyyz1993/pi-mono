import type { ExtensionAPI, ExtensionContext, SessionTreeEvent, TurnEndEvent } from "@dyyz1993/pi-coding-agent";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  const channel = pi.registerChannel("file-snapshot");

  channel.onReceive(async (msg) => {
    const ctx = msg.context as ExtensionContext | undefined;
    if (!ctx) {
      return { error: "Extension context not available in channel message. This operation is not supported via RPC client channel calls." };
    }
    const mgr = ctx.fileSnapshotManager;
    if (!mgr) {
      return { error: "fileSnapshotManager not available" };
    }

    switch (msg.method) {
      case "snapshot.list": {
        const snapshots = mgr.getModifiedFiles({});
        return snapshots;
      }
      case "snapshot.rollback": {
        // WARNING: This only restores files without moving the message pointer.
        // For a complete rollback (messages + files), use navigate_tree instead.
        // This channel method exists for internal use (e.g., unrevert) and
        // selective file restoration. Using it standalone will desynchronize
        // the message context from the disk state.
        const { snapshotId, files } = msg.params as {
          sessionId: string;
          snapshotId: string;
          files?: string[];
        };
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
      }
      case "snapshot.unrevert": {
        const { snapshotId } = msg.params as {
          sessionId: string;
          snapshotId: string;
        };
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
      }
      case "snapshot.get": {
        const { snapshotId } = msg.params as { sessionId: string; snapshotId: string };
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
      }
      case "snapshot.restoreByHash": {
        const { snapshotTreeHash, files } = msg.params as {
          snapshotTreeHash: string;
          files?: string[];
        };
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
      }
      case "snapshot.gc": {
        const activeHashes = mgr.getActiveTreeHashes();
        const result = await (mgr as any).git.gc(activeHashes);
        return result;
      }
      case "snapshot.prune": {
        const { maxAgeMs } = msg.params as { maxAgeMs?: number };
        const activeHashes = mgr.getActiveTreeHashes();
        const age = maxAgeMs ?? DEFAULT_GC_CONFIG.pruneAgeMs;
        const result = await (mgr as any).git.pruneOldObjects(age, activeHashes);
        return result;
      }
      case "snapshot.stats": {
        const stats = (mgr as any).git.getStats();
        return stats;
      }
      case "snapshot.enforceLimit": {
        const { maxBytes } = msg.params as { maxBytes?: number };
        const activeHashes = mgr.getActiveTreeHashes();
        const limit = maxBytes ?? DEFAULT_GC_CONFIG.maxStoreSizeBytes;
        const result = await (mgr as any).git.enforceLimit(limit, activeHashes);
        return result;
      }
      default:
        return { error: `Unknown method: ${msg.method}` };
    }
  });

  pi.on("session_start", async (event: unknown, ctx: ExtensionContext) => {
    const mgr = ctx.fileSnapshotManager;
    if (!mgr) return;
    await mgr.initialize(ctx.cwd);
  });

  pi.on("turn_end", async (event: TurnEndEvent, ctx: ExtensionContext) => {
    const mgr = ctx.fileSnapshotManager;
    if (!mgr) return;
    mgr.onTurnEnd(ctx.cwd, event.turnIndex, (type, data) => {
      return pi.appendEntry(type, data, { display: false }) ?? undefined;
    });
  });

  pi.on("session_tree", async (event: SessionTreeEvent, ctx: ExtensionContext) => {
    if (event.skipFiles) return;
    const mgr = ctx.fileSnapshotManager;
    if (!mgr) return;

    // When newLeafId is null (rolled back to root), targetEntryId should be undefined
    // so restoreFiles falls back to sessionStartTreeHash.
    // If sessionStartTreeHash is null (empty dir at session start), we need to
    // delete all files manually since the null guard in restoreFiles may block this.
    const targetEntryId = event.newLeafId ?? undefined;

    const result = await mgr.restoreFiles(ctx.cwd, {
      targetEntryId,
      preview: event.preview,
      currentLeafId: event.oldLeafId,
      entries: ctx.sessionManager.getEntries() as import("@dyyz1993/pi-coding-agent").SessionEntry[],
      appendEntry: (type: string, data: unknown) => {
        return pi.appendEntry(type, data) ?? undefined;
      },
    });

    // If restoreFiles returned empty but target is null (rollback to root with empty start),
    // we need to handle this case by reading current files and deleting them.
    if (!event.preview && targetEntryId === undefined && result.deleted.length === 0 && result.restored.length === 0) {
      // Check if sessionStartTreeHash is null (empty dir at start)
      const sessionStartHash = (mgr as any).sessionStartTreeHash as string | null;
      const lastCommittedHash = (mgr as any).lastCommittedTreeHash as string | null;
      const compareTo = lastCommittedHash ?? sessionStartHash;

      if (sessionStartHash === null && compareTo !== null) {
        // Session started with empty dir, now has files. Delete all tracked files.
        const { readdirSync, rmSync } = await import("node:fs");
        const { join: joinPath } = await import("node:path");
        const git = (mgr as any).git;
        if (git && typeof git.readTree === "function") {
          const currentFiles = git.readTree(compareTo);
          for (const filePath of currentFiles.keys()) {
            try {
              rmSync(joinPath(ctx.cwd, filePath));
            } catch {
              // File may already be deleted
            }
          }
        }
      }
    }

    // Return preview result so previewRollback() can read it
    return { restored: result.restored, deleted: result.deleted, skipped: result.skipped };
  });

  // Auto GC on session shutdown
  pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
    if (!DEFAULT_GC_CONFIG.autoGCOnShutdown) return;

    const mgr = ctx.fileSnapshotManager;
    if (!mgr) return;

    try {
      const activeHashes = typeof mgr.getActiveTreeHashes === "function"
        ? mgr.getActiveTreeHashes()
        : new Set<string>();

      // Scan all JSONL files in the project session directory to collect
      // snapshot hashes from other sessions (delegates, etc.) so GC
      // doesn't delete objects still in use by those sessions.
      const sessionDir = ctx.sessionManager.getSessionDir();
      collectSnapshotHashesFromDir(sessionDir, activeHashes);

      const git = (mgr as Record<string, unknown>).git;

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