import type { AgentMessage } from "@dyyz1993/pi-agent-core";
import { LearningStore } from "./store.ts";
import type { LearningMemoryCandidatePayload } from "./contract.ts";
import { EXTRACTION_PROMPT } from "./prompts.ts";
import { messageText, extractToolCalls, stripMarkdownCodeBlock, slugifyFilename, logger, type CallLLMFn } from "./utils.ts";

export function extractText(messages: AgentMessage[]): string {
	return messages
		.slice(-8)
		.map(messageText)
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

/**
 * 快速过滤（不需要 LLM）：判断对话是否值得提取 memory。
 * 大幅减少无意义 candidate 的产生。
 */
export function shouldExtract(messages: AgentMessage[]): boolean {
	// 1. 至少 4 条消息（2 轮对话）
	if (messages.length < 4) return false;

	// 2. 取最后 8 条消息文本
	const text = extractText(messages);
	if (!text || text.length < 300) return false;

	// 3. 纯问候/确认不提取
	const greetings = ["哈喽", "你好", "好的", "没问题", "ok", "hello", "hi", "嗯", "是的", "对", "thanks", "谢谢"];
	const firstLine = text.split(/\r?\n/)[0]?.trim().toLowerCase() ?? "";
	if (greetings.some((g) => firstLine === g)) return false;

	// 4. 必须有有价值的内容指标
	const hasToolCall = messages.some((m) => m.role === "toolResult") || extractToolCalls(messages).length > 0;
	const hasCodeBlock = text.includes("```") || /\b(?:function|const|class|import|export|interface)\b/.test(text);
	const hasTechnicalContent = /(?:error|bug|fix|config|api|database|test|deploy|refactor|implement|架构|配置|部署|测试|实现|修复|问题)/i.test(text);

	return hasToolCall || hasCodeBlock || hasTechnicalContent;
}

/**
 * 解析 LLM 提取响应
 */
export function parseExtractionResponse(
	response: string,
): { op: "create" | "update" | "skip"; filename?: string; name?: string; description?: string; type?: string; content?: string } | null {
	try {
		const parsed = JSON.parse(stripMarkdownCodeBlock(response));
		if (!parsed.actions || !Array.isArray(parsed.actions) || parsed.actions.length === 0) return null;
		return parsed.actions[0];
	} catch {
		return null;
	}
}

export function buildMemoryCandidatePayload(messages: AgentMessage[]): LearningMemoryCandidatePayload | null {
	const text = extractText(messages);
	if (!text) return null;
	const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "learned memory";
	const description = firstLine.slice(0, 90);
	return {
		type: "memory",
		filename: slugifyFilename(description),
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
	callLLM?: CallLLMFn;
}): Promise<void> {
	const config = await input.store.getConfig();
	if (!config.enabled || config.memory.extractMode === "off") return;

	// 快速过滤：不值得提取的对话直接跳过
	if (!shouldExtract(input.messages)) {
		logger.info("memory.extract skipped by filter", { messagesCount: input.messages.length });
		return;
	}

	let payload = buildMemoryCandidatePayload(input.messages);
	if (!payload) return;

	// 如果有 LLM，用它提取高质量内容
	if (input.callLLM) {
		try {
			const manifest = input.messages
				.slice(-12)
				.map(messageText)
				.filter(Boolean)
				.join("\n")
				.slice(0, 8000);
			const response = await input.callLLM({
			systemPrompt: EXTRACTION_PROMPT(manifest),
			messages: [{ role: "user", content: "Extract memory from the conversation above." }],
		});
			const action = parseExtractionResponse(response);
			if (!action || action.op === "skip") {
				return; // LLM 判断不值得保存
			}
			if (action.op === "create" && action.content && action.filename) {
				payload = {
					type: "memory",
					filename: action.filename.endsWith(".md") ? action.filename : `${action.filename}.md`,
					description: action.description ?? action.name ?? "learned memory",
					memoryType: (action.type as "user" | "feedback" | "project" | "reference") ?? "project",
					content: action.content,
				};
			}
			// op === "update" 暂不支持
		} catch (err) {
			logger.warn("memory.extract llm failed, falling back to raw payload", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

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
	// auto 模式：直接 apply，不走 candidate 文件（避免冗余的 create+approve 两步写文件）
	const candidate = {
		version: 1 as const,
		id: `auto-memory-${Date.now()}`,
		domain: "memory" as const,
		action: "create-memory" as const,
		status: "approved" as const,
		title: `Remember: ${payload.description}`,
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
	await input.store.applyMemoryCandidate(payload, candidate);
}
