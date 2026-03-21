import { z } from '@hono/zod-openapi'

const dateStringSchema = z.union([z.string(), z.date(), z.null()]).transform(v => {
  if (v instanceof Date) return v.toISOString()
  if (v === null) return new Date().toISOString()
  return v
})

export const RoleSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  label: z.string(),
  description: z.string().optional().nullable(),
  isSystem: z.boolean().nullable(),
  isActive: z.boolean().nullable(),
  sortOrder: z.number().nullable(),
  createdAt: dateStringSchema,
  updatedAt: dateStringSchema,
})

export const CreateRoleSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().optional(),
})

export const UpdateRoleSchema = z.object({
  name: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  sortOrder: z.number().optional(),
})

export const UpdateRolePermissionsSchema = z.object({
  permissionIds: z.array(z.string()),
})

export const SuccessSchema = z.object({})

export type RoleType = z.infer<typeof RoleSchema>
export type CreateRoleType = z.infer<typeof CreateRoleSchema>
export type UpdateRoleType = z.infer<typeof UpdateRoleSchema>
