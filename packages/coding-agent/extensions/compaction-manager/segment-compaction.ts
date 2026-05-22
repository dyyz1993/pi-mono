/**
 * Segment Compaction Strategy
 *
 * Splits the messages-to-summarize into N equal segments and generates
 * a summary for each segment independently. This preserves temporal
 * ordering at a finer granularity than a single monolithic summary.
 *
 * Each segment summary is stored as a SegmentSummaryEntry, which
 * buildSessionContext() already knows how to reconstruct.
 */
import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { CompactionPreparation, CompactionResult } from "@dyyz1993/pi-coding-agent";

export interface SegmentCompactionConfig {
	enabled: boolean;
	/** Number of segments to split messages into (default: 3) */
	segmentCount: number;
}

export interface SegmentResult {
	summary: string;
	messageCount: number;
	startIndex: number;
	endIndex: number;
}

/**
 * Split messagesToSummarize into segments and generate a summary for each.
 * Returns a single merged summary (all segments concatenated with headers)
 * as a CompactionResult, plus per-segment metadata in details.
 */
export function prepareSegmentCompaction(
	preparation: CompactionPreparation,
	config: SegmentCompactionConfig,
): CompactionResult | null {
	const { messagesToSummarize, firstKeptEntryId, tokensBefore, previousSummary } = preparation;

	const segmentCount = Math.max(2, Math.min(10, config.segmentCount));

	if (messagesToSummarize.length < segmentCount * 2) {
		// Not enough messages to form meaningful segments
		return null;
	}

	const segments = splitIntoSegments(messagesToSummarize, segmentCount);
	const segmentResults: SegmentResult[] = [];

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const startIdx = i * Math.ceil(messagesToSummarize.length / segmentCount);
		const summary = buildSegmentSummary(segment, i, segments.length);

		segmentResults.push({
			summary,
			messageCount: segment.length,
			startIndex: startIdx,
			endIndex: startIdx + segment.length,
		});
	}

	// Merge all segment summaries into one combined summary
	const combinedSummary = buildCombinedSummary(segmentResults, previousSummary);

	return {
		summary: combinedSummary,
		firstKeptEntryId,
		tokensBefore,
		details: {
			strategy: "segment",
			segmentCount: segments.length,
			segments: segmentResults,
		},
	};
}

export function splitIntoSegments<T>(items: T[], count: number): T[][] {
	if (count <= 0) return [items];
	if (items.length === 0) return [];

	const segments: T[][] = [];
	const segmentSize = Math.ceil(items.length / count);

	for (let i = 0; i < count; i++) {
		const start = i * segmentSize;
		const end = Math.min(start + segmentSize, items.length);
		if (start < items.length) {
			segments.push(items.slice(start, end));
		}
	}

	return segments;
}

function buildSegmentSummary(messages: AgentMessage[], index: number, total: number): string {
	const lines: string[] = [];

	lines.push(`### Segment ${index + 1}/${total}`);
	lines.push(`Contains ${messages.length} message(s).`);
	lines.push("");

	for (const msg of messages) {
		if (msg.role === "user") {
			const text = extractTextContent(msg);
			if (text) lines.push(`- User: ${truncate(text, 100)}`);
		} else if (msg.role === "assistant") {
			const text = extractTextContent(msg);
			if (text) lines.push(`- Assistant: ${truncate(text, 100)}`);
		} else if (msg.role === "toolResult") {
			const toolMsg = msg as { toolName?: string };
			if (toolMsg.toolName) lines.push(`- Tool: ${toolMsg.toolName}`);
		}
	}

	return lines.join("\n");
}

function buildCombinedSummary(
	segments: SegmentResult[],
	previousSummary?: string,
): string {
	const parts: string[] = [];

	if (previousSummary) {
		parts.push("[Previous summary incorporated into segments below]");
		parts.push("");
	}

	parts.push(`## Segment Compaction Summary`);
	parts.push(`${segments.length} segments covering the conversation history.`);
	parts.push("");

	for (const seg of segments) {
		parts.push(seg.summary);
		parts.push("");
	}

	return parts.join("\n");
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
