import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { LearningStore } from "./store.ts";
import type { LearningSkillCandidatePayload } from "./contract.ts";
import { messageText, extractToolCalls, logger } from "./utils.ts";

export function extractWorkflowText(messages: AgentMessage[]): string {
	return messages
		.filter((message) => message.role === "assistant" || message.role === "toolResult")
		.slice(-12)
		.map(messageText)
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

/**
 * 快速过滤：判断对话是否值得蒸馏 skill。
 *
 * 重要：event.messages 只包含本次 turn 的消息（通常 4-6 条），不是整个 session 历史。
 * 所以不能依赖消息数量或 workflow 文本长度判断，而应该基于操作类型判断。
 *
 * skill 是可复用的工作流，核心条件是：
 *   1. 有 write 类操作（实际修改了文件系统）
 *   2. 有 toolResult（操作完成）
 *   3. 有 assistant 的最终回复（任务结束）
 */
const WRITE_TOOL_NAMES = new Set([
	"write", "edit", "create", "delete", "mkdir", "mv", "cp", "rm",
	"npm", "bun", "pnpm", "yarn",
]);

export function shouldDistill(messages: AgentMessage[]): boolean {
	const toolCalls = extractToolCalls(messages);
	const hasToolResult = messages.some((m) => m.role === "toolResult");
	const hasAssistantReply = messages.some((m) => m.role === "assistant" && messageText(m).length > 0);
	// Only check actual tool names — avoid matching "write" in prose/arguments
	const hasWriteOp = toolCalls.some((tc) => {
		const base = tc.name.split(".").pop() ?? tc.name;
		if (WRITE_TOOL_NAMES.has(base.toLowerCase())) return true;
		// git commit/push/merge/rebase via bash
		if (base.toLowerCase() === "bash" || base.toLowerCase() === "sh") {
			return /\b(?:git\s+(?:commit|push|merge|rebase))\b/.test(tc.arguments);
		}
		return false;
	});

	// 纯问候不蒸馏
	const greetings = ["哈喽", "你好", "好的", "没问题", "ok", "hello", "hi"];
	const firstUserMsg = messages.find((m) => m.role === "user");
	if (firstUserMsg) {
		const text = messageText(firstUserMsg).trim().toLowerCase();
		if (greetings.some((g) => text === g)) return false;
	}

	// 核心条件：有 write 操作 + 有 toolResult + 有 assistant 回复
	return hasWriteOp && hasToolResult && hasAssistantReply;
}

/**
 * 从 user 请求中提取一个简短的 skill name。
 * 例如 "帮我在 /tmp 下创建一个 test.txt 文件" → "create-file"
 */
export function deriveSkillName(messages: AgentMessage[]): string {
	const firstUserMsg = messages.find((m) => m.role === "user");
	if (!firstUserMsg) return "learned-workflow";
	const text = messageText(firstUserMsg).trim();
	if (!text) return "learned-workflow";

	// 关键词匹配（英文用 \b 边界，中文直接匹配）
	const lower = text.toLowerCase();
	const verbMap: Array<[RegExp, string]> = [
		[/\bcreate\b|创建|新建|生成/, "create"],
		[/\bedit\b|修改|更新|编辑/, "edit"],
		[/\bdelete\b|删除|移除/, "delete"],
		[/\bwrite\b|写入|写/, "write"],
		[/\bdeploy\b|部署/, "deploy"],
		[/\btest\b|测试/, "test"],
		[/\bfix\b|修复/, "fix"],
		[/\brefactor\b|重构/, "refactor"],
	];
	const nounMap: Array<[RegExp, string]> = [
		[/\bfile\b|文件/, "file"],
		[/\bdir\b|\bdirectory\b|目录|文件夹/, "dir"],
		[/\bcomponent\b|组件/, "component"],
		[/\bfunction\b|函数/, "function"],
		[/\bconfig\b|配置/, "config"],
		[/\bscript\b|脚本/, "script"],
	];
	const verb = verbMap.find(([re]) => re.test(lower))?.[1] ?? "task";
	const noun = nounMap.find(([re]) => re.test(lower))?.[1] ?? "";
	return noun ? `${verb}-${noun}` : verb;
}

/**
 * 构建完整的工作流文本，包含 user 请求、thinking、toolCall、toolResult、assistant 回复。
 * 这样 skill 才有可复用的上下文信息。
 */
export function buildWorkflowDocument(messages: AgentMessage[]): string {
	const lines: string[] = [];
	for (const message of messages) {
		if (!("content" in message)) continue;
		const content = (message as { content: unknown }).content;
		if (typeof content === "string") {
			if (message.role === "user") {
				lines.push(`### User Request`);
				lines.push(content);
				lines.push("");
			} else if (message.role === "assistant") {
				lines.push(`### Assistant`);
				lines.push(content);
				lines.push("");
			}
			continue;
		}
		if (!Array.isArray(content)) continue;

		if (message.role === "user") {
			const text = content
				.filter((p): p is { type: "text"; text: string } => {
					const r = p as Record<string, unknown>;
					return r.type === "text" && typeof r.text === "string";
				})
				.map((p) => p.text)
				.join("\n");
			if (text.trim()) {
				lines.push(`### User Request`);
				lines.push(text);
				lines.push("");
			}
		} else if (message.role === "assistant") {
			for (const part of content) {
				if (typeof part !== "object" || part === null) continue;
				const r = part as Record<string, unknown>;
				if (r.type === "thinking" && typeof r.thinking === "string" && r.thinking.trim()) {
					lines.push(`#### Thinking`);
					lines.push(r.thinking);
					lines.push("");
				} else if (r.type === "text" && typeof r.text === "string" && r.text.trim()) {
					lines.push(`#### Response`);
					lines.push(r.text);
					lines.push("");
				} else if ((r.type === "toolCall" || r.type === "tool_use") && typeof r.name === "string") {
					const args = r.arguments ?? r.input ?? {};
					lines.push(`#### Tool Call: ${r.name}`);
					lines.push("```json");
					lines.push(JSON.stringify(args, null, 2));
					lines.push("```");
					lines.push("");
				}
			}
		} else if (message.role === "toolResult") {
			const text = content
				.filter((p): p is { type: "text"; text: string } => {
					const r = p as Record<string, unknown>;
					return r.type === "text" && typeof r.text === "string";
				})
				.map((p) => p.text)
				.join("\n");
			if (text.trim()) {
				lines.push(`#### Tool Result`);
				lines.push(text);
				lines.push("");
			}
		}
	}
	return lines.join("\n").trim();
}

export function buildSkillCandidatePayload(messages: AgentMessage[]): LearningSkillCandidatePayload | null {
	const workflow = buildWorkflowDocument(messages);
	if (!workflow) return null;
	const name = deriveSkillName(messages);
	// 提取 user 请求首行作为 description
	const firstUserMsg = messages.find((m) => m.role === "user");
	const description = firstUserMsg ? messageText(firstUserMsg).trim().slice(0, 100) : "Reusable workflow distilled from a completed task.";
	return {
		type: "skill",
		name,
		description,
		body: [
			"# Learned Workflow",
			"",
			`Description: ${description}`,
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

	// 快速过滤：不值得蒸馏的对话直接跳过
	if (!shouldDistill(input.messages)) {
		logger.info("skill.distill skipped by filter", { messagesCount: input.messages.length });
		return;
	}

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
		logger.info("skill.distill candidate created (pending)", { name: payload.name });
		return;
	}
	// auto 模式：直接 apply，不走 candidate 文件（避免冗余的 create+approve 两步写文件）
	const candidate = {
		version: 1 as const,
		id: `auto-skill-${Date.now()}`,
		domain: "skill" as const,
		action: "create-skill" as const,
		status: "approved" as const,
		title: `Create skill: ${payload.name}`,
		summary: payload.description,
		confidence: "medium" as const,
		sourceSessionId: input.sourceSessionId,
		sourceMessageIds: input.sourceMessageIds ?? [],
		createdAt: Date.now(),
		payload,
		fileRefs: [],
		decision: "approved" as const,
		decidedAt: Date.now(),
	};
	await input.store.applySkillCandidate(payload, candidate);
	logger.info("skill.distill applied (auto)", { name: payload.name });
}
