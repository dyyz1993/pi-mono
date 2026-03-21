/**
 * Server App Entry
 */

import { Hono } from 'hono'
import * as LosslessService from './module-lossless-memory/services/lossless-service'

// ============================================================================
// 创建 App
// ============================================================================

export function createApp() {
  const app = new Hono()
  
  // ============================================================================
  // Lossless Memory Routes
  // ============================================================================
  
  // GET /api/lossless/projects
  app.get('/api/lossless/projects', async c => {
    const projects = await LosslessService.getProjects()
    return c.json({ data: projects, timestamp: Date.now() })
  })
  
  // GET /api/lossless/stats
  app.get('/api/lossless/stats', async c => {
    const stats = await LosslessService.getOverviewStats()
    return c.json({ data: stats, timestamp: Date.now() })
  })
  
  // GET /api/lossless/sessions
  app.get('/api/lossless/sessions', async c => {
    const projectPath = c.req.query('projectPath')
    const sessions = await LosslessService.getSessions(projectPath)
    return c.json({ data: sessions, timestamp: Date.now() })
  })
  
  // GET /api/lossless/nodes
  app.get('/api/lossless/nodes', async c => {
    const sessionId = c.req.query('sessionId')
    const level = c.req.query('level')
    const nodes = await LosslessService.getNodes(
      sessionId,
      level !== undefined ? parseInt(level) : undefined
    )
    return c.json({ data: nodes, timestamp: Date.now() })
  })
  
  return app
}
