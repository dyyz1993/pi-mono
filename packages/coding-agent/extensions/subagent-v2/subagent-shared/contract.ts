import type { ChannelContract } from "@dyyz1993/pi-coding-agent";

export const SUBAGENT_CHANNEL_NAME = "subagent";

export interface SubagentEventPayload {
	event: unknown;
	sessionId: string;
	taskId?: string;
	[key: string]: unknown;
}

export interface SubagentStartPayload {
	event: {
		type: "subagent_start";
		toolCallId: string;
		description: string;
		instruction: string;
	};
	sessionId: string;
}

export interface SubagentChannelContract extends ChannelContract {
	methods?: Record<string, never>;
	events: {
		event: SubagentEventPayload;
		subagent_start: SubagentStartPayload;
	};
}
