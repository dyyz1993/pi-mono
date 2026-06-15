import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, TextContent, ToolResultMessage } from "@dyyz1993/pi-ai";

/**
 * Deterministic microcompact: clear clearable tool results that are more than
 * `keepRecentCount` messages from the end of the conversation.
 *
 * Unlike time-based approaches, this is fully deterministic — same input always
 * produces the same output, preserving Anthropic prompt cache prefix matching.
 *
 * @param messages - Full message array
 * @param clearableTools - Tool names whose results can be cleared
 * @param keepRecentCount - How many clearable tool results (from the end) to keep intact
 */
export function microcompactMessages(
	messages: AgentMessage[],
	clearableTools: string[],
	keepRecentCount: number,
): { messages: AgentMessage[] } | undefined {
	// Collect indices of clearable tool results with substantial content
	const clearableIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role !== "toolResult") continue;
		const toolMsg = msg as ToolResultMessage;
		if (!clearableTools.includes(toolMsg.toolName)) continue;
		if (toolMsg.isError) continue;
		// Skip results that are already compacted (very short text)
		const textLen = getTextContentLength(toolMsg.content);
		if (textLen <= CLEAR_PLACEHOLDER.length + 50) continue;
		clearableIndices.push(i);
	}

	// Keep the last keepRecentCount clearable results, compact the rest
	if (clearableIndices.length <= keepRecentCount) return undefined;

	const toCompact = new Set(clearableIndices.slice(0, clearableIndices.length - keepRecentCount));
	if (toCompact.size === 0) return undefined;

	let modified = false;
	const cleaned = messages.map((msg, i) => {
		if (!toCompact.has(i)) return msg;
		modified = true;
		const toolMsg = msg as ToolResultMessage;
		return {
			...toolMsg,
			content: [{ type: "text" as const, text: `[Old ${toolMsg.toolName} result cleared]` }],
		};
	});

	return modified ? { messages: cleaned } : undefined;
}

const CLEAR_PLACEHOLDER = "[Old ";
const COMPACTED_PLACEHOLDER = "[Earlier tool result compacted. Re-run if needed.]";

/**
 * Cached microcompact path: keep only the N most recent clearable tool results
 * with full content, compact older ones regardless of age.
 * This complements the time-based path by also handling high-frequency tool usage.
 */
export function cachedMicrocompact(
	messages: AgentMessage[],
	clearableTools: string[],
	maxCachedResults: number,
): { messages: AgentMessage[] } | undefined {
	// Collect indices of clearable tool results
	const clearableIndices: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role !== "toolResult") continue;
		const toolMsg = msg as ToolResultMessage;
		if (!clearableTools.includes(toolMsg.toolName)) continue;
		if (toolMsg.isError) continue;
		// Skip already compacted results (short content = already replaced)
		const textLen = getTextContentLength(toolMsg.content);
		if (textLen <= COMPACTED_PLACEHOLDER.length + 50) continue;
		clearableIndices.push(i);
	}

	// If we have fewer than maxCachedResults, nothing to compact
	if (clearableIndices.length <= maxCachedResults) return undefined;

	// Keep the last maxCachedResults, compact the rest
	const toCompact = new Set(clearableIndices.slice(0, clearableIndices.length - maxCachedResults));
	if (toCompact.size === 0) return undefined;

	const cleaned = messages.map((msg, i) => {
		if (!toCompact.has(i)) return msg;
		const toolMsg = msg as ToolResultMessage;
		return {
			...toolMsg,
			content: [{ type: "text" as const, text: COMPACTED_PLACEHOLDER }],
		};
	});

	return { messages: cleaned };
}

function getTextContentLength(content: ToolResultMessage["content"]): number {
	let total = 0;
	for (const block of content) {
		if (block.type === "text") {
			total += block.text.length;
		}
	}
	return total;
}

export function stripThinkingBlocks(messages: AgentMessage[]): { messages: AgentMessage[] } | undefined {
	let modified = false;

	const cleaned = messages.map((msg) => {
		if (msg.role !== "assistant") return msg;
		const assistant = msg as AssistantMessage;
		if (!Array.isArray(assistant.content)) return msg;

		const hasThinking = assistant.content.some((block: AssistantMessage["content"][number]) => block.type === "thinking");
		if (!hasThinking) return msg;

		modified = true;
		const filtered = assistant.content.filter((block: AssistantMessage["content"][number]) => block.type !== "thinking");
		return {
			...assistant,
			content: filtered,
		};
	});

	return modified ? { messages: cleaned } : undefined;
}
