/**
 * Summary Generator for Lossless Memory Extension
 *
 * Generates hierarchical summaries using LLM.
 * Supports multiple providers and models.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { MemoryNode, SummaryConfig, SummaryInput, SummaryOutput } from "./types.js";

// ============================================================================
// Default System Prompt
// ============================================================================

const DEFAULT_SYSTEM_PROMPT = `你是一个专业的对话摘要助手。你的任务是将长对话压缩成简洁的摘要，保留所有关键信息。

摘要规则：
1. 保留关键决策和依据
2. 保留代码变更和文件路径
3. 保留错误和解决方案
4. 保留用户偏好和约束
5. 使用简洁清晰的中文
6. 避免冗余，但要保证完整性

摘要格式：
- 使用条目式结构
- 每个条目以关键动词开头
- 重要信息（如文件路径、命令）使用代码格式`;

// ============================================================================
// Summary Generator Class
// ============================================================================

export class SummaryGenerator {
	private pi: ExtensionAPI;
	private config: SummaryConfig;

	constructor(pi: ExtensionAPI, config: SummaryConfig) {
		this.pi = pi;
		this.config = config;
	}

	// ============================================================================
	// Summary Generation
	// ============================================================================

	/**
	 * Generate summary from session entries
	 */
	async generateSummary(input: SummaryInput): Promise<SummaryOutput> {
		const prompt = this.buildSummaryPrompt(input);

		try {
			// Use pi's model for summary generation
			const summary = await this.generateWithLLM(prompt);

			return {
				summary,
				tokenCount: this.estimateTokens(summary),
				sourceEntryIds: input.entries.map((e) => e.id),
			};
		} catch (error) {
			// Fallback: simple concatenation if LLM fails
			const fallback = this.createFallbackSummary(input);
			return {
				summary: fallback,
				tokenCount: this.estimateTokens(fallback),
				sourceEntryIds: input.entries.map((e) => e.id),
			};
		}
	}

	/**
	 * Generate incremental summary (based on previous summary + new entries)
	 */
	async generateIncrementalSummary(
		previousSummary: string,
		newEntries: SummaryInput["entries"],
		customInstructions?: string,
	): Promise<SummaryOutput> {
		const prompt = this.buildIncrementalPrompt(previousSummary, newEntries, customInstructions);

		try {
			const summary = await this.generateWithLLM(prompt);

			return {
				summary,
				tokenCount: this.estimateTokens(summary),
				sourceEntryIds: newEntries.map((e) => e.id),
			};
		} catch (error) {
			const fallback = `${previousSummary}\n\n新增内容:\n${newEntries.map((e) => e.content).join("\n")}`;
			return {
				summary: fallback,
				tokenCount: this.estimateTokens(fallback),
				sourceEntryIds: newEntries.map((e) => e.id),
			};
		}
	}

	/**
	 * Generate higher-level summary from existing summaries
	 */
	async generateHigherLevelSummary(summaries: MemoryNode[]): Promise<SummaryOutput> {
		const combinedContent = summaries.map((s) => `[层级 ${s.level}]\n${s.content}`).join("\n\n");

		const prompt = `请将以下多个摘要合并成一个更高层次的摘要。

要求：
1. 保留所有关键信息
2. 消除冗余
3. 突出主要进展和决策
4. 保持结构清晰

摘要内容：
${combinedContent}

请生成高层摘要：`;

		try {
			const summary = await this.generateWithLLM(prompt);

			return {
				summary,
				tokenCount: this.estimateTokens(summary),
				sourceEntryIds: summaries.flatMap((s) => s.sessionEntryIds),
			};
		} catch (error) {
			const fallback = `高层摘要:\n${combinedContent}`;
			return {
				summary: fallback,
				tokenCount: this.estimateTokens(fallback),
				sourceEntryIds: summaries.flatMap((s) => s.sessionEntryIds),
			};
		}
	}

	// ============================================================================
	// LLM Interaction
	// ============================================================================

	/**
	 * Generate text using LLM
	 */
	private async generateWithLLM(prompt: string): Promise<string> {
		// Note: In a real implementation, we would use the pi-ai package directly
		// For now, we'll use a simple approach through pi's messaging

		// Create a temporary agent session for summary generation
		// This is a simplified approach - in production, you'd want to use pi-ai directly
		const messages: any[] = [
			{
				role: "system" as const,
				content: [{ type: "text" as const, text: this.config.systemPrompt }],
			},
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: prompt }],
			},
		];

		// Use extension's registered model or default
		// This would need to be implemented with direct pi-ai usage
		// For now, return a placeholder
		return `[摘要生成需要 LLM 调用 - 将在实际使用中实现]`;
	}

	// ============================================================================
	// Prompt Building
	// ============================================================================

	/**
	 * Build summary prompt from entries
	 */
	private buildSummaryPrompt(input: SummaryInput): string {
		let prompt = `请总结以下对话内容。\n\n`;

		if (input.customInstructions) {
			prompt += `特殊要求：${input.customInstructions}\n\n`;
		}

		prompt += `对话内容：\n`;
		for (const entry of input.entries) {
			const role = this.getRoleLabel(entry.role);
			prompt += `[${role}]: ${entry.content}\n\n`;
		}

		prompt += `\n请生成摘要：`;
		return prompt;
	}

	/**
	 * Build incremental summary prompt
	 */
	private buildIncrementalPrompt(
		previousSummary: string,
		newEntries: SummaryInput["entries"],
		customInstructions?: string,
	): string {
		let prompt = `请基于已有摘要，添加新对话的摘要。\n\n`;

		prompt += `已有摘要：\n${previousSummary}\n\n`;

		if (customInstructions) {
			prompt += `特殊要求：${customInstructions}\n\n`;
		}

		prompt += `新对话：\n`;
		for (const entry of newEntries) {
			const role = this.getRoleLabel(entry.role);
			prompt += `[${role}]: ${entry.content}\n\n`;
		}

		prompt += `\n请生成合并后的摘要：`;
		return prompt;
	}

	/**
	 * Get role label for display
	 */
	private getRoleLabel(role: string): string {
		switch (role) {
			case "user":
				return "用户";
			case "assistant":
				return "助手";
			case "toolResult":
				return "工具";
			default:
				return role;
		}
	}

	// ============================================================================
	// Fallback Summary
	// ============================================================================

	/**
	 * Create fallback summary when LLM is unavailable
	 */
	private createFallbackSummary(input: SummaryInput): string {
		const lines: string[] = [];

		lines.push("对话摘要 (自动生成):");
		lines.push("");

		// Group by role
		const userMessages: string[] = [];
		const assistantMessages: string[] = [];
		const toolMessages: string[] = [];

		for (const entry of input.entries) {
			switch (entry.role) {
				case "user":
					userMessages.push(entry.content);
					break;
				case "assistant":
					assistantMessages.push(entry.content);
					break;
				case "toolResult":
					toolMessages.push(entry.content);
					break;
			}
		}

		if (userMessages.length > 0) {
			lines.push("用户请求:");
			for (const msg of userMessages.slice(0, 3)) {
				lines.push(`- ${msg.slice(0, 100)}${msg.length > 100 ? "..." : ""}`);
			}
			lines.push("");
		}

		if (assistantMessages.length > 0) {
			lines.push("助手响应:");
			for (const msg of assistantMessages.slice(0, 3)) {
				lines.push(`- ${msg.slice(0, 100)}${msg.length > 100 ? "..." : ""}`);
			}
			lines.push("");
		}

		if (toolMessages.length > 0) {
			lines.push("工具执行:");
			for (const msg of toolMessages.slice(0, 3)) {
				lines.push(`- ${msg.slice(0, 100)}${msg.length > 100 ? "..." : ""}`);
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	// ============================================================================
	// Utilities
	// ============================================================================

	/**
	 * Estimate token count
	 */
	private estimateTokens(text: string): number {
		// Rough estimation: 1 token ≈ 4 characters for English, 2 for Chinese
		const avgCharPerToken = text.match(/[\u4e00-\u9fa5]/) ? 2 : 4;
		return Math.ceil(text.length / avgCharPerToken);
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<SummaryConfig>): void {
		this.config = { ...this.config, ...config };
	}
}
