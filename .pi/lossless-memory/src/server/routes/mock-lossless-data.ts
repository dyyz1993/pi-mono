import { Hono } from 'hono';

const router = new Hono();

// 生成 Mock DAG 数据
function generateMockNodes() {
  const nodes = [];
  const topics = ['API 设计', '数据库优化', '缓存策略', '性能监控', '安全认证', '微服务架构'];
  
  // 生成 1 个 L2 节点
  nodes.push({
    id: 'l2-' + Date.now(),
    level: 2,
    type: 'summary',
    content: '整个对话涵盖了系统架构设计的多个方面。讨论了 API 规范、数据库优化方案、缓存策略设计、性能监控体系建设、安全认证流程和微服务拆分策略。关键技术决策包括：采用 RESTful API 规范、使用 PostgreSQL+Redis 组合、实现 JWT+OAuth2.0 双重认证、搭建 Prometheus+Grafana 监控平台、按业务领域进行微服务拆分。',
    tokenCount: 180,
    childIds: ['l1-1', 'l1-2', 'l1-3', 'l1-4', 'l1-5', 'l1-6'],
    sessionEntryIds: Array.from({length: 48}, (_, i) => `msg-${i+1}`)
  });
  
  // 生成 6 个 L1 节点
  topics.forEach((topic, i) => {
    nodes.push({
      id: `l1-${i+1}`,
      level: 1,
      type: 'summary',
      content: `${topic}讨论：用户询问了${topic}的最佳实践，助手给出了详细建议。包括具体实现方案、技术选型对比、注意事项、常见问题解决方案。达成了关键技术决策，确定了实施方案和时间表。`,
      tokenCount: 80 + Math.floor(Math.random() * 40),
      childIds: Array.from({length: 8}, (_, j) => `msg-${i*8+j+1}`),
      sessionEntryIds: Array.from({length: 8}, (_, j) => `msg-${i*8+j+1}`)
    });
  });
  
  return nodes;
}

// Mock 项目数据
const MOCK_PROJECTS = [
  { path: '/Users/xuyingzhou/Project/temporary/pi-mono', name: 'pi-mono', sessions: 12, nodes: 24, tokens: 15420, lastSeen: Date.now() },
  { path: '/Users/xuyingzhou/Project/test-app', name: 'test-app', sessions: 5, nodes: 8, tokens: 5200, lastSeen: Date.now() - 86400000 },
  { path: '/Users/xuyingzhou/Project/web-dashboard', name: 'web-dashboard', sessions: 8, nodes: 15, tokens: 9800, lastSeen: Date.now() - 172800000 }
];

// Mock 会话数据
function generateMockSessions() {
  return Array.from({length: 12}, (_, i) => ({
    id: `session-${i+1}`,
    name: `2026-03-${21-i} 的对话`,
    messages: 20 + Math.floor(Math.random() * 30),
    tokens: 1000 + Math.floor(Math.random() * 2000),
    lastSeen: Date.now() - i * 86400000,
    size: 50000 + Math.floor(Math.random() * 100000)
  }));
}

// API 路由
router.get('/api/projects', (c) => {
  return c.json(MOCK_PROJECTS);
});

router.get('/api/data', (c) => {
  const nodes = generateMockNodes();
  const sessions = generateMockSessions();
  
  return c.json({
    stats: {
      nodeCount: nodes.length,
      maxLevel: 2,
      totalTokens: nodes.reduce((s, n) => s + n.tokenCount, 0),
      sessionCount: sessions.length,
      messageCount: sessions.reduce((s, x) => s + x.messages, 0),
      sizeMB: sessions.reduce((s, x) => s + x.size, 0) / 1024 / 1024
    },
    nodes,
    sessions,
    project: MOCK_PROJECTS[0]
  });
});

router.get('/api/nodes', (c) => {
  return c.json(generateMockNodes());
});

router.get('/api/sessions', (c) => {
  return c.json(generateMockSessions());
});

router.get('/api/stats', (c) => {
  const nodes = generateMockNodes();
  const sessions = generateMockSessions();
  
  return c.json({
    nodeCount: nodes.length,
    maxLevel: 2,
    totalTokens: nodes.reduce((s, n) => s + n.tokenCount, 0),
    sessionCount: sessions.length
  });
});

export default router;
