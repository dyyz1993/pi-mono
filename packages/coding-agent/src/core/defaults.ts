import type { ThinkingLevel } from "@dyyz1993/pi-agent-core";

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

export const DEFAULT_TIER_ALIASES: Record<string, string> = {
	fast: "openai-codex/gpt-5.5-codex-mini",
	pro: "openai-codex/gpt-5.5",
	max: "anthropic/claude-opus-4-8",
};
