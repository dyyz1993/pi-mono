import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@dyyz1993/pi-coding-agent";
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

	function getLatestStepSnapshotEntryId(): string | undefined {
		const mgr = ctx?.fileSnapshotManager;
		if (mgr) {
			const latest = mgr.getLatestSnapshotEntryId();
			if (latest) return latest;
		}
		const entries = ctx?.sessionManager.getEntries();
		if (!entries) return undefined;
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i]!;
			if (entry.type === "custom" && entry.customType === "step-snapshot") return entry.id;
		}
		return undefined;
	}

	function ensureCurrentSnapshotEntryId(): string | undefined {
		const mgr = ctx?.fileSnapshotManager;
		if (mgr && ctx && mgr.getLiveChanges(ctx.cwd).length > 0) {
			mgr.onTurnEnd(ctx.cwd, currentTurnIndex, (type, data) => pi.appendEntry(type, data) ?? "");
		}
		return getLatestStepSnapshotEntryId();
	}

	function getSnapshotTreeHash(snapshotEntryId: string | undefined): string | undefined {
		if (!snapshotEntryId) return undefined;
		const indexed = ctx?.fileSnapshotManager?.getSnapshotAtEntry(snapshotEntryId)?.snapshotTreeHash;
		if (indexed) return indexed;
		const entries = ctx?.sessionManager.getEntries();
		if (!entries) return undefined;
		for (const entry of entries) {
			if (entry.type !== "custom" || entry.customType !== "step-snapshot" || entry.id !== snapshotEntryId) continue;
			const data = entry.data as { snapshotTreeHash?: string } | undefined;
			if (data?.snapshotTreeHash) return data.snapshotTreeHash;
		}
		return undefined;
	}

	function getApproval(path: string): FileApproval {
		const key = approvalKey(path);
		const existing = approvals.get(key);
		if (existing) return existing;
		const pending: FileApproval = { turnIndex: -1, path, status: "pending", timestamp: Date.now() };
		approvals.set(key, pending);
		return pending;
	}

	function setApproval(
		path: string,
		status: "approved" | "rejected",
		snapshotEntryId?: string,
		snapshotTreeHash?: string,
	): boolean {
		const key = approvalKey(path);
		const existing = approvals.get(key);
		if (existing && existing.status === status && existing.snapshotEntryId === snapshotEntryId) return true;
		const entry: FileApproval = { turnIndex: -1, path, status, timestamp: Date.now(), snapshotEntryId, snapshotTreeHash };
		approvals.set(key, entry);
		if (status === "approved") {
			everApproved.add(path);
			if (snapshotEntryId) {
				approvedSnapshotEntry.set(path, snapshotEntryId);
			}
		} else {
			approvedSnapshotEntry.delete(path);
		}
		pi.appendEntry("file-approval", {
			path,
			status,
			timestamp: entry.timestamp,
			snapshotEntryId,
			snapshotTreeHash,
		});
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
		type PathMeta = { firstStatus: LiveChange["status"]; firstTurnIndex: number; latestTurnIndex: number; latestFileStatus: LiveChange["status"]; latestTimestamp: number };
		const pathMeta = new Map<string, PathMeta>();
		for (const record of turnLog) {
			for (const change of record.changes) {
				const existing = pathMeta.get(change.path);
				if (!existing) {
					pathMeta.set(change.path, {
						firstStatus: change.status,
						firstTurnIndex: record.turnIndex,
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
					firstTurnIndex: currentTurnIndex,
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

		// Build maps from session entries so review.pending can recover baselines
		// even when the in-memory snapshot index was rebuilt or is stale.
		// Use FIRST occurrence per turnIndex (rollback creates duplicate turn indices;
		// the first one is the correct baseline before modification).
		const turnToTreeHash = new Map<number, string>();
		const snapshotEntryToTreeHash = new Map<string, string>();
		const allEntries = ctx?.sessionManager.getEntries();
		if (allEntries) {
			for (const entry of allEntries) {
				if (entry.type === "custom" && entry.customType === "step-snapshot") {
					const data = entry.data as { turnIndex: number; snapshotTreeHash: string };
					if (data && typeof data.turnIndex === "number" && data.snapshotTreeHash) {
						if (entry.id) {
							snapshotEntryToTreeHash.set(entry.id, data.snapshotTreeHash);
						}
						// Only set if not already present (first occurrence wins)
						if (!turnToTreeHash.has(data.turnIndex)) {
							turnToTreeHash.set(data.turnIndex, data.snapshotTreeHash);
						}
					}
				}
			}
		}

		// Build diff data for pending files.
		// oldContent: for approved files → approved snapshot; for unapproved files with history → first snapshot;
		//   for genuinely new files → null (sessionStartTreeHash)
		// newContent: always from disk (live)
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

			// Get oldContent from the correct baseline
			try {
				const fileRequests = [...pathMeta.entries()].map(([path, meta]) => {
					const approvedEntry = approvedSnapshotEntry.get(path);
					if (approvedEntry) {
						const approved = approvals.get(approvalKey(path));
						const approvedHash = approved?.snapshotTreeHash ?? snapshotEntryToTreeHash.get(approvedEntry);
						return { filePath: path, fromEntryId: approvedEntry, fromHash: approvedHash };
					}
					// If the file was added in this session (never existed before), oldContent is null.
					// If the file was modified, we need the baseline from BEFORE the latest modification.
					// Use the snapshot from the turn BEFORE latestTurnIndex to get pre-modification content.
					if (meta.firstStatus === "added" && meta.latestFileStatus === "added") {
						return { filePath: path, fromEntryId: undefined as string | undefined, fromHash: undefined as string | undefined };
					}
					// For modified files: use previous turn's snapshot as baseline.
					// turnToTreeHash[N] = snapshot taken AFTER turn N (includes turn N's changes).
					// To get content BEFORE turn latestTurnIndex's modification, use turn (latestTurnIndex - 1).
					const baselineTurn = meta.latestTurnIndex > 0 ? meta.latestTurnIndex - 1 : -1;
					const baselineHash = baselineTurn >= 0 ? turnToTreeHash.get(baselineTurn) : undefined;
					return {
						filePath: path,
						fromEntryId: undefined as string | undefined,
						fromHash: baselineHash as string | undefined,
					};
				});
				const batchResult = mgr.getBatchFileContents(fileRequests, ctx.cwd);
				for (const [path, content] of batchResult) {
					diffMap.set(path, content);
				}
			} catch (error) {
				console.error("[file-review] getBatchFileContents failed:", error);
			}

			// Merge: prefer liveDiff (getLiveChanges compares against lastCommittedTreeHash,
			// giving the most accurate "what changed since last committed turn" diff).
			// batchDiff provides baseline data from snapshots for files without live changes.
			for (const [path, meta] of pathMeta) {
				const batchDiff = diffMap.get(path);
				const liveDiff = liveMap.get(path);

				if (approvedSnapshotEntry.has(path) && batchDiff) {
					// For previously approved files, the review baseline is the approved snapshot,
					// not the last committed tree. This keeps review.pending aligned with the
					// approval workflow even after external rollbacks like `git checkout`.
					diffMap.set(path, batchDiff);
				} else if (liveDiff) {
					// File has live (uncommitted) changes on disk.
					// If liveDiff.oldContent is null but file is 'modified', fall back to snapshots.
					let oldContent = liveDiff.oldContent;
					if (oldContent === null && meta.latestFileStatus === 'modified') {
						for (let t = meta.latestTurnIndex - 1; t >= 0; t--) {
							const hash = turnToTreeHash.get(t);
							if (!hash) continue;
							try {
								const prevContent = mgr.readTreeFileContent(hash, path);
								if (prevContent !== undefined && prevContent !== null) {
									oldContent = prevContent;
									break;
								}
							} catch {}
						}
					}
					diffMap.set(path, {
						oldContent,
						newContent: liveDiff.newContent,
					});
				} else if (meta.latestFileStatus === "deleted") {
					let oldContent = batchDiff?.oldContent ?? null;
					if (oldContent === null) {
						try {
							const diff = mgr.getFileDiff({ filePath: path });
							if (diff) oldContent = diff.oldContent;
						} catch {}
					}
					diffMap.set(path, { oldContent, newContent: null });
				} else if (batchDiff) {
					// No live change — file is committed.
					// If oldContent is null but fileStatus is "modified", the file existed before
					// but sessionStartTreeHash doesn't have it (session started from empty dir).
					// Fall back to searching the previous turn's snapshot for the pre-modification content.
					let oldContent = batchDiff.oldContent;
					if (oldContent === null && meta.latestFileStatus === "modified") {
						// Try each previous turn's snapshot to find where the file existed
						for (let t = meta.latestTurnIndex - 1; t >= 0; t--) {
							const hash = turnToTreeHash.get(t);
							if (!hash) continue;
							try {
								const prevContent = mgr.readTreeFileContent(hash, path);
								if (prevContent !== undefined && prevContent !== null) {
									oldContent = prevContent;
									break;
								}
							} catch {}
						}
					}
					diffMap.set(path, { oldContent, newContent: batchDiff.newContent });
				} else {
					// Neither liveDiff nor batchDiff — file is committed but no baseline data.
					// Build diff from previous turn snapshot + current disk content.
					let oldContent = null;
					if (meta.latestFileStatus === "modified") {
						for (let t = meta.latestTurnIndex - 1; t >= 0; t--) {
							const hash = turnToTreeHash.get(t);
							if (!hash) continue;
							try {
								const prevContent = mgr.readTreeFileContent(hash, path);
								if (prevContent !== undefined && prevContent !== null) {
									oldContent = prevContent;
									break;
								}
							} catch {}
						}
					}
					let newContent = null;
					try {
						const diff = mgr.getFileDiff({ filePath: path });
						if (diff) newContent = diff.newContent;
					} catch {}
					diffMap.set(path, { oldContent, newContent });
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

			// Skip phantom entries: file is in turnLog but doesn't exist on disk
			// AND has no content in any snapshot (both null = no data to show)
			if (oldContent === null && newContent === null) {
				continue;
			}

			// Skip effective no-ops. This happens when a file changed after approval and was
			// then restored back to the approved snapshot out-of-band (for example via git checkout).
			if (oldContent === newContent) {
				continue;
			}

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
		const snapshotEntryId = ensureCurrentSnapshotEntryId();
		if (!snapshotEntryId) return { ok: false, error: "No snapshot available for approval" };
		setApproval(params.path, "approved", snapshotEntryId, getSnapshotTreeHash(snapshotEntryId));
		return { ok: true, snapshotEntryId };
	});

	channel?.handle("review.reject", (params) => {
		// Roll back the file to its pre-modification state
		if (!ctx) return { ok: false, error: "No session context" };
		const mgr = ctx.fileSnapshotManager;
		if (!mgr) return { ok: false, error: "No file snapshot manager" };

		// Get the diff data for this file
		let diffInfo: { oldContent: string | null; newContent: string | null } | null = null;
		try {
			// For approved files, use the approved snapshot as baseline.
			// For unapproved files, use sessionStartTreeHash (getFileDiff default).
			const fromEntryId = approvedSnapshotEntry.get(params.path);

			if (fromEntryId) {
				const content = mgr.getBatchFileContents(
					[{ filePath: params.path, fromEntryId, fromHash: getSnapshotTreeHash(fromEntryId) }],
					ctx.cwd,
				).get(params.path);
				if (content) diffInfo = content;
			} else {
				const diff = mgr.getFileDiff({ filePath: params.path });
				if (diff) diffInfo = { oldContent: diff.oldContent, newContent: diff.newContent };
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
			// Re-commit snapshot so lastCommittedTreeHash reflects the rolled-back disk state.
			// Without this, subsequent getLiveChanges() would detect the rollback as a "new change".
			try {
				mgr.onTurnEnd(ctx.cwd, -1, (type, data) => { pi.appendEntry(type, data); return ""; });
			} catch {}
		}

		setApproval(params.path, "rejected");
		return { ok: true, rolledBack };
	});

	channel?.handle("review.approveAll", () => {
		let count = 0;
		const snapshotEntryId = ensureCurrentSnapshotEntryId();
		if (!snapshotEntryId) return { count };
		const snapshotTreeHash = getSnapshotTreeHash(snapshotEntryId);
		// Approve ALL files that are currently pending, not just those in turnLog.
		// This matches what review.pending returns.
		for (const [, approval] of approvals) {
			if (approval.status === "pending") {
				setApproval(approval.path, "approved", snapshotEntryId, snapshotTreeHash);
				count++;
			}
		}
		// Also check turnLog for files not yet in approvals map
		const latestByPath = new Map<string, { turnIndex: number; timestamp: number }>();
		for (const record of turnLog) {
			for (const change of record.changes) {
				latestByPath.set(change.path, { turnIndex: record.turnIndex, timestamp: record.timestamp });
			}
		}
		for (const [path] of latestByPath) {
			const approval = getApproval(path);
			if (approval.status === "pending") {
				setApproval(path, "approved", snapshotEntryId, snapshotTreeHash);
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
						if (approvedEntryId) {
							const content = mgr.getBatchFileContents(
								[{ filePath: path, fromEntryId: approvedEntryId, fromHash: getSnapshotTreeHash(approvedEntryId) }],
								ctx.cwd,
							).get(path);
							if (content) diffInfo = content;
						} else {
							const diff = mgr.getFileDiff({ filePath: path });
							if (diff) diffInfo = { oldContent: diff.oldContent, newContent: diff.newContent };
						}
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
		for (const entry of entries) {
			if (entry.type !== "custom") continue;

			if (entry.customType === "file-approval") {
				const data = entry.data as
					| {
							path: string;
							status: "approved" | "rejected";
							timestamp: number;
							snapshotEntryId?: string;
							snapshotTreeHash?: string;
					  }
					| undefined;
				if (!data) continue;
				const key = approvalKey(data.path);
				approvals.set(key, {
					turnIndex: -1,
					path: data.path,
					status: data.status,
					timestamp: data.timestamp,
					snapshotEntryId: data.snapshotEntryId,
					snapshotTreeHash: data.snapshotTreeHash,
				});
				if (data.status === "approved") {
					everApproved.add(data.path);
					if (data.snapshotEntryId) {
						approvedSnapshotEntry.set(data.path, data.snapshotEntryId);
					}
				}
			} else if (entry.customType === "file-review-turn") {
				const data = entry.data as { turnIndex: number; timestamp: number; changes: Array<{ path: string; status: string }> } | undefined;
				if (!data) continue;
				if (turnLog.length >= MAX_TURNS_RETAINED) turnLog.shift();
				const changes = data.changes.map((c) => ({
					path: c.path,
					status: c.status as LiveChange["status"],
					diff: null,
				}));
				turnLog.push({
					turnIndex: data.turnIndex,
					timestamp: data.timestamp,
					changes,
				});
				for (const change of changes) {
					const existing = approvals.get(approvalKey(change.path));
					if (
						existing &&
						(existing.status === "approved" || existing.status === "rejected") &&
						!!existing.snapshotEntryId &&
						data.timestamp >= existing.timestamp
					) {
						existing.status = "pending";
						existing.timestamp = data.timestamp;
					}
				}
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
