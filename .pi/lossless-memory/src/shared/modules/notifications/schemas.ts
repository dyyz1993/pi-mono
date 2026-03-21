import { z } from '@hono/zod-openapi'

export const NotificationTypeSchema = z.enum(['info', 'warning', 'success', 'error'])

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeSchema,
  title: z.string().min(1).max(200),
  message: z.string().max(2000),
  read: z.boolean().default(false),
  createdAt: z.string().datetime(),
})

export const CreateNotificationSchema = z.object({
  type: NotificationTypeSchema,
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  message: z.string().min(1, 'Message is required').max(2000, 'Message too long'),
})

export const NotificationListQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
})

export const SSEEventSchema = z.object({
  event: z.enum(['notification', 'ping', 'connected']),
  data: z.union([NotificationSchema, z.object({ timestamp: z.number() })]),
})

export const UnreadCountEventSchema = z.object({
  count: z.number(),
})

export const AppSSEProtocolSchema = z.object({
  events: z.object({
    notification: NotificationSchema,
    'unread-count': UnreadCountEventSchema,
    ping: z.object({ timestamp: z.number() }),
    connected: z.object({ timestamp: z.number() }),
  }),
})

export const UnreadCountSchema = z.object({
  count: z.number(),
})

export const NotificationIdSchema = z.object({
  id: z.string(),
})

export const NotificationListSchema = z.array(NotificationSchema)

export const MarkAllReadResultSchema = z.object({
  count: z.number(),
})

export const TestNotificationRequestSchema = z.object({
  type: NotificationTypeSchema.optional().default('info'),
})

export type NotificationType = z.infer<typeof NotificationTypeSchema>
export type AppNotification = z.infer<typeof NotificationSchema>
export type CreateNotificationInput = z.infer<typeof CreateNotificationSchema>
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>
export type SSEEvent = z.infer<typeof SSEEventSchema>
export type UnreadCountEvent = z.infer<typeof UnreadCountEventSchema>
export type AppSSEProtocol = z.infer<typeof AppSSEProtocolSchema>
export type UnreadCount = z.infer<typeof UnreadCountSchema>
export type NotificationId = z.infer<typeof NotificationIdSchema>
export type NotificationList = z.infer<typeof NotificationListSchema>
export type MarkAllReadResult = z.infer<typeof MarkAllReadResultSchema>
export type TestNotificationRequest = z.infer<typeof TestNotificationRequestSchema>
