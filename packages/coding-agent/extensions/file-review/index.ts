import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@dyyz1993/pi-coding-agent";
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import type { LiveChange } from "../../src/core/file-store/file-snapshot-manager.js";
import {
	FILE_REVIEW_CHANNEL_NAME,
	type FileApproval,
	type FileReviewChannelContract,
	type PendingChange,
	type TurnChangeRecord,
} from "./contract.js";

function approvalKey(turnIndex: number, path: string): string {
	return `${turnIndex}:${path}`;
}

export default function fileReview(pi: ExtensionAPI) {
	let ctx: ExtensionContext | null = null;

	const turnLog: TurnChangeRecord[] = [];
	let currentTurnChanges: LiveChange[] = [];
	let currentTurnIndex = -1;

	const approvals = new Map<string, FileApproval>();

	function getApproval(turnIndex: number, path: string): FileApproval {
		const key = approvalKey(turnIndex, path);
		const existing = approvals.get(key);
		if (existing) return existing;
		const pending: FileApproval = { turnIndex, path, status: "pending", timestamp: Date.now() };
		approvals.set(key, pending);
		return pending;
	}

	function setApproval(turnIndex: number, path: string, status: "approved" | "rejected"): boolean {
		const record = turnLog.find((t) => t.turnIndex === turnIndex);
		if (!record) return false;
		const change = record.changes.find((c) => c.path === path);
		if (!change) return false;

		const key = approvalKey(turnIndex, path);
		const entry: FileApproval = { turnIndex, path, status, timestamp: Date.now() };
		approvals.set(key, entry);

		pi.appendEntry("file-approval", { turnIndex, path, status, timestamp: entry.timestamp });
		return true;
	}

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

	channel?.handle("review.pending", () => {
		const result: PendingChange[] = [];
		for (const record of turnLog) {
			for (const change of record.changes) {
				const approval = getApproval(record.turnIndex, change.path);
				if (approval.status === "pending") {
					result.push({
						turnIndex: record.turnIndex,
						path: change.path,
						status: "pending",
						diff: change.diff?.unifiedDiff ?? null,
						timestamp: record.timestamp,
					});
				}
			}
		}
		return result;
	});

	channel?.handle("review.approve", (params) => {
		return { ok: setApproval(params.turnIndex, params.path, "approved") };
	});

	channel?.handle("review.reject", (params) => {
		return { ok: setApproval(params.turnIndex, params.path, "rejected") };
	});

	channel?.handle("review.approveAll", () => {
		let count = 0;
		for (const record of turnLog) {
			for (const change of record.changes) {
				const approval = getApproval(record.turnIndex, change.path);
				if (approval.status === "pending") {
					const key = approvalKey(record.turnIndex, change.path);
					const entry: FileApproval = {
						turnIndex: record.turnIndex,
						path: change.path,
						status: "approved",
						timestamp: Date.now(),
					};
					approvals.set(key, entry);
					pi.appendEntry("file-approval", {
						turnIndex: record.turnIndex,
						path: change.path,
						status: "approved",
						timestamp: entry.timestamp,
					});
					count++;
				}
			}
		}
		return { count };
	});

	channel?.handle("review.approvals", (params) => {
		const all = [...approvals.values()];
		if (params.status) {
			return all.filter((a) => a.status === params.status);
		}
		return all;
	});

	// ─── Event handlers ─────────────────────────────────────────────

	pi.on("session_start", async (_event, _ctx: ExtensionContext) => {
		ctx = _ctx;
		turnLog.length = 0;
		currentTurnChanges = [];
		currentTurnIndex = -1;
		approvals.clear();

		const entries = _ctx.sessionManager.getEntries();
		for (const entry of entries) {
			if (entry.type !== "custom") continue;
			if (entry.customType !== "file-approval") continue;
			const data = entry.data as { turnIndex: number; path: string; status: "approved" | "rejected"; timestamp: number } | undefined;
			if (!data) continue;
			const key = approvalKey(data.turnIndex, data.path);
			approvals.set(key, {
				turnIndex: data.turnIndex,
				path: data.path,
				status: data.status,
				timestamp: data.timestamp,
			});
		}
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

		currentTurnIndex = event.turnIndex;
		// Use changes accumulated during tool_result events (before file-snapshot's
		// onTurnEnd commits the baseline). If no tool_result fired (e.g. no tools used),
		// fall back to getLiveChanges — but guard against file-snapshot having already
		// committed by checking we're the first to see changes.
		const changes = currentTurnChanges.length > 0
			? currentTurnChanges
			: (_ctx.fileSnapshotManager?.getLiveChanges(_ctx.cwd) ?? []);
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
