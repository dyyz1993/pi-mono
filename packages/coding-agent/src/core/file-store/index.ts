export type {
	BatchDiffResult,
	FileDiffInfo,
	FileHistoryEntry,
	ModifiedFileInfo,
	RestoreResult,
	StepSnapshotData,
} from "./file-snapshot-manager.ts";
export { FileSnapshotManager } from "./file-snapshot-manager.ts";
export type { StepDiff, TreeEntry, TreeSnapshot } from "./internal-git.ts";
export { computeProjectHash, InternalGit } from "./internal-git.ts";
