import type { ChannelContract } from "@dyyz1993/pi-coding-agent";
import type { HookLogEntry, HookLogResult } from "./hooks-log.js";

export const HOOKS_CHANNEL_NAME = "hooks";

export interface HooksChannelContract extends ChannelContract {
	methods: {
		"hooks.getLog": {
			params: { limit?: number; event?: string };
			return: HookLogResult;
		};
		"hooks.getConfig": {
			params: Record<string, never>;
			return: HookLogResult;
		};
		"hooks.clear": {
			params: Record<string, never>;
			return: { ok: boolean };
		};
	};
	events: {
		hook_executed: HookLogEntry;
		hook_blocked: HookLogEntry;
	};
}
