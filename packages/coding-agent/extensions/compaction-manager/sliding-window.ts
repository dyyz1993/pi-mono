/**
 * Sliding Window Strategy
 *
 * The lightest compaction approach: simply truncate messages that fall
 * outside a fixed token window. No LLM summarization is performed.
 * Messages beyond the window are replaced with a minimal placeholder.
 *
 * This is implemented via the `context` hook (like microcompact) rather
 * than `session_before_compact`, because it doesn't generate a summary
 * and doesn't need to create a CompactionEntry.
 */
import type { AgentMessage } from "@dyyz1993/pi-agent-core";

export interface SlidingWindowConfig {
	enabled: boolean;
	/** Maximum tokens to keep in context (default: 80000) */
	windowTokens: number;
	/** Whether to keep a brief note about truncated messages (default: true) */
	truncationNotice: boolean;
}

/**
 * Truncate messages to fit within a sliding window.
 * Walks from newest to oldest, accumulating tokens until the window is full.
 * Older messages beyond the window are either removed or replaced with a
 * single placeholder.
 */
export function applySlidingWindow(
	messages: AgentMessage[],
	config: SlidingWindowConfig,
): { messages: AgentMessage[] } | undefined {
	if (messages.length === 0) return undefined;

	const windowTokens = config.windowTokens;
	let accumulatedTokens = 0;
	let cutIndex = messages.length; // default: keep all

	// Walk from newest to oldest
	for (let i = messages.length - 1; i >= 0; i--) {
		const msgTokens = estimateMessageTokens(messages[i]);
		accumulatedTokens += msgTokens;

		if (accumulatedTokens > windowTokens) {
			cutIndex = i + 1; // keep from this index onward
			break;
		}
	}

	// All messages fit within the window
	if (cutIndex <= 0) {
		// Even the oldest message alone exceeds the window
		// Keep at least the last message
		cutIndex = Math.max(1, messages.length - 1);
	}

	if (cutIndex >= messages.length) {
		// Everything fits, no truncation needed
		return undefined;
	}

	// System message (role=user with no prior context) should always be kept
	// Find if there's a system-like first message
	const firstMessage = messages[0];
	const hasSystemMessage =
		firstMessage?.role === "user" &&
		cutIndex > 0;

	const result: AgentMessage[] = [];

	// Keep system message if it would be truncated
	if (hasSystemMessage && cutIndex > 0) {
		result.push(firstMessage);
	}

	// Add truncation notice
	if (config.truncationNotice && cutIndex > 0) {
		result.push({
			role: "user",
			content: [
				{
					type: "text",
					text: `[Sliding window: ${cutIndex} older message(s) truncated to fit within ${windowTokens} token window]`,
				},
			],
			timestamp: Date.now(),
		} as AgentMessage);
	}

	// Add the messages within the window
	result.push(...messages.slice(cutIndex));

	return { messages: result };
}

export function estimateMessageTokens(msg: AgentMessage): number {
	const content = (msg as { content?: unknown }).content;
	if (typeof content === "string") return Math.ceil(content.length / 4);
	if (Array.isArray(content)) {
		let total = 0;
		for (const block of content) {
			if (
				typeof block === "object" &&
				block !== null &&
				"type" in block
			) {
				const b = block as { type: string; text?: string; thinking?: string };
				if (b.type === "text" && typeof b.text === "string") {
					total += Math.ceil(b.text.length / 4);
				} else if (b.type === "thinking" && typeof b.thinking === "string") {
					total += Math.ceil(b.thinking.length / 4);
				} else {
					total += 50;
				}
			}
		}
		return total;
	}
	return 50;
}
