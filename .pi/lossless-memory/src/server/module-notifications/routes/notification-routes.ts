import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import * as notificationService from '../services/notification-service'
import {
  NotificationSchema,
  CreateNotificationSchema,
  AppSSEProtocolSchema,
  UnreadCountSchema,
  NotificationIdSchema,
} from '@shared/schemas'
import {
  successResponse,
  errorResponse,
  listResponse,
  success,
  created,
} from '@server/utils/route-helpers'
import { NotFoundError } from '@server/utils/app-error'
import { getRuntimeAdapter } from '@server/core/runtime'

const streamRoute = createRoute({
  method: 'get',
  path: '/notifications/stream',
  tags: ['notifications'],
  responses: {
    200: {
      content: {
        'text/event-stream': { schema: AppSSEProtocolSchema },
      },
      description: 'SSE stream for notifications',
    },
    500: errorResponse('Internal server error'),
  },
})

const listRoute = createRoute({
  method: 'get',
  path: '/notifications',
  tags: ['notifications'],
  request: {
    query: z.object({
      unreadOnly: z.string().optional(),
      limit: z.string().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: listResponse(NotificationSchema, 'List notifications'),
    500: errorResponse('Internal server error'),
  },
})

const unreadCountRoute = createRoute({
  method: 'get',
  path: '/notifications/unread-count',
  tags: ['notifications'],
  responses: {
    200: successResponse(UnreadCountSchema, 'Get unread count'),
    500: errorResponse('Internal server error'),
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/notifications/{id}',
  tags: ['notifications'],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: successResponse(NotificationSchema, 'Get notification by ID'),
    404: errorResponse('Notification not found'),
  },
})

const createRouteDef = createRoute({
  method: 'post',
  path: '/notifications',
  tags: ['notifications'],
  request: {
    body: {
      content: { 'application/json': { schema: CreateNotificationSchema } },
    },
  },
  responses: {
    201: successResponse(NotificationSchema, 'Create notification'),
    400: errorResponse('Invalid input'),
  },
})

const markAllReadRoute = createRoute({
  method: 'patch',
  path: '/notifications/read-all',
  tags: ['notifications'],
  responses: {
    200: successResponse(UnreadCountSchema, 'Mark all as read'),
    500: errorResponse('Internal server error'),
  },
})

const markReadRoute = createRoute({
  method: 'patch',
  path: '/notifications/{id}/read',
  tags: ['notifications'],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: successResponse(NotificationSchema, 'Mark as read'),
    404: errorResponse('Notification not found'),
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/notifications/{id}',
  tags: ['notifications'],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: successResponse(NotificationIdSchema, 'Delete notification'),
    404: errorResponse('Notification not found'),
  },
})

export const notificationRoutes = new OpenAPIHono()
  .openapi(streamRoute, async c => {
    // In Cloudflare environment, route SSE to Durable Object for proper broadcast support
    const env = c.env as { REALTIME_DO?: DurableObjectNamespace } | undefined
    if (env?.REALTIME_DO) {
      const id = env.REALTIME_DO.idFromName('global')
      const stub = env.REALTIME_DO.get(id)
      // Forward the SSE request to the Durable Object
      const doRequest = new Request(c.req.url, {
        method: c.req.method,
        headers: c.req.raw.headers,
      })
      return stub.fetch(doRequest)
    }

    // Fallback for Node environment
    const adapter = getRuntimeAdapter()
    if ('handleSSERequest' in adapter && typeof adapter.handleSSERequest === 'function') {
      const response = await (
        adapter as { handleSSERequest: () => Response | Promise<Response> }
      ).handleSSERequest()
      return response
    }
    return c.json({ success: false, error: 'SSE not supported' }, 500)
  })
  .openapi(listRoute, async c => {
    const query = c.req.valid('query')
    const result = notificationService.listNotifications({
      unreadOnly: query.unreadOnly === 'true',
      limit: query.limit ? parseInt(query.limit) : 20,
      cursor: query.cursor,
    })
    return c.json(success({ items: result.data, nextCursor: result.nextCursor }), 200)
  })
  .openapi(unreadCountRoute, async c => {
    const count = notificationService.getUnreadCount()
    return c.json(success({ count }), 200)
  })
  .openapi(getRoute, async c => {
    const { id } = c.req.valid('param')
    const notification = notificationService.getNotification(id)
    if (!notification) throw new NotFoundError('Notification', id)
    return c.json(success(notification), 200)
  })
  .openapi(createRouteDef, async c => {
    const data = c.req.valid('json')
    const notification = await notificationService.createNotificationAndBroadcast(data)

    return c.json(created(notification), 201)
  })
  .openapi(markAllReadRoute, async c => {
    const count = notificationService.markAllAsRead()
    return c.json(success({ count }), 200)
  })
  .openapi(markReadRoute, async c => {
    const { id } = c.req.valid('param')
    const notification = notificationService.markAsRead(id)
    if (!notification) throw new NotFoundError('Notification', id)
    return c.json(success(notification), 200)
  })
  .openapi(deleteRoute, async c => {
    const { id } = c.req.valid('param')
    const deleted = notificationService.deleteNotification(id)
    if (!deleted) throw new NotFoundError('Notification', id)
    return c.json(success({ id }), 200)
  })
