/**
 * Lossless Memory Routes
 */

import { OpenAPIHono } from '@hono/zod-openapi'
import * as LosslessService from '../services/lossless-service'
import type { Project, OverviewStats, SessionIndex, MemoryNode } from '@shared/types'

// ============================================================================
// Routes
// ============================================================================

export const losslessRoutes = new OpenAPIHono()

// GET /api/lossless/projects
losslessRoutes.get('/api/lossless/projects', async c => {
  const projects = await LosslessService.getProjects()
  return c.json({ data: projects, timestamp: Date.now() })
})

// GET /api/lossless/stats
losslessRoutes.get('/api/lossless/stats', async c => {
  const stats = await LosslessService.getOverviewStats()
  return c.json({ data: stats, timestamp: Date.now() })
})

// GET /api/lossless/sessions
losslessRoutes.get('/api/lossless/sessions', async c => {
  const projectPath = c.req.query('projectPath')
  const sessions = await LosslessService.getSessions(projectPath)
  return c.json({ data: sessions, timestamp: Date.now() })
})

// GET /api/lossless/nodes
losslessRoutes.get('/api/lossless/nodes', async c => {
  const sessionId = c.req.query('sessionId')
  const level = c.req.query('level')
  const nodes = await LosslessService.getNodes(
    sessionId,
    level !== undefined ? parseInt(level) : undefined
  )
  return c.json({ data: nodes, timestamp: Date.now() })
})
