import { getModel } from "@mariozechner/pi-ai";
import type { SlackContext } from "./slack.js";
import type { ChannelStore } from "./store.js";

// Hardcoded model for now - TODO: make configurable (issue #63)
const _model = getModel("anthropic", "claude-sonnet-4-5");

export interface PendingMessage {
	userName: string;
	text: string;
	attachments: { local: string }[];
	timestamp: number;
}

export interface AgentRunner {
	run(
		ctx: SlackContext,
		store: ChannelStore,
		pendingMessages?: PendingMessage[],
	): Promise<{ stopReason: string; errorMessage?: string }>;
	abort(): void;
}
