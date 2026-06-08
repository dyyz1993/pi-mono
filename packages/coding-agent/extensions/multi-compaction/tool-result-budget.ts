import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { TextContent, ToolResultMessage } from "@dyyz1993/pi-ai";

export interface ToolResultBudgetConfig {
	enabled: boolean;
	maxResultChars: number;
	previewChars: number;
	outputDir: string;
}

export const DEFAULT_TOOL_RESULT_BUDGET_CONFIG: ToolResultBudgetConfig = {
	enabled: true,
	maxResultChars: 200_000,
	previewChars: 2000,
	outputDir: ".task_outputs/tool-results",
};

interface SizedResult {
	index: number;
	chars: number;
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

function persistToolResult(
	toolMsg: ToolResultMessage,
	outputDir: string,
	previewChars: number,
): ToolResultMessage {
	const timestamp = Date.now();
	const sanitized = toolMsg.toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
	const filename = `${sanitized}-${timestamp}.txt`;
	const filePath = join(outputDir, filename);

	mkdirSync(outputDir, { recursive: true });

	const fullText = toolMsg.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	writeFileSync(filePath, fullText, "utf-8");

	const relPath = relative(process.cwd(), filePath);
	const preview =
		fullText.length > previewChars ? fullText.slice(0, previewChars) : fullText;

	const replacementContent: TextContent[] = [
		{
			type: "text",
			text: `[persisted-output: ${relPath}]\n<preview>\n${preview}\n... (truncated, full output saved to ${relPath})`,
		},
	];

	return {
		...toolMsg,
		content: replacementContent,
	};
}

export function budgetToolResults(
	messages: AgentMessage[],
	config: ToolResultBudgetConfig,
): { messages: AgentMessage[] } | undefined {
	let totalChars = 0;
	const toolResults: { msgIndex: number; msg: ToolResultMessage; chars: number }[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role !== "toolResult") continue;
		const toolMsg = msg as ToolResultMessage;
		if (toolMsg.isError) continue;

		const chars = getTextContentLength(toolMsg.content);
		totalChars += chars;
		toolResults.push({ msgIndex: i, msg: toolMsg, chars });
	}

	if (totalChars <= config.maxResultChars) return undefined;

	const budget = totalChars - config.maxResultChars;

	const sorted = toolResults
		.map((r, originalIndex) => ({ ...r, originalIndex }))
		.sort((a, b) => b.chars - a.chars);

	let saved = 0;
	const toPersist = new Set<number>();

	for (const result of sorted) {
		if (saved >= budget) break;
		// Don't persist results that are individually very small
		if (result.chars <= config.previewChars) continue;

		toPersist.add(result.msgIndex);
		saved += result.chars;
	}

	if (toPersist.size === 0) return undefined;

	const modified = messages.map((msg, i) => {
		if (!toPersist.has(i)) return msg;
		const toolMsg = msg as ToolResultMessage;
		return persistToolResult(toolMsg, config.outputDir, config.previewChars);
	});

	return { messages: modified };
}
