/**
 * L1 Snip Compact
 *
 * Trims the middle of overly long conversations by keeping the head (initial
 * context / system messages) and tail (recent work), replacing everything in
 * between with a short placeholder. Operates as a `context` hook, similar to
 * microcompact.
 *
 * Boundary protection ensures an assistant message with tool_calls is never
 * separated from its immediately following toolResult messages.
 */
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@dyyz1993/pi-ai";

export interface SnipCompactConfig {
	enabled: boolean;
	/** Maximum number of messages before snipping kicks in (default: 50) */
	maxMessages: number;
	/** Number of leading messages to always keep (default: 3) */
	keepHeadCount: number;
	/** Minimum interval between snip operations in ms (default: 600_000 = 10 min).
	 *  Prevents cache-busting mid-conversation; runs only when the cache is likely cold. */
	minIntervalMs: number;
}

export const DEFAULT_SNIP_COMPACT_CONFIG: SnipCompactConfig = {
	enabled: true,
	maxMessages: 50,
	keepHeadCount: 3,
	minIntervalMs: 10 * 60 * 1000,
};

/**
 * Scan forward from an assistant message that has tool_calls to find the
 * index *after* the last consecutive toolResult message belonging to that
 * group.
 */
export function findAssistantToolCallGroupEnd(
	messages: AgentMessage[],
	startIndex: number,
): number {
	let i = startIndex + 1;
	while (i < messages.length && messages[i].role === "toolResult") {
		i++;
	}
	return i;
}

/**
 * Adjust the proposed tail-start index so that it does not split an
 * assistant+toolResults group. If the message at `tailStart` is a
 * toolResult, walk backward to find the originating assistant message and
 * include the full group.
 */
export function adjustTailBoundary(
	messages: AgentMessage[],
	tailStart: number,
): number {
	if (tailStart >= messages.length) return tailStart;
	if (tailStart <= 0) return tailStart;

	// If the message at tailStart is NOT a toolResult, no adjustment needed.
	if (messages[tailStart].role !== "toolResult") return tailStart;

	// Walk backward to find the assistant that initiated this toolResult group.
	let i = tailStart;
	while (i > 0 && messages[i].role === "toolResult") {
		i--;
	}

	// If we landed on an assistant with tool_calls, expand tail to include it.
	if (i >= 0 && messages[i].role === "assistant" && hasToolCalls(messages[i])) {
		return i;
	}

	// Otherwise return the original boundary (shouldn't normally happen).
	return tailStart;
}

/**
 * Core snip_compact function.
 *
 * Returns `{ messages }` with the middle replaced by a placeholder, or
 * `undefined` if the conversation is short enough that no snipping is needed.
 */
export function snipCompact(
	messages: AgentMessage[],
	config: SnipCompactConfig,
): { messages: AgentMessage[] } | undefined {
	if (!config.enabled) return undefined;
	if (messages.length <= config.maxMessages) return undefined;

	const keepHeadCount = Math.min(config.keepHeadCount, messages.length);
	const keepTailCount = Math.max(0, config.maxMessages - keepHeadCount);

	if (keepTailCount <= 0) return undefined;

	let tailStart = messages.length - keepTailCount;

	// Boundary protection: don't split assistant+toolResults groups.
	tailStart = adjustTailBoundary(messages, tailStart);

	// Also ensure we don't overlap with the head.
	if (tailStart <= keepHeadCount) return undefined;

	const snippedCount = tailStart - keepHeadCount;

	const head = messages.slice(0, keepHeadCount);
	const tail = messages.slice(tailStart);

	// Use the timestamp of the first snipped message to stay deterministic
	// (same input → same output, preserving cache prefix matching)
	const snippedTimestamp = messages[keepHeadCount] && "timestamp" in messages[keepHeadCount]!
		? (messages[keepHeadCount] as { timestamp: number }).timestamp
		: 0;

	const placeholder: AgentMessage = {
		role: "user",
		content: [{ type: "text" as const, text: `[snipped ${snippedCount} messages]` }],
		timestamp: snippedTimestamp,
	};

	return {
		messages: [...head, placeholder, ...tail],
	};
}

function hasToolCalls(msg: AgentMessage): boolean {
	if (msg.role !== "assistant") return false;
	const content = (msg as AssistantMessage).content;
	if (!Array.isArray(content)) return false;
	return content.some((block) => block.type === "toolCall");
}
