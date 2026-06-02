export type {
	BatchDiffResult,
	FileDiffInfo,
	FileHistoryEntry,
	ModifiedFileInfo,
	RestoreResult,
	StepSnapshotData,
} from "./file-snapshot-manager.ts";
export { FileSnapshotManager } from "./file-snapshot-manager.ts";
export type { GCResult, ObjectMetadata, StepDiff, TreeEntry, TreeSnapshot } from "./internal-git.ts";
export { computeProjectHash, InternalGit } from "./internal-git.ts";
