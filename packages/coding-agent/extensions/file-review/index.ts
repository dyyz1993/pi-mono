import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@dyyz1993/pi-coding-agent";
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import type { LiveChange } from "../../src/core/file-store/file-snapshot-manager.js";
import { FILE_REVIEW_CHANNEL_NAME, type FileReviewChannelContract, type TurnChangeRecord } from "./contract.js";

export default function fileReview(pi: ExtensionAPI) {
	let ctx: ExtensionContext | null = null;

	const turnLog: TurnChangeRecord[] = [];
	let currentTurnChanges: LiveChange[] = [];
	let currentTurnIndex = -1;

	// ─── Typed channel ──────────────────────────────────────────────

	let channel: ReturnType<typeof createTypedChannel<FileReviewChannelContract>>["server"] | null = null;
	try {
		const raw = pi.registerChannel(FILE_REVIEW_CHANNEL_NAME);
		channel = createTypedChannel<FileReviewChannelContract>(raw).server;
	} catch {
		// registerChannel only available in RPC mode
	}

	channel?.handle("review.live", () => {
		const mgr = ctx?.fileSnapshotManager;
		if (!mgr || !ctx) return { turnIndex: currentTurnIndex, changes: [] };

		const changes = mgr.getLiveChanges(ctx.cwd);
		return { turnIndex: currentTurnIndex, changes };
	});

	channel?.handle("review.history", (params) => {
		let result = turnLog;
		if (params.fromTurn !== undefined) {
			result = result.filter((t) => t.turnIndex >= params.fromTurn!);
		}
		if (params.pathFilter) {
			result = result.map((t) => ({
				...t,
				changes: t.changes.filter((c) => c.path.includes(params.pathFilter!)),
			}));
		}
		return result;
	});

	channel?.handle("review.summary", () => {
		return turnLog.map((t) => ({
			turnIndex: t.turnIndex,
			timestamp: t.timestamp,
			added: t.changes.filter((c) => c.status === "added").length,
			modified: t.changes.filter((c) => c.status === "modified").length,
			deleted: t.changes.filter((c) => c.status === "deleted").length,
			files: t.changes.map((c) => `${c.status[0]} ${c.path}`),
		}));
	});

	channel?.handle("review.fileHistory", (params) => {
		const history: Array<{ turnIndex: number; status: string; diff: LiveChange["diff"] }> = [];
		for (const t of turnLog) {
			const match = t.changes.find((c) => c.path === params.path);
			if (match) {
				history.push({ turnIndex: t.turnIndex, status: match.status, diff: match.diff });
			}
		}
		return history;
	});

	channel?.handle("review.clear", () => {
		turnLog.length = 0;
		currentTurnChanges = [];
		return { ok: true };
	});

	// ─── Event handlers ─────────────────────────────────────────────

	pi.on("session_start", async () => {
		turnLog.length = 0;
		currentTurnChanges = [];
		currentTurnIndex = -1;
	});

	pi.on("turn_start", async () => {
		currentTurnChanges = [];
	});

	pi.on("tool_result", async (_event, _ctx: ExtensionContext) => {
		ctx = _ctx;
		const mgr = _ctx.fileSnapshotManager;
		if (!mgr) return;
		currentTurnChanges = mgr.getLiveChanges(_ctx.cwd);
	});

	pi.on("turn_end", async (event: TurnEndEvent, _ctx: ExtensionContext) => {
		ctx = _ctx;
		const mgr = _ctx.fileSnapshotManager;
		if (!mgr) return;

		currentTurnIndex = event.turnIndex;
		const changes = mgr.getLiveChanges(_ctx.cwd);
		if (changes.length > 0) {
			turnLog.push({
				turnIndex: event.turnIndex,
				timestamp: Date.now(),
				changes,
			});
		}
		currentTurnChanges = [];
	});
}
