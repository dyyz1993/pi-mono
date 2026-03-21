/**
 * Lossless Memory - LLM 增强评估模块
 * 
 * 使用 LLM 进行更智能的评估：
 * - 摘要质量评估
 * - 信息保持率评估
 * - 改进建议生成
 */

import { completeSimple, type Model } from "@mariozechner/pi-ai";
import type { MemoryDatabase } from "./database.js";
import type { DAGManager } from "./dag-manager.js";
import type { MemoryNode, LosslessMemoryConfig } from "./types.js";

export interface LLMEvaluationResult {
  summaryQuality: {
    clarity: number;
    completeness: number;
    coherence: number;
    actionability: number;
  };
  informationRetention: {
    keyFacts: number;
    decisions: number;
    constraints: number;
    preferences: number;
  };
  suggestions: string[];
}

export class LLMEvaluator {
  private db: MemoryDatabase;
  private dag: DAGManager;
  private config: LosslessMemoryConfig;
  private model: Model;

  constructor(
    db: MemoryDatabase,
    dag: DAGManager,
    config: LosslessMemoryConfig,
    model: Model
  ) {
    this.db = db;
    this.dag = dag;
    this.config = config;
    this.model = model;
  }

  async evaluateSummaryQuality(summaryNode: MemoryNode): Promise<{
    clarity: number;
    completeness: number;
    coherence: number;
    actionability: number;
  }> {
    const children = summaryNode.childIds
      .map(id => this.dag.getNode(id))
      .filter(Boolean) as MemoryNode[];

    if (children.length === 0) {
      return { clarity: 0, completeness: 0, coherence: 0, actionability: 0 };
    }

    const originalContent = children.map(c => c.content).join("\n\n");
    const summaryContent = summaryNode.content;

    const prompt = `你是一个对话摘要质量评估专家。请评估以下摘要的质量。

原始对话内容：
${originalContent}

摘要内容：
${summaryContent}

请从以下四个维度评估摘要质量（每项 0-100 分）：

1. **清晰度 (clarity)**: 摘要是否清晰易懂，语言是否简洁
2. **完整性 (completeness)**: 摘要是否保留了所有关键信息
3. **连贯性 (coherence)**: 摘要的逻辑结构是否合理
4. **可操作性 (actionability)**: 摘要是否包含足够的细节供后续参考

请以 JSON 格式返回评分：
{
  "clarity": <0-100>,
  "completeness": <0-100>,
  "coherence": <0-100>,
  "actionability": <0-100>
}`;

    try {
      const response = await completeSimple(
        this.model,
        [{ role: "user", content: [{ type: "text", text: prompt }] }],
        { maxTokens: 200 }
      );

      const textContent = response.content
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("");

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("LLM evaluation failed:", error);
    }

    return { clarity: 70, completeness: 70, coherence: 70, actionability: 70 };
  }

  async evaluateInformationRetention(
    originalContent: string,
    summaryContent: string
  ): Promise<{
    keyFacts: number;
    decisions: number;
    constraints: number;
    preferences: number;
  }> {
    const prompt = `你是一个信息保持率评估专家。请评估摘要保留了原始内容的多少信息。

原始内容：
${originalContent}

摘要内容：
${summaryContent}

请评估以下四类信息的保持率（每项 0-100 分）：

1. **关键事实 (keyFacts)**: 具体的事实、数据、代码片段等
2. **决策记录 (decisions)**: 做出的决策及其依据
3. **约束条件 (constraints)**: 技术约束、时间约束等
4. **用户偏好 (preferences)**: 用户的偏好和特殊要求

请以 JSON 格式返回评分：
{
  "keyFacts": <0-100>,
  "decisions": <0-100>,
  "constraints": <0-100>,
  "preferences": <0-100>
}`;

    try {
      const response = await completeSimple(
        this.model,
        [{ role: "user", content: [{ type: "text", text: prompt }] }],
        { maxTokens: 200 }
      );

      const textContent = response.content
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("");

      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("LLM evaluation failed:", error);
    }

    return { keyFacts: 70, decisions: 70, constraints: 70, preferences: 70 };
  }

  async generateImprovementSuggestions(
    evaluationResults: any
  ): Promise<string[]> {
    const prompt = `你是一个 AI 记忆系统优化专家。基于以下评估结果，生成具体的改进建议。

评估结果：
${JSON.stringify(evaluationResults, null, 2)}

请生成 3-5 条具体的改进建议，每条建议应该：
1. 针对具体问题
2. 提供可操作的解决方案
3. 优先级明确

请以 JSON 数组格式返回建议：
["建议1", "建议2", "建议3"]`;

    try {
      const response = await completeSimple(
        this.model,
        [{ role: "user", content: [{ type: "text", text: prompt }] }],
        { maxTokens: 300 }
      );

      const textContent = response.content
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("");

      const jsonMatch = textContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("LLM suggestion generation failed:", error);
    }

    return [
      "优化摘要生成策略，提高信息保持率",
      "改进 DAG 结构，减少孤立节点",
      "增强检索算法，提升召回率",
    ];
  }

