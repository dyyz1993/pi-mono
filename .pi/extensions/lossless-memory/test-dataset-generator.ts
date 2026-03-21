/**
 * Lossless Memory - 测试数据集生成器
 * 
 * 生成多样化的测试数据用于评估记忆系统
 */

import type { TestCase } from "./evaluator.js";

export interface TestDatasetConfig {
  nodeCount: number;
  topicCount: number;
  messagesPerTopic: number;
  includeTimeOffset: boolean;
}

export class TestDatasetGenerator {
  
  static generateDefaultConfig(): TestDatasetConfig {
    return {
      nodeCount: 50,
      topicCount: 5,
      messagesPerTopic: 10,
      includeTimeOffset: true,
    };
  }

  static generateTestCases(config: TestDatasetConfig = this.generateDefaultConfig()): TestCase[] {
    const testCases: TestCase[] = [];
    
    const topics = [
      { name: "API 认证", keywords: ["认证", "token", "JWT", "OAuth", "安全"] },
      { name: "数据库优化", keywords: ["数据库", "索引", "查询", "性能", "SQL"] },
      { name: "缓存策略", keywords: ["缓存", "Redis", "过期", "命中率", "内存"] },
      { name: "性能监控", keywords: ["监控", "指标", "告警", "日志", "APM"] },
      { name: "微服务架构", keywords: ["微服务", "服务", "通信", "负载均衡", "容错"] },
    ];

    for (const topic of topics.slice(0, config.topicCount)) {
      for (const keyword of topic.keywords) {
        const relevantNodeIds = this.generateNodeIds(keyword, config.messagesPerTopic);
        
        testCases.push({
          id: `test-${topic.name}-${keyword}`,
          query: keyword,
          relevantDocIds: relevantNodeIds,
          timestamp: Date.now(),
        });
      }
    }

    return testCases;
  }

