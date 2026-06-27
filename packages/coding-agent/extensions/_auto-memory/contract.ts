import type { ChannelContract } from "@dyyz1993/pi-coding-agent";

export const MEMORY_CHANNEL_NAME = "memory";

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

export interface MemoryChannelContract extends ChannelContract {
	methods: {
		"memory.list": {
			params: Record<string, never>;
			return: MemoryListResult;
		};
		"memory.userRemember": {
			params: MemoryUserRememberParams;
			return: { ok: boolean };
		};
		"memory.markIrrelevant": {
			params: MemoryMarkIrrelevantParams;
			return: { ok: boolean };
		};
		"memory.getStatus": {
			params: Record<string, never>;
			return: MemoryStatusResult;
		};
		"memory.removeRule": {
			params: MemoryRemoveRuleParams;
			return: { ok: boolean };
		};
		"memory.addRule": {
			params: MemoryAddRuleParams;
			return: { ok: boolean };
		};
	};
	events: {
		bookmark_creating: BookmarkCreatingEvent;
		memory_updated: MemoryUpdatedEvent;
		memory_update_failed: MemoryUpdateFailedEvent;
		memory_irrelevant_marked: MemoryIrrelevantMarkedEvent;
	};
}