  async runLLMEvaluation(): Promise<LLMEvaluationResult> {
    const nodes = this.dag.getSessionNodes();
    const summaryNodes = nodes.filter(n => n.type === "summary");

    let avgSummaryQuality = {
      clarity: 0,
      completeness: 0,
      coherence: 0,
      actionability: 0,
    };

    let avgInfoRetention = {
      keyFacts: 0,
      decisions: 0,
      constraints: 0,
      preferences: 0,
    };

    if (summaryNodes.length > 0) {
      const sampleNodes = summaryNodes.slice(0, Math.min(3, summaryNodes.length));

      const qualityScores = [];
      const retentionScores = [];

      for (const node of sampleNodes) {
        const quality = await this.evaluateSummaryQuality(node);
        qualityScores.push(quality);

        const children = node.childIds
          .map(id => this.dag.getNode(id))
          .filter(Boolean) as MemoryNode[];

        if (children.length > 0) {
          const originalContent = children.map(c => c.content).join("\n\n");
          const retention = await this.evaluateInformationRetention(
            originalContent,
            node.content
          );
          retentionScores.push(retention);
        }
      }

      if (qualityScores.length > 0) {
        avgSummaryQuality = {
          clarity: this.average(qualityScores.map(s => s.clarity)),
          completeness: this.average(qualityScores.map(s => s.completeness)),
          coherence: this.average(qualityScores.map(s => s.coherence)),
          actionability: this.average(qualityScores.map(s => s.actionability)),
        };
      }

      if (retentionScores.length > 0) {
        avgInfoRetention = {
          keyFacts: this.average(retentionScores.map(s => s.keyFacts)),
          decisions: this.average(retentionScores.map(s => s.decisions)),
          constraints: this.average(retentionScores.map(s => s.constraints)),
          preferences: this.average(retentionScores.map(s => s.preferences)),
        };
      }
    }

    const suggestions = await this.generateImprovementSuggestions({
      summaryQuality: avgSummaryQuality,
      informationRetention: avgInfoRetention,
    });

    return {
      summaryQuality: avgSummaryQuality,
      informationRetention: avgInfoRetention,
      suggestions,
    };
  }

  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  printLLMReport(result: LLMEvaluationResult): void {
    console.log("\n" + "═".repeat(70));
    console.log("🤖 LLM 增强评估报告");
    console.log("═".repeat(70) + "\n");

    console.log("─".repeat(70));
    console.log("📝 摘要质量评估 (LLM)");
    console.log("─".repeat(70));
    console.log(`  清晰度:       ${result.summaryQuality.clarity.toFixed(2)}/100`);
    console.log(`  完整性:       ${result.summaryQuality.completeness.toFixed(2)}/100`);
    console.log(`  连贯性:       ${result.summaryQuality.coherence.toFixed(2)}/100`);
    console.log(`  可操作性:     ${result.summaryQuality.actionability.toFixed(2)}/100`);

    const avgQuality =
      (result.summaryQuality.clarity +
        result.summaryQuality.completeness +
        result.summaryQuality.coherence +
        result.summaryQuality.actionability) /
      4;
    console.log(`  平均质量:     ${avgQuality.toFixed(2)}/100\n`);

    console.log("─".repeat(70));
    console.log("💾 信息保持率评估 (LLM)");
    console.log("─".repeat(70));
    console.log(`  关键事实:     ${result.informationRetention.keyFacts.toFixed(2)}/100`);
    console.log(`  决策记录:     ${result.informationRetention.decisions.toFixed(2)}/100`);
    console.log(`  约束条件:     ${result.informationRetention.constraints.toFixed(2)}/100`);
    console.log(`  用户偏好:     ${result.informationRetention.preferences.toFixed(2)}/100`);

    const avgRetention =
      (result.informationRetention.keyFacts +
        result.informationRetention.decisions +
        result.informationRetention.constraints +
        result.informationRetention.preferences) /
      4;
    console.log(`  平均保持率:   ${avgRetention.toFixed(2)}/100\n`);

    if (result.suggestions.length > 0) {
      console.log("─".repeat(70));
      console.log("💡 LLM 改进建议");
      console.log("─".repeat(70));
      result.suggestions.forEach((suggestion, i) => {
        console.log(`  ${i + 1}. ${suggestion}`);
      });
      console.log("");
    }

    console.log("═".repeat(70) + "\n");
  }
}
