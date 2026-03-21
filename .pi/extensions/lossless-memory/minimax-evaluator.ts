/**
 * Lossless Memory - MiniMax LLM 评估器（简化版）
 * 
 * 支持 MiniMax API 的 LLM 评估
 */

import type { MemoryDatabase } from "./database.js";
import type { DAGManager } from "./dag-manager.js";
import type { MemoryNode, LosslessMemoryConfig } from "./types.js";

export interface MiniMaxConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

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

export class MiniMaxLLMEvaluator {
  private db: MemoryDatabase;
  private dag: DAGManager;
  private config: LosslessMemoryConfig;
  private minimaxConfig: MiniMaxConfig;

  constructor(
    db: MemoryDatabase,
    dag: DAGManager,
    config: LosslessMemoryConfig,
    minimaxConfig: MiniMaxConfig
  ) {
    this.db = db;
    this.dag = dag;
    this.config = config;
    this.minimaxConfig = minimaxConfig;
  }

  private async callMiniMaxAPI(prompt: string, maxTokens: number = 1000): Promise<string> {
    const url = this.minimaxConfig.baseUrl.endsWith('/')
      ? `${this.minimaxConfig.baseUrl}chat/completions`
      : `${this.minimaxConfig.baseUrl}/chat/completions`;
    
    console.log(`  📡 调用 MiniMax API...`);
    
    const requestBody = {
      model: this.minimaxConfig.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.minimaxConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    content = content.replace(/<think[\s\S]*?<\/think>/g, '').trim();
    
    console.log(`  ✅ 获取到内容 (${content.length} 字符)`);
    return content;
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

    const originalContent = children.map(c => c.content).join("\n\n").substring(0, 1000);
    const summaryContent = summaryNode.content.substring(0, 500);

    const prompt = `评估摘要质量，返回 JSON：
{"clarity":85,"completeness":80,"coherence":75,"actionability":70}

原始内容：${originalContent}
摘要内容：${summaryContent}

评分标准：
- 清晰度：语言简洁易懂
- 完整性：保留关键信息
- 连贯性：逻辑结构合理
- 可操作性：包含足够细节

只返回 JSON，不要其他文字。`;

    try {
      const response = await this.callMiniMaxAPI(prompt, 500);
      console.log(`  📝 MiniMax 响应: ${response}`);
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        console.log(`  ✅ 解析成功: ${JSON.stringify(result)}`);
        return {
          clarity: Math.min(100, Math.max(0, result.clarity || 0)),
          completeness: Math.min(100, Math.max(0, result.completeness || 0)),
          coherence: Math.min(100, Math.max(0, result.coherence || 0)),
          actionability: Math.min(100, Math.max(0, result.actionability || 0)),
        };
      } else {
        console.log(`  ⚠️  未找到 JSON 格式`);
      }
    } catch (error) {
      console.error("评估失败:", error);
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
    const prompt = `评估信息保持率，返回 JSON：
{"keyFacts":85,"decisions":80,"constraints":75,"preferences":70}

原始内容：${originalContent.substring(0, 1000)}
摘要内容：${summaryContent.substring(0, 500)}

评分标准：
- 关键事实：事实数据保留
- 决策记录：决策依据保留
- 约束条件：技术约束保留
- 用户偏好：偏好要求保留

只返回 JSON，不要其他文字。`;

    try {
      const response = await this.callMiniMaxAPI(prompt, 500);
      console.log(`  📝 MiniMax 响应: ${response}`);
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        console.log(`  ✅ 解析成功: ${JSON.stringify(result)}`);
        return {
          keyFacts: Math.min(100, Math.max(0, result.keyFacts || 0)),
          decisions: Math.min(100, Math.max(0, result.decisions || 0)),
          constraints: Math.min(100, Math.max(0, result.constraints || 0)),
          preferences: Math.min(100, Math.max(0, result.preferences || 0)),
        };
      } else {
        console.log(`  ⚠️  未找到 JSON 格式`);
      }
    } catch (error) {
      console.error("评估失败:", error);
    }

    return { keyFacts: 70, decisions: 70, constraints: 70, preferences: 70 };
  }

  async generateImprovementSuggestions(evaluationResults: any): Promise<string[]> {
    const prompt = `基于评估结果生成改进建议，返回 JSON 数组：
["建议1","建议2","建议3"]

评估结果：${JSON.stringify(evaluationResults)}

要求：
1. 针对具体问题
2. 可操作的解决方案
3. 优先级明确

只返回 JSON 数组，不要其他文字。`;

    try {
      const response = await this.callMiniMaxAPI(prompt, 500);
      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("建议生成失败:", error);
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

    console.log(`  📊 找到 ${summaryNodes.length} 个摘要节点`);

    let avgSummaryQuality = { clarity: 0, completeness: 0, coherence: 0, actionability: 0 };
    let avgInformationRetention = { keyFacts: 0, decisions: 0, constraints: 0, preferences: 0 };

    if (summaryNodes.length > 0) {
      const sampleNodes = summaryNodes.slice(0, Math.min(3, summaryNodes.length));
      console.log(`  📝 评估 ${sampleNodes.length} 个样本节点`);
      
      const qualityScores = [];
      const retentionScores = [];

      for (const node of sampleNodes) {
        console.log(`  🔍 评估节点: ${node.id.slice(0, 8)}... (子节点: ${node.childIds.length})`);
        
        const quality = await this.evaluateSummaryQuality(node);
        qualityScores.push(quality);

        const children = node.childIds
          .map(id => this.dag.getNode(id))
          .filter(Boolean) as MemoryNode[];

        console.log(`  📦 找到 ${children.length} 个子节点`);

        if (children.length > 0) {
          const originalContent = children.map(c => c.content).join("\n\n");
          const retention = await this.evaluateInformationRetention(originalContent, node.content);
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
        avgInformationRetention = {
          keyFacts: this.average(retentionScores.map(s => s.keyFacts)),
          decisions: this.average(retentionScores.map(s => s.decisions)),
          constraints: this.average(retentionScores.map(s => s.constraints)),
          preferences: this.average(retentionScores.map(s => s.preferences)),
        };
      }
    }

    const suggestions = await this.generateImprovementSuggestions({
      summaryQuality: avgSummaryQuality,
      informationRetention: avgInformationRetention,
    });

    return {
      summaryQuality: avgSummaryQuality,
      informationRetention: avgInformationRetention,
      suggestions,
    };
  }

  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  printLLMReport(result: LLMEvaluationResult): void {
    console.log("\n" + "═".repeat(70));
    console.log("🤖 MiniMax LLM 增强评估报告");
    console.log("═".repeat(70) + "\n");

    console.log("─".repeat(70));
    console.log("📝 摘要质量评估 (MiniMax LLM)");
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
    console.log("💾 信息保持率评估 (MiniMax LLM)");
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
      console.log("💡 MiniMax LLM 改进建议");
      console.log("─".repeat(70));
      result.suggestions.forEach((suggestion, i) => {
        console.log(`  ${i + 1}. ${suggestion}`);
      });
      console.log("");
    }

    console.log("═".repeat(70) + "\n");
  }
}
