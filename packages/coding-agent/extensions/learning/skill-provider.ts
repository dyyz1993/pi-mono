import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { LearningStore } from "./store.ts";
import type { LearningSkillCandidatePayload } from "./contract.ts";

function messageText(message: AgentMessage): string {
	if (!("content" in message)) return "";
	const content = (message as { content: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			const record = part as Record<string, unknown>;
			return record.type === "text" && typeof record.text === "string";
		})
		.map((part) => part.text)
		.join("\n");
}

function extractWorkflowText(messages: AgentMessage[]): string {
	return messages
		.filter((message) => message.role === "assistant" || message.role === "toolResult")
		.slice(-12)
		.map(messageText)
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

export function buildSkillCandidatePayload(messages: AgentMessage[]): LearningSkillCandidatePayload | null {
	const workflow = extractWorkflowText(messages);
	if (!workflow) return null;
	const name = "learned-workflow";
	return {
		type: "skill",
		name,
		description: "Reusable workflow distilled from a completed task.",
		body: [
			"# Learned Workflow",
			"",
			"Use this skill when a later task matches the workflow below.",
			"",
			"## Procedure",
			"",
			workflow.slice(0, 6000),
		].join("\n"),
		files: [
			{
				relativePath: "references/source-summary.md",
				content: `# Source Summary\n\n${workflow.slice(0, 2000)}\n`,
			},
		],
	};
}

export async function maybeDistillSkill(input: {
	store: LearningStore;
	messages: AgentMessage[];
	sourceSessionId?: string;
	sourceMessageIds?: string[];
}): Promise<void> {
	const config = await input.store.getConfig();
	if (!config.enabled || config.skills.distillMode === "off") return;
	const payload = buildSkillCandidatePayload(input.messages);
	if (!payload) return;
	if (config.skills.distillMode === "pending") {
		await input.store.createSkillCandidate({
			title: `Create skill: ${payload.name}`,
			summary: payload.description,
			payload,
			sourceSessionId: input.sourceSessionId,
			sourceMessageIds: input.sourceMessageIds,
		});
		return;
	}
	const candidate = await input.store.createSkillCandidate({
		title: `Create skill: ${payload.name}`,
		summary: payload.description,
		payload,
		sourceSessionId: input.sourceSessionId,
		sourceMessageIds: input.sourceMessageIds,
	});
	await input.store.approveCandidate(candidate.id);
}