  static generateNodeIds(keyword: string, count: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(`node-${keyword}-${i}`);
    }
    return ids;
  }

  static generateConversations(config: TestDatasetConfig = this.generateDefaultConfig()): Array<{
    topic: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }> {
    const conversations: Array<{
      topic: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }> = [];

    const topicTemplates = [
      {
        topic: "API 认证",
        messages: [
          { role: "user" as const, content: "如何实现安全的用户认证？" },
          { role: "assistant" as const, content: "建议使用 JWT + OAuth 2.0 组合方案。JWT 用于无状态认证，OAuth 用于第三方授权。" },
          { role: "user" as const, content: "JWT token 应该设置多长的过期时间？" },
          { role: "assistant" as const, content: "访问 token 建议 15-30 分钟，刷新 token 可以设置 7-30 天。需要考虑安全性和用户体验的平衡。" },
          { role: "user" as const, content: "如何处理 token 刷新？" },
          { role: "assistant" as const, content: "使用 refresh token 机制。当 access token 过期时，客户端使用 refresh token 获取新的 access token，无需用户重新登录。" },
        ],
      },
      {
        topic: "数据库优化",
        messages: [
          { role: "user" as const, content: "数据库查询很慢，如何优化？" },
          { role: "assistant" as const, content: "首先分析慢查询日志，找出瓶颈。常见优化方法：添加索引、优化查询语句、分表分库、使用缓存。" },
          { role: "user" as const, content: "索引应该怎么设计？" },
          { role: "assistant" as const, content: "根据查询模式设计索引。遵循最左前缀原则，避免过度索引。考虑使用复合索引、覆盖索引等高级技术。" },
          { role: "user" as const, content: "什么时候需要分表分库？" },
          { role: "assistant" as const, content: "单表数据超过 1000 万行，或单库 QPS 超过 2000 时考虑分表分库。需要评估业务场景和数据增长速度。" },
        ],
      },
      {
        topic: "缓存策略",
        messages: [
          { role: "user" as const, content: "如何设计缓存策略？" },
          { role: "assistant" as const, content: "根据数据特点选择策略：热点数据用 LRU，有时效数据用 TTL，频繁更新数据用 Write-Through。" },
          { role: "user" as const, content: "如何避免缓存穿透？" },
          { role: "assistant" as const, content: "三种方案：1. 缓存空值 2. 布隆过滤器 3. 参数校验拦截。布隆过滤器适合大数据量场景。" },
          { role: "user" as const, content: "缓存和数据库一致性怎么保证？" },
          { role: "assistant" as const, content: "使用 Cache-Aside 模式：先更新数据库，再删除缓存。配合延迟双删策略，可以解决大部分一致性问题。" },
        ],
      },
      {
        topic: "性能监控",
        messages: [
          { role: "user" as const, content: "需要监控哪些关键指标？" },
          { role: "assistant" as const, content: "核心指标：响应时间（P50/P95/P99）、吞吐量（QPS）、错误率、资源使用率（CPU/内存/磁盘）。" },
          { role: "user" as const, content: "如何设置告警阈值？" },
          { role: "assistant" as const, content: "基于历史数据设置动态阈值。响应时间 P99 超过 1 秒、错误率超过 1%、CPU 使用率超过 80% 应该告警。" },
          { role: "user" as const, content: "日志应该如何收集和分析？" },
          { role: "assistant" as const, content: "使用 ELK 或类似方案。结构化日志，包含 trace ID 用于链路追踪。设置合理的日志级别和保留策略。" },
        ],
      },
      {
        topic: "微服务架构",
        messages: [
          { role: "user" as const, content: "微服务如何划分边界？" },
          { role: "assistant" as const, content: "使用领域驱动设计（DDD）方法，按业务能力划分。每个服务应该有独立的数据存储和业务逻辑。" },
          { role: "user" as const, content: "服务之间如何通信？" },
          { role: "assistant" as const, content: "同步通信用 REST/gRPC，异步通信用消息队列。根据业务场景选择：实时性要求高用同步，解耦要求高用异步。" },
          { role: "user" as const, content: "如何保证服务容错？" },
          { role: "assistant" as const, content: "实施熔断、降级、限流策略。使用 Hystrix 或 Sentinel 等框架。设置合理的超时时间和重试策略。" },
        ],
      },
    ];

    for (const template of topicTemplates.slice(0, config.topicCount)) {
      conversations.push({
        topic: template.topic,
        messages: template.messages,
      });
    }

    return conversations;
  }

  static generateLargeDataset(size: number = 100): TestCase[] {
    const testCases: TestCase[] = [];
    
    const keywords = [
      "认证", "授权", "安全", "加密", "解密",
      "数据库", "索引", "查询", "事务", "锁",
      "缓存", "Redis", "内存", "过期", "淘汰",
      "监控", "告警", "日志", "指标", "追踪",
      "微服务", "服务", "网关", "负载", "均衡",
    ];

    for (let i = 0; i < size; i++) {
      const keyword = keywords[i % keywords.length];
      const relevantCount = Math.floor(Math.random() * 5) + 3;
      
      testCases.push({
        id: `test-large-${i}`,
        query: keyword,
        relevantDocIds: this.generateNodeIds(keyword, relevantCount),
        timestamp: Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
      });
    }

    return testCases;
  }

  static generateTemporalTestCases(): TestCase[] {
    const testCases: TestCase[] = [];
    
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    for (let day = 0; day < 30; day++) {
      const timestamp = now - day * dayInMs;
      const keyword = `day-${day}`;
      
      testCases.push({
        id: `temporal-${day}`,
        query: keyword,
        relevantDocIds: this.generateNodeIds(keyword, 3),
        timestamp,
      });
    }

    return testCases;
  }

  static generateInterferenceTestCases(): TestCase[] {
    return [
      {
        id: "interference-1",
        query: "项目A技术栈",
        relevantDocIds: ["node-projectA-tech"],
      },
      {
        id: "interference-2",
        query: "项目B技术栈",
        relevantDocIds: ["node-projectB-tech"],
      },
      {
        id: "interference-3",
        query: "用户偏好设置",
        relevantDocIds: ["node-user-pref-1", "node-user-pref-2"],
      },
      {
        id: "interference-4",
        query: "系统配置参数",
        relevantDocIds: ["node-sys-config-1", "node-sys-config-2", "node-sys-config-3"],
      },
    ];
  }

  static generateAllTestScenarios(): Map<string, TestCase[]> {
    const scenarios = new Map<string, TestCase[]>();
    
    scenarios.set("basic", this.generateTestCases());
    scenarios.set("large", this.generateLargeDataset(100));
    scenarios.set("temporal", this.generateTemporalTestCases());
    scenarios.set("interference", this.generateInterferenceTestCases());

    return scenarios;
  }
}
