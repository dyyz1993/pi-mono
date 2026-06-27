import type { LearningCuratorMode, LearningRun } from "./contract.ts";
import { LearningStore } from "./store.ts";

export function runSkillCurator(store: LearningStore, mode: LearningCuratorMode): Promise<LearningRun> {
	return store.runCurator({ domain: "skill", mode });
}

