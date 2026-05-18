import type { ChannelContract } from "@dyyz1993/pi-coding-agent";
import type { GCResult } from "../../src/core/file-store/internal-git.js";
import type { ModifiedFileInfo } from "../../src/core/file-store/file-snapshot-manager.js";

export const FILE_SNAPSHOT_CHANNEL_NAME = "file-snapshot";

export interface SnapshotInfo {
	id: string;
	stepIndex: number;
	treeHash: string;
	diff: { added: string[]; modified: string[]; deleted: string[] };
	files: Record<string, "added" | "modified" | "deleted">;
	rolledBack: boolean;
}

export interface RollbackResult {
	ok: boolean;
	restoredFiles: string[];
	error?: string;
}

export interface RestoreByHashResult {
	restored: string[];
}

export interface StoreStats {
	totalObjects: number;
	totalBytes: number;
	treeObjects: number;
	fileObjects: number;
}

export interface FileSnapshotChannelContract extends ChannelContract {
	methods: {
		"snapshot.list": {
			params: Record<string, never>;
			return: ModifiedFileInfo[];
		};
		"snapshot.rollback": {
			params: { sessionId: string; snapshotId: string; files?: string[] };
			return: RollbackResult;
		};
		"snapshot.unrevert": {
			params: { sessionId: string; snapshotId: string };
			return: RollbackResult;
		};
		"snapshot.get": {
			params: { sessionId: string; snapshotId: string };
			return: SnapshotInfo | null;
		};
		"snapshot.restoreByHash": {
			params: { snapshotTreeHash: string; files?: string[] };
			return: RestoreByHashResult;
		};
		"snapshot.gc": {
			params: Record<string, never>;
			return: GCResult;
		};
		"snapshot.prune": {
			params: { maxAgeMs?: number };
			return: GCResult;
		};
		"snapshot.stats": {
			params: Record<string, never>;
			return: StoreStats;
		};
		"snapshot.enforceLimit": {
			params: { maxBytes?: number };
			return: GCResult;
		};
	};
}
