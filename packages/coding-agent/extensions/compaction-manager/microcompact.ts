import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import type { ToolResultMessage } from "@dyyz1993/pi-ai";

export function microcompactMessages(
	messages: AgentMessage[],
	clearableTools: string[],
	maxAgeMs: number,
): { messages: AgentMessage[] } | undefined {
	const now = Date.now();
	let modified = false;

	const cleaned = messages.map((msg) => {
		if (msg.role !== "toolResult") return msg;
		const toolMsg = msg as ToolResultMessage;
		if (!clearableTools.includes(toolMsg.toolName)) return msg;
		if (toolMsg.isError) return msg;
		if (now - toolMsg.timestamp < maxAgeMs) return msg;

		modified = true;
		return {
			...toolMsg,
			content: [{ type: "text" as const, text: `[Old ${toolMsg.toolName} result cleared]` }],
		};
	});

	return modified ? { messages: cleaned } : undefined;
}
