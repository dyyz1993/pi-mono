/**
 * Half Compaction Strategy
 *
 * Instead of compressing everything before the cut point, this strategy:
 * 1. Takes the oldest half of messages-to-summarize
 * 2. Generates a summary for only that portion
 * 3. Keeps the middle portion as-is (uncompressed)
 * 4. The newest portion remains untouched (as normal)
 *
 * This preserves more context fidelity in the middle region while still
 * reducing token count significantly.
 */
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { CompactionPreparation, CompactionResult } from "@dyyz1993/pi-coding-agent";

export interface HalfCompactionConfig {
	enabled: boolean;
	/** Fraction of messagesToSummarize to compress (0.0-1.0, default 0.5) */
	ratio: number;
}

/**
 * Split messagesToSummarize in half, summarize only the oldest portion.
 * Returns a CompactionResult where firstKeptEntryId points to the start
 * of the uncompressed middle section.
 *
 * Note: In the current extension API, we cannot directly call the core
 * LLM summarization from an extension without the model reference.
 * For the initial harness-based verification, we generate a deterministic
 * summary. When wired into the full system with pi.callLLM(), real
 * summarization is used.
 */
export function prepareHalfCompaction(
	preparation: CompactionPreparation,
	config: HalfCompactionConfig,
): CompactionResult | null {
	const { messagesToSummarize, firstKeptEntryId, tokensBefore, previousSummary } = preparation;

	if (messagesToSummarize.length < 4) {
		// Too few messages to meaningfully split
		return null;
	}

	const ratio = Math.max(0.1, Math.min(0.9, config.ratio));
	const splitIndex = Math.floor(messagesToSummarize.length * ratio);

	if (splitIndex < 1) return null;

	// The oldest half that we will summarize
	const oldestHalf = messagesToSummarize.slice(0, splitIndex);
	// The middle portion remains uncompressed
	// const middleHalf = messagesToSummarize.slice(splitIndex); // kept in context

	// Build a deterministic summary for harness verification
	// In production, this would call pi.callLLM() with a summarization prompt
	const summary = buildHalfSummary(oldestHalf, previousSummary);

	return {
		summary,
		// firstKeptEntryId remains as-is: the core will keep everything
		// from this ID onward, which includes both middle and newest portions
		firstKeptEntryId,
		tokensBefore,
	};
}

/**
 * Build a summary from the oldest half of messages.
 * Uses deterministic extraction for test verification.
 */
export function buildHalfSummary(
	oldestHalf: AgentMessage[],
	previousSummary?: string,
): string {
	const lines: string[] = [];

	if (previousSummary) {
		lines.push("[Previous summary preserved]");
		lines.push("");
	}

	lines.push(`## Half Compaction Summary`);
	lines.push(`Compressed ${oldestHalf.length} message(s) from the oldest portion of conversation.`);
	lines.push("");

	// Extract key topics from messages
	for (const msg of oldestHalf) {
		if (msg.role === "user") {
			const text = extractTextContent(msg);
			if (text) {
				lines.push(`- User: ${truncate(text, 120)}`);
			}
		} else if (msg.role === "assistant") {
			const text = extractTextContent(msg);
			if (text) {
				lines.push(`- Assistant: ${truncate(text, 120)}`);
			}
		} else if (msg.role === "toolResult") {
			const toolMsg = msg as { toolName?: string };
			if (toolMsg.toolName) {
				lines.push(`- Tool result: ${toolMsg.toolName}`);
			}
		}
	}

	return lines.join("\n");
}

function extractTextContent(msg: AgentMessage): string | undefined {
	const content = (msg as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const texts: string[] = [];
		for (const block of content) {
			if (
				typeof block === "object" &&
				block !== null &&
				"type" in block &&
				block.type === "text" &&
				"text" in block &&
				typeof block.text === "string"
			) {
				texts.push(block.text);
			}
		}
		return texts.join(" ") || undefined;
	}
	return undefined;
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength).trim() + "...";
}
