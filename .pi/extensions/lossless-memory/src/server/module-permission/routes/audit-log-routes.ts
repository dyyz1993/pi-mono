import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import { authMiddleware } from '../../middleware/auth'
import { auditLogService } from '../services/audit-log-service'
import { successResponse, errorResponse, success } from '../../utils/route-helpers'
import { AuditLogSchema } from '@shared/modules/audit'

const getAuditLogsRoute = createRoute({
  method: 'get',
  path: '/audit-logs',
  tags: ['audit-logs'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  request: {
    query: z.object({
      limit: z.string().optional(),
      offset: z.string().optional(),
      userId: z.string().optional(),
      action: z.string().optional(),
      resourceType: z.string().optional(),
    }),
  },
  responses: {
    200: successResponse(AuditLogSchema.array(), 'Get audit logs'),
    401: errorResponse('Unauthorized'),
  },
})

const getAuditLogRoute = createRoute({
  method: 'get',
  path: '/audit-logs/:id',
  tags: ['audit-logs'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: successResponse(AuditLogSchema, 'Get audit log by ID'),
    404: errorResponse('Audit log not found'),
    401: errorResponse('Unauthorized'),
  },
})

export const auditLogRoutes = new OpenAPIHono()
  .openapi(getAuditLogsRoute, async c => {
    const query = c.req.valid('query')
    const limit = query.limit ? parseInt(query.limit) : 50
    const offset = query.offset ? parseInt(query.offset) : 0

    if (query.userId || query.action || query.resourceType) {
      const logs = await auditLogService.search({
        userId: query.userId,
        action: query.action,
        resourceType: query.resourceType,
      })
      return c.json(success(logs.slice(offset, offset + limit)), 200)
    }

    const logs = await auditLogService.getAll(limit, offset)
    return c.json(success(logs), 200)
  })
  .openapi(getAuditLogRoute, async c => {
    const { id } = c.req.valid('param')
    const logs = await auditLogService.getAll(1000, 0)
    const log = logs.find(l => l.id === id)

    if (!log) {
      return c.json({ success: false, error: 'Audit log not found' }, 404)
    }

    return c.json(success(log), 200)
  })
