import type { ThinkingLevel } from "@dyyz1993/pi-agent-core";

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

export const DEFAULT_TIER_ALIASES: Record<string, string> = {
	fast: "anthropic/claude-haiku-4",
	pro: "anthropic/claude-sonnet-4-20250514",
	max: "anthropic/claude-opus-4-6",
};
