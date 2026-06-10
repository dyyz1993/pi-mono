import type { ExtensionAPI, ExtensionContext, TurnEndEvent, CustomEntry } from "@dyyz1993/pi-coding-agent";
import { createTypedChannel } from "@dyyz1993/pi-coding-agent";
import * as Diff from "diff";
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

function computeDiffInfo(oldContent: string | null, newContent: string | null) {
	if (oldContent === null && newContent === null) {
		return { unifiedDiff: "", addedLines: 0, deletedLines: 0 };
	}

	const oldText = oldContent ?? "";
	const newText = newContent ?? "";

	if (oldContent === null) {
		const lines = newText.split("\n");
		const trailing = newText.endsWith("\n") ? 1 : 0;
		return {
			unifiedDiff: Diff.createTwoFilesPatch("", "", "", newText, undefined, undefined, { context: 3 }),
			addedLines: lines.length - trailing,
			deletedLines: 0,
		};
	}

	if (newContent === null) {
		const lines = oldText.split("\n");
		const trailing = oldText.endsWith("\n") ? 1 : 0;
		return {
			unifiedDiff: Diff.createTwoFilesPatch("", "", oldText, "", undefined, undefined, { context: 3 }),
			addedLines: 0,
			deletedLines: lines.length - trailing,
		};
	}

	const changes = Diff.diffLines(oldText, newText);
	let addedLines = 0;
	let deletedLines = 0;

	for (const part of changes) {
		if (part.added) {
			const lines = part.value.split("\n");
			addedLines += lines.length - (part.value.endsWith("\n") ? 1 : 0);
		} else if (part.removed) {
			const lines = part.value.split("\n");
			deletedLines += lines.length - (part.value.endsWith("\n") ? 1 : 0);
		}
	}

	const unifiedDiff = Diff.createTwoFilesPatch("", "", oldText, newText, undefined, undefined, { context: 3 });

	return { unifiedDiff, addedLines, deletedLines };
}

function approvalKey(path: string): string {
	return path;
}

export default function fileReview(pi: ExtensionAPI) {
	let ctx: ExtensionContext | null = null;

	const MAX_TURNS_RETAINED = 50;

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
		const existing = approvals.get(key);
		if (existing && existing.status === status) return true;
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
		// Also include current turn's live changes (before turn_end fires)
		for (const change of currentTurnChanges) {
			const existing = pathMeta.get(change.path);
			if (!existing) {
				pathMeta.set(change.path, {
					firstStatus: change.status,
					latestTurnIndex: currentTurnIndex,
					latestFileStatus: change.status,
					latestTimestamp: Date.now(),
				});
			} else {
				existing.latestTurnIndex = currentTurnIndex;
				existing.latestFileStatus = change.status;
				existing.latestTimestamp = Date.now();
			}
		}

		// Build diff data for pending files.
		// For files with an approved baseline, compare approved snapshot → live disk.
		// For never-approved files, compare session start → live disk.
		// getBatchFileContents only reads committed snapshots (not live disk),
		// so we use getLiveChanges for newContent to capture uncommitted changes.
		const mgr = ctx?.fileSnapshotManager;
		const diffMap = new Map<string, { oldContent: string | null; newContent: string | null }>();
		if (mgr && ctx && pathMeta.size > 0) {
			// Get live (disk) content for all pending files
			const liveChanges = mgr.getLiveChanges(ctx.cwd);
			const liveMap = new Map<string, { oldContent: string | null; newContent: string | null }>();
			for (const change of liveChanges) {
				if (change.diff) {
					liveMap.set(change.path, change.diff);
				}
			}

			// Get oldContent from the correct baseline (approved snapshot or session start)
			try {
				const fileRequests = [...pathMeta.keys()].map((path) => ({
					filePath: path,
					fromEntryId: approvedSnapshotEntry.get(path),
				}));
				const batchResult = mgr.getBatchFileContents(fileRequests);
				for (const [path, content] of batchResult) {
					diffMap.set(path, content);
				}
			} catch (error) {
				console.error("[file-review] getBatchFileContents failed:", error);
			}

			// Merge: use batchDiff.oldContent as baseline (session start or approved snapshot),
			// liveDiff.newContent as the current disk content.
			// getLiveChanges uses lastCommittedTreeHash which already includes changes from
			// previous turns, so its oldContent is wrong for unapproved files.
			for (const [path, meta] of pathMeta) {
				const batchDiff = diffMap.get(path);
				const liveDiff = liveMap.get(path);

				if (liveDiff) {
					// File has live changes on disk
					// Use batchDiff.oldContent as baseline, but for "added" files oldContent
					// must be null (the file didn't exist before the session)
					if (batchDiff) {
						const oldContent = meta.firstStatus === "added" ? null : batchDiff.oldContent;
						diffMap.set(path, {
							oldContent,
							newContent: liveDiff.newContent,
						});
					} else {
						// No batch result — use liveDiff as-is (oldContent may be null for truly new files)
						diffMap.set(path, liveDiff);
					}
				} else if (meta.latestFileStatus === "deleted") {
					// File was deleted from disk — oldContent from baseline
					const oldContent = batchDiff?.oldContent ?? null;
					diffMap.set(path, { oldContent, newContent: null });
				} else if (batchDiff) {
					// No live change but batch has data (file unchanged since last snapshot)
					// This means oldContent == newContent in batch — use null for oldContent
					// based on fileStatus to get correct diff
					const oldContent = meta.firstStatus === "added" ? null : batchDiff.oldContent;
					diffMap.set(path, { oldContent, newContent: batchDiff.newContent });
				}
			}
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
			const oldContent = diffInfo?.oldContent ?? null;
			const newContent = diffInfo?.newContent ?? null;
			const { unifiedDiff, addedLines, deletedLines } = computeDiffInfo(oldContent, newContent);
			result.push({
				turnIndex: meta.latestTurnIndex,
				path,
				fileStatus: meta.latestFileStatus,
				status: "pending",
				timestamp: meta.latestTimestamp,
				oldContent,
				newContent,
				unifiedDiff,
				addedLines,
				deletedLines,
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
				? mgr.getFileDiff({ filePath: params.path, fromEntryId: approvedEntryId })
				: mgr.getFileDiff({ filePath: params.path });
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
							? mgr.getFileDiff({ filePath: path, fromEntryId: approvedEntryId })
							: mgr.getFileDiff({ filePath: path });
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
				if (turnLog.length >= MAX_TURNS_RETAINED) turnLog.shift();
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
			if (turnLog.length > MAX_TURNS_RETAINED) {
				turnLog.splice(0, turnLog.length - MAX_TURNS_RETAINED);
			}
			pi.appendEntry("file-review-turn", {
				turnIndex: event.turnIndex,
				timestamp,
				changes: changes.map((c) => ({ path: c.path, status: c.status })),
			});

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
