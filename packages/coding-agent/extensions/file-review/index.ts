import type { ExtensionAPI, ExtensionContext, TurnEndEvent, CustomEntry } from "@dyyz1993/pi-coding-agent";
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LiveChange } from "../../src/core/file-store/file-snapshot-manager.ts";
import {
	FILE_REVIEW_CHANNEL_NAME,
	type FileApproval,
	type FileReviewChannelContract,
	type PendingChange,
	type TurnChangeRecord,
} from "./contract.ts";

function approvalKey(path: string): string {
	return path;
}

export default function fileReview(pi: ExtensionAPI) {
	let ctx: ExtensionContext | null = null;

	const turnLog: TurnChangeRecord[] = [];
	let currentTurnChanges: LiveChange[] = [];
	let currentTurnIndex = -1;

	const approvals = new Map<string, FileApproval>();
	/** Tracks paths that were ever approved — used to prevent net-zero filtering on previously-approved files */
	const everApproved = new Set<string>();
	/** Maps path → entryId of the snapshot when the file was last approved */
	const approvedSnapshotEntry = new Map<string, string>();

	function getApproval(path: string): FileApproval {
		const key = approvalKey(path);
		const existing = approvals.get(key);
		if (existing) return existing;
		const pending: FileApproval = { turnIndex: -1, path, status: "pending", timestamp: Date.now() };
		approvals.set(key, pending);
		return pending;
	}

	function setApproval(path: string, status: "approved" | "rejected"): boolean {
		const key = approvalKey(path);
		const entry: FileApproval = { turnIndex: -1, path, status, timestamp: Date.now() };
		approvals.set(key, entry);
		if (status === "approved") {
			everApproved.add(path);
			const mgr = ctx?.fileSnapshotManager;
			if (mgr && ctx) {
				const entries = ctx.sessionManager.getEntries();
				for (let i = entries.length - 1; i >= 0; i--) {
    			if (entries[i].type === "custom" && (entries[i] as CustomEntry).customType === "step-snapshot") {
						approvedSnapshotEntry.set(path, entries[i].id);
						break;
					}
				}
			}
		}
		pi.appendEntry("file-approval", { path, status, timestamp: entry.timestamp });
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
		// Aggregate by path: track FIRST and LATEST status for each file.
		// Net-zero rule: if first=added AND latest=deleted (never approved), skip it.
		type PathMeta = { firstStatus: LiveChange["status"]; latestTurnIndex: number; latestFileStatus: LiveChange["status"]; latestTimestamp: number };
		const pathMeta = new Map<string, PathMeta>();
		for (const record of turnLog) {
			for (const change of record.changes) {
				const existing = pathMeta.get(change.path);
				if (!existing) {
					pathMeta.set(change.path, {
						firstStatus: change.status,
						latestTurnIndex: record.turnIndex,
						latestFileStatus: change.status,
						latestTimestamp: record.timestamp,
					});
				} else {
					existing.latestTurnIndex = record.turnIndex;
					existing.latestFileStatus = change.status;
					existing.latestTimestamp = record.timestamp;
				}
			}
		}

		// Batch-optimized: read each tree ONCE for all files.
		// Previously called getFileDiff() per file → O(N×M) disk reads.
		// Now uses getBatchFileContents() → O(M) total.
		const mgr = ctx?.fileSnapshotManager;
		const diffMap = new Map<string, { oldContent: string | null; newContent: string | null }>();
		if (mgr && pathMeta.size > 0) {
			try {
				const fileRequests = [...pathMeta.keys()].map((path) => ({
					filePath: path,
					fromEntryId: approvedSnapshotEntry.get(path),
				}));
				const batchResult = mgr.getBatchFileContents(fileRequests);
				for (const [path, content] of batchResult) {
					diffMap.set(path, content);
				}
			} catch {}
		}

		const result: PendingChange[] = [];
		for (const [path, meta] of pathMeta) {
			const approval = getApproval(path);
			if (approval.status !== "pending") continue;

			// Net-zero: file was added then deleted without ever being approved
			if (meta.firstStatus === "added" && meta.latestFileStatus === "deleted" && !everApproved.has(path)) {
				continue;
			}

			const diffInfo = diffMap.get(path);
			result.push({
				turnIndex: meta.latestTurnIndex,
				path,
				fileStatus: meta.latestFileStatus,
				status: "pending",
				timestamp: meta.latestTimestamp,
				oldContent: diffInfo?.oldContent ?? null,
				newContent: diffInfo?.newContent ?? null,
			});
		}
		return result;
	});

	channel?.handle("review.approve", (params) => {
		return { ok: setApproval(params.path, "approved") };
	});

	channel?.handle("review.reject", (params) => {
		// Roll back the file to its pre-modification state
		if (!ctx) return { ok: false, error: "No session context" };
		const mgr = ctx.fileSnapshotManager;
		if (!mgr) return { ok: false, error: "No file snapshot manager" };

		// Get the diff data for this file
		let diffInfo: { oldContent: string | null; newContent: string | null } | null = null;
		try {
			const approvedEntryId = approvedSnapshotEntry.get(params.path);
			const diff = approvedEntryId
				? mgr.getFileDiff({ filePath: params.path, fromEntryId: approvedEntryId, cwd: ctx.cwd })
				: mgr.getFileDiff({ filePath: params.path, cwd: ctx.cwd });
			if (diff) {
				diffInfo = { oldContent: diff.oldContent, newContent: diff.newContent };
			}
		} catch {}
		if (!diffInfo) return { ok: false, error: "No diff data for file" };

		// Perform rollback based on file status
		const fullPath = join(ctx.cwd, params.path);

		let rolledBack = false;
		// Determine file status by checking if oldContent exists
		if (diffInfo.oldContent === null && diffInfo.newContent !== null) {
			// File was ADDED — delete it
			try {
				unlinkSync(fullPath);
				rolledBack = true;
			} catch {}
		} else if (diffInfo.oldContent !== null && diffInfo.newContent === null) {
			// File was DELETED — restore it
			try {
				mkdirSync(dirname(fullPath), { recursive: true });
				writeFileSync(fullPath, diffInfo.oldContent, "utf-8");
				rolledBack = true;
			} catch {}
		} else if (diffInfo.oldContent !== null && diffInfo.newContent !== null) {
			// File was MODIFIED — restore old content
			try {
				writeFileSync(fullPath, diffInfo.oldContent, "utf-8");
				rolledBack = true;
			} catch {}
		}

		if (rolledBack) {
			// Also remove this file from turnLog since it's been rolled back
			for (const record of turnLog) {
				record.changes = record.changes.filter((c) => c.path !== params.path);
			}
		}

		setApproval(params.path, "rejected");
		return { ok: true, rolledBack };
	});

	channel?.handle("review.approveAll", () => {
		let count = 0;
		// Get aggregated paths from turnLog (latest by path)
		const latestByPath = new Map<string, { turnIndex: number; timestamp: number }>();
		for (const record of turnLog) {
			for (const change of record.changes) {
				latestByPath.set(change.path, { turnIndex: record.turnIndex, timestamp: record.timestamp });
			}
		}
		for (const [path] of latestByPath) {
			const approval = getApproval(path);
			if (approval.status === "pending") {
				setApproval(path, "approved");
				count++;
			}
		}
		return { count };
	});

	channel?.handle("review.rejectAll", () => {
		if (!ctx) return { count: 0, rolledBack: 0 };
		const mgr = ctx.fileSnapshotManager;

		// Get aggregated paths from turnLog (latest by path)
		const latestByPath = new Map<string, { turnIndex: number; timestamp: number }>();
		for (const record of turnLog) {
			for (const change of record.changes) {
				latestByPath.set(change.path, { turnIndex: record.turnIndex, timestamp: record.timestamp });
			}
		}

		let count = 0;
		let rolledBack = 0;
		for (const [path] of latestByPath) {
			const approval = getApproval(path);
			if (approval.status === "pending") {
				// Roll back this file
				if (mgr) {
					let diffInfo: { oldContent: string | null; newContent: string | null } | null = null;
					try {
						const approvedEntryId = approvedSnapshotEntry.get(path);
						const diff = approvedEntryId
							? mgr.getFileDiff({ filePath: path, fromEntryId: approvedEntryId, cwd: ctx.cwd })
							: mgr.getFileDiff({ filePath: path, cwd: ctx.cwd });
						if (diff) diffInfo = { oldContent: diff.oldContent, newContent: diff.newContent };
					} catch {}

					if (diffInfo) {
						const fullPath = join(ctx.cwd, path);
						let didRollback = false;
						if (diffInfo.oldContent === null && diffInfo.newContent !== null) {
							try { unlinkSync(fullPath); didRollback = true; } catch {}
						} else if (diffInfo.oldContent !== null && diffInfo.newContent === null) {
							try { mkdirSync(dirname(fullPath), { recursive: true }); writeFileSync(fullPath, diffInfo.oldContent, "utf-8"); didRollback = true; } catch {}
						} else if (diffInfo.oldContent !== null && diffInfo.newContent !== null) {
							try { writeFileSync(fullPath, diffInfo.oldContent, "utf-8"); didRollback = true; } catch {}
						}
						if (didRollback) {
							rolledBack++;
							for (const record of turnLog) {
								record.changes = record.changes.filter((c) => c.path !== path);
							}
						}
					}
				}
				setApproval(path, "rejected");
				count++;
			}
		}
		return { count, rolledBack };
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
		everApproved.clear();
		approvedSnapshotEntry.clear();

		const entries = _ctx.sessionManager.getEntries();
		let lastStepSnapshotId: string | undefined;
		for (const entry of entries) {
			if (entry.type !== "custom") continue;

			if (entry.customType === "step-snapshot") {
				lastStepSnapshotId = entry.id;
			} else if (entry.customType === "file-approval") {
				const data = entry.data as { path: string; status: "approved" | "rejected"; timestamp: number } | undefined;
				if (!data) continue;
				const key = approvalKey(data.path);
				approvals.set(key, {
					turnIndex: -1,
					path: data.path,
					status: data.status,
					timestamp: data.timestamp,
				});
				if (data.status === "approved") {
					everApproved.add(data.path);
					if (lastStepSnapshotId) {
						approvedSnapshotEntry.set(data.path, lastStepSnapshotId);
					}
				}
			} else if (entry.customType === "file-review-turn") {
				const data = entry.data as { turnIndex: number; timestamp: number; changes: Array<{ path: string; status: string }> } | undefined;
				if (!data) continue;
				turnLog.push({
					turnIndex: data.turnIndex,
					timestamp: data.timestamp,
					changes: data.changes.map((c) => ({
						path: c.path,
						status: c.status as LiveChange["status"],
						diff: null,
					})),
				});
			}
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
		const changes = currentTurnChanges.length > 0
			? currentTurnChanges
			: (_ctx.fileSnapshotManager?.getLiveChanges(_ctx.cwd) ?? []);
		if (changes.length > 0) {
			const timestamp = Date.now();
			turnLog.push({
				turnIndex: event.turnIndex,
				timestamp,
				changes,
			});
			pi.appendEntry("file-review-turn", {
				turnIndex: event.turnIndex,
				timestamp,
				changes: changes.map((c) => ({ path: c.path, status: c.status })),
			});

			// Reset approval to pending for any file that changed after being approved/rejected
			for (const change of changes) {
				const existing = approvals.get(approvalKey(change.path));
				if (existing && (existing.status === "approved" || existing.status === "rejected")) {
					existing.status = "pending";
					existing.timestamp = Date.now();
				}
			}
		}
		currentTurnChanges = [];
	});
}
