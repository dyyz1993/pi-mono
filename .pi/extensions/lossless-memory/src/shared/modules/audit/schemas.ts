import { z } from '@hono/zod-openapi'

export const AuditLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z
    .union([z.string(), z.date()])
    .transform(v => (v instanceof Date ? v.toISOString() : v)),
})

export type AuditLogType = z.infer<typeof AuditLogSchema>
