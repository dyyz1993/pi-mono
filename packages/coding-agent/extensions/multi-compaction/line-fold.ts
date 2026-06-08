import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { ToolResultMessage } from "@dyyz1993/pi-ai";

export interface LineFoldConfig {
	enabled: boolean;
	/** Minimum consecutive identical lines before folding (default: 3) */
	minConsecutive: number;
	/** Tool names to apply line folding to (default: all clearable tools) */
	toolNames: string[];
}

export const DEFAULT_LINE_FOLD_CONFIG: LineFoldConfig = {
	enabled: true,
	minConsecutive: 3,
	toolNames: ["bash", "read", "grep", "find", "glob"],
};

/**
 * Fold consecutive identical lines in tool result content.
 *
 * For a run of N identical lines (N >= minConsecutive):
 * - Keep the first line
 * - Insert a fold marker: `[... N-1 identical lines folded]`
 *
 * Example:
 * ```
 * error: connection refused
 * error: connection refused
 * error: connection refused
 * error: connection refused
 * error: connection refused
 * ```
 * becomes:
 * ```
 * error: connection refused
 * [... 4 identical lines folded]
 * ```
 *
 * Deterministic: same input always produces same output.
 */
export function foldDuplicateLines(
	messages: AgentMessage[],
	config: LineFoldConfig,
): { messages: AgentMessage[] } | undefined {
	if (!config.enabled) return undefined;

	let modified = false;
	const result = messages.map((msg) => {
		if (msg.role !== "toolResult") return msg;
		const toolMsg = msg as ToolResultMessage;
		if (!config.toolNames.includes(toolMsg.toolName)) return msg;
		if (toolMsg.isError) return msg;

		const newContent = toolMsg.content.map((block) => {
			if (block.type !== "text") return block;
			const folded = foldText(block.text, config.minConsecutive);
			if (folded === block.text) return block;
			modified = true;
			return { ...block, text: folded };
		});

		return { ...toolMsg, content: newContent };
	});

	return modified ? { messages: result } : undefined;
}

/**
 * Fold consecutive identical lines in a text string.
 * Returns the original text if no folding occurred.
 */
export function foldText(text: string, minConsecutive: number): string {
	const lines = text.split("\n");
	if (lines.length < minConsecutive) return text;

	const result: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const current = lines[i]!;

		// Count consecutive identical lines
		let runLength = 1;
		while (i + runLength < lines.length && lines[i + runLength] === current) {
			runLength++;
		}

		if (runLength >= minConsecutive) {
			// Keep first line, fold the rest
			result.push(current);
			result.push(`[... ${runLength - 1} identical lines folded]`);
			i += runLength;
		} else {
			result.push(current);
			i++;
		}
	}

	const output = result.join("\n");
	return output === text ? text : output;
}
