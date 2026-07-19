import type { ChannelContract } from "@dyyz1993/pi-coding-agent";

export const LEARNING_CHANNEL_NAME = "learning";

export type LearningMode = "off" | "pending" | "auto";
export type LearningCuratorMode = "dry-run" | "pending" | "auto";
export type LearningDomain = "memory" | "skill";
export type LearningCandidateStatus = "pending" | "approved" | "rejected";
export type LearningCandidateAction =
	| "create-memory"
	| "create-skill"
	| "merge-skill"
	| "archive-skill";
export type LearningFileKind =
	| "memory"
	| "memory-index"
	| "skill"
	| "skill-entrypoint"
	| "skill-reference"
	| "skill-script"
	| "skill-template"
	| "skill-asset"
	| "run"
	| "candidate";

export interface LearningFileRef {
	path: string;
	label: string;
	kind: LearningFileKind;
	exists: boolean;
	size?: number;
	mtimeMs?: number;
}

export interface LearningCuratorSchedule {
	enabled: boolean;
	intervalMinutes: number;
}

export interface LearningConfig {
	version: 1;
	enabled: boolean;
	memory: {
		recallEnabled: boolean;
		extractMode: LearningMode;
		curatorMode: LearningCuratorMode;
		curatorSchedule: LearningCuratorSchedule;
	};
	skills: {
		distillMode: LearningMode;
		curatorMode: LearningCuratorMode;
		curatorSchedule: LearningCuratorSchedule;
	};
}

export interface LearningCandidate {
	version: 1;
	id: string;
	domain: LearningDomain;
	action: LearningCandidateAction;
	status: LearningCandidateStatus;
	title: string;
	summary: string;
	confidence: "low" | "medium" | "high";
	sourceSessionId?: string;
	sourceMessageIds?: string[];
	createdAt: number;
	decidedAt?: number;
	decision?: "approved" | "rejected";
	targetId?: string;
	targetPath?: string;
	payload: LearningCandidatePayload;
	fileRefs: LearningFileRef[];
}

export type LearningCandidatePayload =
	| LearningMemoryCandidatePayload
	| LearningSkillCandidatePayload
	| LearningCuratorCandidatePayload;

export interface LearningMemoryCandidatePayload {
	type: "memory";
	filename: string;
	description: string;
	memoryType: "user" | "feedback" | "project" | "reference" | "bookmark";
	content: string;
}

export interface LearningSkillCandidatePayload {
	type: "skill";
	name: string;
	description: string;
	body: string;
	targetSkillName?: string;
	files?: Array<{ relativePath: string; content: string }>;
	pinned?: boolean;
}

export interface LearningCuratorCandidatePayload {
	type: "curator";
	domain: "memory" | "skill";
	report: string;
	actions: Array<{
		action: LearningCandidateAction;
		targetId?: string;
		targetPath?: string;
		summary: string;
		fileRefs?: LearningFileRef[];
	}>;
}

export interface LearningMemorySummary {
	filename: string;
	filePath: string;
	description: string | null;
	type: string | null;
	mtimeMs: number;
	size: number;
	state: "active" | "archived";
}

export interface LearningSkillSummary {
	name: string;
	description: string;
	scope: "project-private" | "project-shared" | "global";
	source: "generated" | "user" | "project" | "package";
	state: "active" | "disabled" | "archived";
	usageCount: number;
	lastUsedAt: number | null;
	patchCount: number;
	filePath: string;
	baseDir: string;
	pinned: boolean;
	files: LearningFileRef[];
}

export interface LearningRun {
	version: 1;
	id: string;
	domain: LearningDomain;
	type: "memory-extract" | "skill-distill" | "memory-curator" | "skill-curator" | "candidate-decision";
	mode: LearningMode | LearningCuratorMode | "manual";
	status: "started" | "completed" | "failed";
	startedAt: number;
	completedAt?: number;
	summary: string;
	actions: Array<{
		action: LearningCandidateAction | "none";
		targetId?: string;
		targetPath?: string;
		summary: string;
		fileRefs?: LearningFileRef[];
	}>;
	error?: string;
}

export interface LearningOverview {
	memoryFiles: number;
	activeSkills: number;
	disabledSkills: number;
	archivedSkills: number;
	pendingCandidates: number;
	warnings: number;
	lastRunAt: number | null;
}

