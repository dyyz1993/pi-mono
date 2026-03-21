/**
 * Lossless Memory API Routes
 */

import { Hono } from 'hono';
import { losslessMemoryService } from './lossless-memory.service';

const router = new Hono();

// 获取项目列表
router.get('/api/projects', (c) => {
  // TODO: 从文件系统扫描项目
  return c.json([{
    path: '/Users/xuyingzhou/Project/temporary/pi-mono',
    name: 'pi-mono',
    sessions: 1,
    nodes: 0,
    tokens: 0,
    lastSeen: Date.now()
  }]);
});

// 获取完整数据
router.get('/api/data', (c) => {
  const nodes = losslessMemoryService.getNodes();
  const sessions = losslessMemoryService.getSessions();
  const stats = losslessMemoryService.getStats();
  
  return c.json({ stats, nodes, sessions });
});

// 获取节点列表
router.get('/api/nodes', (c) => {
  return c.json(losslessMemoryService.getNodes());
});

// 获取会话列表
router.get('/api/sessions', (c) => {
  return c.json(losslessMemoryService.getSessions());
});

// 获取统计
router.get('/api/stats', (c) => {
  return c.json(losslessMemoryService.getStats());
});

// 插件事件：节点创建（内部使用）
router.post('/api/events/node-created', async (c) => {
  const body = await c.req.json();
  losslessMemoryService.onNodeCreated(body);
  return c.json({ success: true });
});

// 插件事件：会话开始（内部使用）
router.post('/api/events/session-start', async (c) => {
  const body = await c.req.json();
  losslessMemoryService.onSessionStart(body.sessionId, body.sessionPath);
  return c.json({ success: true });
});

export default router;
