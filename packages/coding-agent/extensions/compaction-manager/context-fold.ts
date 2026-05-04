import type { AgentMessage, AssistantMessage } from "@dyyz1993/pi-agent-core";
import type { SessionEntry } from "@dyyz1993/pi-coding-agent";

export function findFoldableEntries(
	entries: SessionEntry[],
	foldedIds: Set<string>,
	maxAgeMs: number,
	keepRecentCount: number,
): SessionEntry[] {
	const now = Date.now();
	const messageEntries = entries.filter(
		(e) => e.type === "message" && e.message.role === "assistant",
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

export function extractFoldSummary(message: AssistantMessage, maxLength: number): string {
	if (!Array.isArray(message.content)) return "[folded empty message]";

	const textParts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text" && typeof block.text === "string") {
			textParts.push(block.text);
		} else if (block.type === "toolCall" && typeof block.name === "string") {
			textParts.push(`[called ${block.name}]`);
		} else if (block.type === "thinking") {
			textParts.push("[thinking]");
		}
	}

	const full = textParts.join(" ").replace(/\s+/g, " ").trim();
	if (!full) return "[folded empty message]";

	if (full.length <= maxLength) return full;
	return full.slice(0, maxLength).trim() + "...";
}

export function estimateMessageTokens(message: AgentMessage): number {
	if (!Array.isArray(message.content)) return 0;
	let total = 0;
	for (const block of message.content) {
		if (block.type === "text" && typeof block.text === "string") {
			total += Math.ceil(block.text.length / 4);
		} else if (block.type === "thinking" && typeof (block as any).text === "string") {
			total += Math.ceil(((block as any).text as string).length / 4);
		} else {
			total += 50;
		}
	}
	return total;
}