export interface LearningSnapshot {
	version: 1;
	projectRoot: string;
	dirs: {
		learningDir: string;
		memoryDir: string;
		skillsDir: string;
	};
	config: LearningConfig;
	overview: LearningOverview;
	memory: {
		files: LearningMemorySummary[];
		entrypoint: LearningFileRef | null;
		diagnostics: string[];
	};
	skills: {
		items: LearningSkillSummary[];
		diagnostics: string[];
	};
	candidates: LearningCandidate[];
	runs: LearningRun[];
}

export interface LearningGetSnapshotParams {
	projectPath?: string;
}

export interface LearningSetConfigParams {
	config: Partial<LearningConfig>;
}

export interface LearningCandidateDecisionParams {
	candidateId: string;
	mergeTargetSkillName?: string;
}

export interface LearningRunCuratorParams {
	domain: "memory" | "skill";
	mode?: LearningCuratorMode;
}

export interface MemoryFileInfo {
	filename: string;
	filePath: string;
	description: string | null;
	type: string | null;
	mtimeMs: number;
}

export interface MemoryListResult {
	type: "list_result";
	files: MemoryFileInfo[];
	entrypointContent: string | null;
	memoryDir: string;
}

export interface MemoryUserRememberParams {
	sourceSessionId?: string;
	sourceMessageIds?: string[];
	content?: string;
}

export interface MemoryMarkIrrelevantParams {
	query: string;
	selectedFiles: string[];
}

export interface MemoryIrrelevantMarkedEvent {
	type: "memory_irrelevant_marked";
	query: string;
	selectedFiles: string[];
}

export interface BookmarkCreatingEvent {
	type: "bookmark_creating";
}

export interface MemoryUpdatedEvent {
	type: "memory_updated";
	files: MemoryFileInfo[];
}

export interface MemoryUpdateFailedEvent {
	type: "memory_update_failed";
	reason: string;
}

export interface PrefetchHistoryEntry {
	query: string;
	selected: string[];
	skipped: boolean;
	skip_hits: string[];
	guard_hits: string[];
	timestamp: number;
}

export interface MemoryStatusResult {
	skipRules: {
		builtin: Array<{ pattern: string; mode: string }>;
		custom: Array<{ pattern: string; mode: string }>;
	};
	guardRules: {
		builtin: Array<{ pattern: string; mode: string }>;
		custom: Array<{ pattern: string; mode: string }>;
	};
	excludeKeywords: string[];
	recentQueries: PrefetchHistoryEntry[];
	dream: {
		lastRunAt: number | null;
	};
}

export interface MemoryRemoveRuleParams {
	rule?: { pattern: string; mode: string };
	excludeKeyword?: string;
}

export interface MemoryAddRuleParams {
	pattern: string;
	mode: "exact" | "prefix" | "contains" | "regex";
	action: "skip" | "guard";
}

export interface LearningChannelContract extends ChannelContract {
	methods: {
		"learning.getSnapshot": {
			params: LearningGetSnapshotParams;
			return: LearningSnapshot;
		};
		"learning.setConfig": {
			params: LearningSetConfigParams;
			return: LearningSnapshot;
		};
		"learning.listCandidates": {
			params: Record<string, never>;
			return: { candidates: LearningCandidate[] };
		};
		"learning.approveCandidate": {
			params: LearningCandidateDecisionParams;
			return: LearningSnapshot;
		};
		"learning.rejectCandidate": {
			params: LearningCandidateDecisionParams;
			return: LearningSnapshot;
		};
		"learning.runCurator": {
			params: LearningRunCuratorParams;
			return: LearningRun;
		};
		"learning.memory.list": {
			params: Record<string, never>;
			return: MemoryListResult;
		};
		"learning.memory.userRemember": {
			params: MemoryUserRememberParams;
			return: { ok: boolean };
		};
		"learning.memory.markIrrelevant": {
			params: MemoryMarkIrrelevantParams;
			return: { ok: boolean };
		};
		"learning.memory.getStatus": {
			params: Record<string, never>;
			return: MemoryStatusResult;
		};
		"learning.memory.removeRule": {
			params: MemoryRemoveRuleParams;
			return: { ok: boolean };
		};
		"learning.memory.addRule": {
			params: MemoryAddRuleParams;
			return: { ok: boolean };
		};
	};
	events: {
		"learning.snapshot": LearningSnapshot;
		"learning.run": LearningRun;
		"learning.candidate": LearningCandidate;
		bookmark_creating: BookmarkCreatingEvent;
		memory_updated: MemoryUpdatedEvent;
		memory_update_failed: MemoryUpdateFailedEvent;
		memory_irrelevant_marked: MemoryIrrelevantMarkedEvent;
	};
}
