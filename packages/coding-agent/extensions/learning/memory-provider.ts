import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { LearningStore } from "./store.ts";
import type { LearningMemoryCandidatePayload } from "./contract.ts";

function extractText(messages: AgentMessage[]): string {
	return messages
		.slice(-8)
		.map((message) => {
			if (!("content" in message)) return "";
			const content = (message as { content: unknown }).content;
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return "";
			return content
				.filter((part): part is { type: "text"; text: string } => {
					return typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string";
				})
				.map((part) => part.text)
				.join("\n");
		})
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

export function buildMemoryCandidatePayload(messages: AgentMessage[]): LearningMemoryCandidatePayload | null {
	const text = extractText(messages);
	if (!text) return null;
	const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "learned memory";
	const description = firstLine.slice(0, 90);
	return {
		type: "memory",
		filename: `${description}.md`,
		description,
		memoryType: "project",
		content: text.slice(0, 4000),
	};
}

export async function maybeExtractMemory(input: {
	store: LearningStore;
	messages: AgentMessage[];
	sourceSessionId?: string;
	sourceMessageIds?: string[];
}): Promise<void> {
	const config = await input.store.getConfig();
	if (!config.enabled || config.memory.extractMode === "off") return;
	const payload = buildMemoryCandidatePayload(input.messages);
	if (!payload) return;
	if (config.memory.extractMode === "pending") {
		await input.store.createMemoryCandidate({
			title: `Remember: ${payload.description}`,
			summary: payload.description,
			payload,
			sourceSessionId: input.sourceSessionId,
			sourceMessageIds: input.sourceMessageIds,
		});
		return;
	}
	const candidate = await input.store.createMemoryCandidate({
		title: `Remember: ${payload.description}`,
		summary: payload.description,
		payload,
		sourceSessionId: input.sourceSessionId,
		sourceMessageIds: input.sourceMessageIds,
	});
	await input.store.approveCandidate(candidate.id);
}

