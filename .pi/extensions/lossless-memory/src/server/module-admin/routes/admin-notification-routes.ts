import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { authMiddleware, type AuthUser } from '../../middleware/auth'
import * as adminService from '../services/admin-service'
import { successResponse, errorResponse, success } from '../../utils/route-helpers'
import { Role } from '@shared/modules/admin'
import {
  NotificationSchema,
  NotificationListSchema,
  UnreadCountSchema,
  MarkAllReadResultSchema,
  TestNotificationRequestSchema,
  AppSSEProtocolSchema,
} from '@shared/modules/notifications'
import { SuccessSchema } from '@shared/modules/admin'

const getNotificationsRoute = createRoute({
  method: 'get',
  path: '/admin/notifications',
  tags: ['notifications'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  request: {
    query: z.object({
      unreadOnly: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: successResponse(NotificationListSchema, 'Get notifications'),
    401: errorResponse('Unauthorized'),
  },
})

const getUnreadCountRoute = createRoute({
  method: 'get',
  path: '/admin/notifications/unread-count',
  tags: ['notifications'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  responses: {
    200: successResponse(UnreadCountSchema, 'Get unread count'),
    401: errorResponse('Unauthorized'),
  },
})

const markNotificationReadRoute = createRoute({
  method: 'put',
  path: '/admin/notifications/:id/read',
  tags: ['notifications'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: successResponse(SuccessSchema, 'Notification marked as read'),
    401: errorResponse('Unauthorized'),
    404: errorResponse('Notification not found'),
  },
})

const markAllNotificationsReadRoute = createRoute({
  method: 'put',
  path: '/admin/notifications/read-all',
  tags: ['notifications'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  responses: {
    200: successResponse(MarkAllReadResultSchema, 'All notifications marked as read'),
    401: errorResponse('Unauthorized'),
  },
})

const sendTestNotificationRoute = createRoute({
  method: 'post',
  path: '/admin/notifications/test',
  tags: ['notifications'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredRole: Role.SUPER_ADMIN })],
  request: {
    body: {
      content: {
        'application/json': {
          schema: TestNotificationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(NotificationSchema, 'Test notification sent'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
  },
})

const notificationSSERoute = createRoute({
  method: 'get',
  path: '/admin/notifications/stream',
  tags: ['notifications'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  responses: {
    200: {
      content: {
        'text/event-stream': { schema: AppSSEProtocolSchema },
      },
      description: 'SSE stream for admin notifications',
    },
    401: errorResponse('Unauthorized'),
  },
})

export const adminNotificationRoutes = new OpenAPIHono<{ Variables: { authUser: AuthUser } }>()
  .openapi(getNotificationsRoute, async c => {
    const { unreadOnly, limit } = c.req.valid('query')
    const notifications = adminService.getNotifications({
      unreadOnly: unreadOnly === 'true',
      limit: limit ? parseInt(limit, 10) : 20,
    })
    return c.json(success(notifications), 200)
  })
  .openapi(getUnreadCountRoute, async c => {
    const count = adminService.getUnreadCount()
    return c.json(success({ count }), 200)
  })
  .openapi(markNotificationReadRoute, async c => {
    const { id } = c.req.valid('param')
    const marked = await adminService.markNotificationRead(id)
    if (!marked) {
      return c.json({ success: false, error: 'Notification not found' }, 404)
    }
    return c.json(success({}), 200)
  })
  .openapi(markAllNotificationsReadRoute, async c => {
    const count = await adminService.markAllNotificationsRead()
    return c.json(success({ count }), 200)
  })
  .openapi(sendTestNotificationRoute, async c => {
    const { type } = c.req.valid('json')
    const notification = await adminService.sendTestNotification(type)
    return c.json(success(notification), 200)
  })
  .openapi(notificationSSERoute, async c => {
    const env = c.env as { REALTIME_DO?: DurableObjectNamespace } | undefined
    if (env?.REALTIME_DO) {
      const id = env.REALTIME_DO.idFromName('global')
      const stub = env.REALTIME_DO.get(id)
      const doRequest = new Request(c.req.url, {
        method: c.req.method,
        headers: c.req.raw.headers,
      })
      return stub.fetch(doRequest)
    }

    const { getRuntimeAdapter } = await import('@server/core/runtime')
    const adapter = getRuntimeAdapter()
    if ('handleSSERequest' in adapter && typeof adapter.handleSSERequest === 'function') {
      const response = await (
        adapter as { handleSSERequest: () => Response | Promise<Response> }
      ).handleSSERequest()
      return response
    }
    return c.json({ success: false, error: 'SSE not supported' }, 500)
  })
