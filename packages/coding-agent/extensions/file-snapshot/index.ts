import type { ExtensionAPI, ExtensionContext, SessionTreeEvent, TurnEndEvent } from "@dyyz1993/pi-coding-agent";

export default function fileSnapshot(pi: ExtensionAPI) {
	const channel = pi.registerChannel("file-snapshot");

	channel.onReceive(async (msg) => {
		const ctx = msg.context as ExtensionContext;
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
}
