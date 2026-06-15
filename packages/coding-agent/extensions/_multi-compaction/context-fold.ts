import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, Message, TextContent, ThinkingContent, ToolCall, ToolResultMessage } from "@dyyz1993/pi-ai";
import type { SessionEntry, SessionMessageEntry } from "@dyyz1993/pi-coding-agent";

/** Lookup table: toolCallId → { isError, resultSnippet } for adding status to fold summaries. */
export type ToolResultLookup = (toolCallId: string) => { isError: boolean; snippet: string } | undefined;

/**
 * Build a lookup function from session entries that maps toolCallId to its
 * result status (success/error) and a short snippet of the result text.
 */
export function buildToolResultLookup(entries: SessionEntry[]): ToolResultLookup {
	const map = new Map<string, { isError: boolean; snippet: string }>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = (entry as SessionMessageEntry).message;
		if (msg.role !== "toolResult") continue;
		const toolMsg = msg as ToolResultMessage;
		// Extract first ~100 chars of text content for error snippet
		let snippet = "";
		if (Array.isArray(toolMsg.content)) {
			for (const block of toolMsg.content) {
				if (block.type === "text" && typeof block.text === "string") {
					snippet = block.text.slice(0, 100);
					break;
				}
			}
		}
		map.set(toolMsg.toolCallId, {
			isError: toolMsg.isError ?? false,
			snippet,
		});
	}
	return (toolCallId: string) => map.get(toolCallId);
}

export function findFoldableEntries(
	entries: SessionEntry[],
	foldedIds: Set<string>,
	maxAgeMs: number,
	keepRecentCount: number,
): SessionMessageEntry[] {
	const now = Date.now();
	const messageEntries = entries.filter(
		(e): e is SessionMessageEntry => e.type === "message" && e.message.role === "assistant",
	);

	if (messageEntries.length <= keepRecentCount) return [];

	const candidates = messageEntries.slice(0, -keepRecentCount);

	return candidates.filter((entry) => {
		if (foldedIds.has(entry.id)) return false;
		const msg = entry.message as AssistantMessage;
		if (!Array.isArray(msg.content)) return false;
		const age = now - msg.timestamp;
		return age >= maxAgeMs;
	});
}

export function extractFoldSummary(
	message: AssistantMessage,
	maxLength: number,
	toolResultLookup?: ToolResultLookup,
): string {
	if (!Array.isArray(message.content)) return "[folded empty message]";

	const textParts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text" && typeof block.text === "string") {
			textParts.push(block.text);
		} else if (block.type === "toolCall" && typeof block.name === "string") {
			// Annotate with success/failure status when available
			const result = toolResultLookup?.(block.id);
			if (result) {
				const status = result.isError ? `FAILED: ${result.snippet}` : "OK";
				textParts.push(`[called ${block.name} → ${status}]`);
			} else {
				textParts.push(`[called ${block.name}]`);
			}
		} else if (block.type === "thinking") {
			textParts.push("[thinking]");
		}
	}

	const full = textParts.join(" ").replace(/\s+/g, " ").trim();
	if (!full) return "[folded empty message]";

	if (full.length <= maxLength) return full;
	return full.slice(0, maxLength).trim() + "...";
}

export function estimateMessageTokens(message: Message): number {
	if (!Array.isArray(message.content)) return 0;
	let total = 0;
	for (const block of message.content) {
		if (block.type === "text" && typeof block.text === "string") {
			total += Math.ceil(block.text.length / 4);
		} else if (block.type === "thinking" && typeof (block as ThinkingContent).thinking === "string") {
			total += Math.ceil((block as ThinkingContent).thinking.length / 4);
		} else {
			total += 50;
		}
	}
	return total;
}

/**
 * Format fold summaries into a single text block injected into LLM context.
 *
 * This ensures the model retains awareness of prior work after folding,
 * preventing "amnesia loops" where the agent repeats the same failed
 * operations because the fold erased all evidence of previous attempts.
 */
export function formatFoldSummaryForLlm(folds: { id: string; summary: string }[]): string {
	const count = folds.length;
	const lines = folds.map((f, i) => `  ${i + 1}. ${f.summary}`);
	return `[Context fold: ${count} previous assistant message(s) were folded to save context space. Summary of what was done:]\n${lines.join("\n")}`;
}
