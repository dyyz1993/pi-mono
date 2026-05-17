import type { ExtensionAPI, ExtensionContext, SessionTreeEvent, TurnEndEvent } from "@dyyz1993/pi-coding-agent";

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

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
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

		await mgr.restoreFiles(ctx.cwd, {
			targetEntryId: event.newLeafId ?? undefined,
			preview: event.preview,
			currentLeafId: event.oldLeafId,
			entries: ctx.sessionManager.getEntries() as import("@dyyz1993/pi-coding-agent").SessionEntry[],
			appendEntry: (type: string, data: unknown) => {
				return pi.appendEntry(type, data) ?? undefined;
			},
		});
	});

	// Auto GC on session shutdown
	pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
		if (!DEFAULT_GC_CONFIG.autoGCOnShutdown) return;

		const mgr = ctx.fileSnapshotManager;
		if (!mgr) return;

		try {
			const activeHashes = typeof mgr.getActiveTreeHashes === "function"
				? mgr.getActiveTreeHashes()
				: [];
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