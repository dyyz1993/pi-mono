import type { ExtensionAPI, ExtensionContext, SessionTreeEvent, TurnEndEvent } from "@dyyz1993/pi-coding-agent";

export default function fileSnapshot(pi: ExtensionAPI) {
	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		const mgr = ctx.fileSnapshotManager;
		if (!mgr) return;
		await mgr.initialize(ctx.cwd);
	});

	pi.on("turn_end", async (event: TurnEndEvent, ctx: ExtensionContext) => {
		const mgr = ctx.fileSnapshotManager;
		if (!mgr) return;
		mgr.onTurnEnd(ctx.cwd, event.turnIndex, (type, data): undefined => {
			pi.appendEntry(type, data, { display: false });
			return undefined;
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
			appendEntry: (type: string, data: unknown): undefined => {
				pi.appendEntry(type, data);
				return undefined;
			},
		});
	});
}
