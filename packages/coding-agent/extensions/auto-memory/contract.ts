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
	};
	events: {
		bookmark_creating: BookmarkCreatingEvent;
		memory_updated: MemoryUpdatedEvent;
		memory_update_failed: MemoryUpdateFailedEvent;
	};
}
