export type {
	FileDiffInfo,
	ModifiedFileInfo,
	RestoreResult,
	StepSnapshotData,
} from "./file-snapshot-manager.js";
export { FileSnapshotManager } from "./file-snapshot-manager.js";
export type { StepDiff, TreeEntry, TreeSnapshot } from "./internal-git.js";
export { computeProjectHash, InternalGit } from "./internal-git.js";
