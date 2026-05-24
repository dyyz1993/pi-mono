import type { ChannelContract } from "@dyyz1993/pi-coding-agent";
import type { LiveChange } from "../../src/core/file-store/file-snapshot-manager.js";

export const FILE_REVIEW_CHANNEL_NAME = "file-review";

export interface TurnChangeRecord {
	turnIndex: number;
	timestamp: number;
	changes: LiveChange[];
}

export interface TurnSummaryItem {
	turnIndex: number;
	timestamp: number;
	added: number;
	modified: number;
	deleted: number;
	files: string[];
}

export interface FileHistoryEntry {
	turnIndex: number;
	status: string;
	diff: LiveChange["diff"];
}

export interface LiveChangesResult {
	turnIndex: number;
	changes: LiveChange[];
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface FileApproval {
	turnIndex: number;
	path: string;
	status: ApprovalStatus;
	timestamp: number;
}

export interface PendingChange {
	turnIndex: number;
	path: string;
	fileStatus: LiveChange["status"];
	status: ApprovalStatus;
	timestamp: number;
	/** For added: null. For modified: original content. For deleted: original content. */
	oldContent: string | null;
	/** For added: current content. For modified: current content. For deleted: null. */
	newContent: string | null;
}

export interface FileReviewChannelContract extends ChannelContract {
	methods: {
		"review.live": {
			params: Record<string, never>;
			return: LiveChangesResult;
		};
		"review.history": {
			params: { fromTurn?: number; pathFilter?: string };
			return: TurnChangeRecord[];
		};
		"review.summary": {
			params: Record<string, never>;
			return: TurnSummaryItem[];
		};
		"review.fileHistory": {
			params: { path: string };
			return: FileHistoryEntry[];
		};
		"review.clear": {
			params: Record<string, never>;
			return: { ok: boolean };
		};
		"review.pending": {
			params: Record<string, never>;
			return: PendingChange[];
		};
		"review.approve": {
			params: { path: string };
			return: { ok: boolean };
		};
		"review.reject": {
			params: { path: string };
			return: { ok: boolean; rolledBack?: boolean; error?: string };
		};
		"review.approveAll": {
			params: Record<string, never>;
			return: { count: number };
		};
		"review.rejectAll": {
			params: Record<string, never>;
			return: { count: number; rolledBack: number };
		};
		"review.approvals": {
			params: { status?: ApprovalStatus };
			return: FileApproval[];
		};
	};
}
