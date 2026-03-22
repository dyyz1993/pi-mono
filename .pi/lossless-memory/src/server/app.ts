/**
 * Server App Entry
 */

import { Hono } from 'hono'
import * as LosslessService from './module-lossless-memory/services/lossless-service'

export function createApp() {
  const app = new Hono()
  
  // GET /api/lossless/sessions
  app.get('/api/lossless/sessions', async c => {
    const sessions = await LosslessService.getSessions()
    return c.json({ data: sessions, timestamp: Date.now() })
  })
  
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
  
  // GET /api/lossless/nodes
  app.get('/api/lossless/nodes', async c => {
    const nodes = await LosslessService.getNodes()
    return c.json({ data: nodes, timestamp: Date.now() })
  })
  
  // GET /api/lossless/messages
  app.get('/api/lossless/messages', async c => {
    const sessionPath = c.req.query('path')
    if (!sessionPath) {
      return c.json({ data: [], timestamp: Date.now() })
    }
    const messages = await LosslessService.getMessages(sessionPath)
    return c.json({ data: messages, timestamp: Date.now() })
  })
  
  return app
}
