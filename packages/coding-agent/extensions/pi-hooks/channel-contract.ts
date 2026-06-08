import type { ChannelContract } from "@dyyz1993/pi-coding-agent";
import type { HookLogEntry, HookLogResult } from "./hooks-log.ts";

export const HOOKS_CHANNEL_NAME = "hooks";

export interface SkippedRuleKey {
	event: string;
	matcher: string;
}

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
		"hooks.getStatus": {
			params: Record<string, never>;
			return: { enabled: boolean };
		};
		"hooks.setEnabled": {
			params: { enabled: boolean };
			return: { enabled: boolean };
		};
		"hooks.skipRule": {
			params: { event: string; matcher: string };
			return: { skipped: SkippedRuleKey[] };
		};
		"hooks.unskipRule": {
			params: { event: string; matcher: string };
			return: { skipped: SkippedRuleKey[] };
		};
		"hooks.getSkippedRules": {
			params: Record<string, never>;
			return: { skipped: SkippedRuleKey[] };
		};
	};
	events: {
		hook_executed: HookLogEntry;
		hook_blocked: HookLogEntry;
	};
}
