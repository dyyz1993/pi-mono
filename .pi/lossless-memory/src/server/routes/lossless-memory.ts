import { Hono } from 'hono';

const router = new Hono();

router.get('/api/projects', (c) => {
  return c.json([{
    path: '/Users/xuyingzhou/Project/temporary/pi-mono',
    name: 'pi-mono',
    sessions: 1,
    nodes: 0,
    tokens: 0,
    lastSeen: Date.now()
  }]);
});

router.get('/api/data', (c) => {
  return c.json({
    stats: { nodeCount: 0, maxLevel: 0, totalTokens: 0, sessionCount: 0 },
    nodes: [],
    sessions: []
  });
});

router.get('/api/nodes', (c) => {
  return c.json([]);
});

router.get('/api/sessions', (c) => {
  return c.json([]);
});

export default router;
