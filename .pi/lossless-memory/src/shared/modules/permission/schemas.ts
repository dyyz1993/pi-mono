import { z } from '@hono/zod-openapi'
import { Role, Permission } from './permissions'

export const RoleEnum = z.nativeEnum(Role)

export const PermissionEnum = z.nativeEnum(Permission)

export const RoleInfoSchema = z.object({
  role: RoleEnum,
  label: z.string(),
  permissions: z.array(PermissionEnum),
})

export const PermissionInfoSchema = z.object({
  permission: PermissionEnum,
  label: z.string(),
  category: z.string(),
})

export const UserPermissionsSchema = z.object({
  userId: z.string(),
  role: RoleEnum,
  permissions: z.array(PermissionEnum),
})

export const MenuItemSchema = z.object({
  path: z.string(),
  label: z.string(),
  icon: z.string(),
  permissions: z.array(PermissionEnum),
  children: z
    .array(
      z.object({
        path: z.string(),
        label: z.string(),
        icon: z.string(),
        permissions: z.array(PermissionEnum),
      })
    )
    .optional(),
})

export const PageActionSchema = z.object({
  key: z.string(),
  label: z.string(),
  permissions: z.array(PermissionEnum),
  mode: z.enum(['all', 'any']),
})

export const PagePermissionConfigSchema = z.object({
  path: z.string(),
  label: z.string(),
  requiredPermissions: z.array(PermissionEnum),
  actions: z.array(PageActionSchema),
})

export const PermissionCategorySchema = z.object({
  label: z.string(),
  permissions: z.array(PermissionEnum),
})

export const RoleListSchema = z.array(RoleInfoSchema)

export const PermissionListSchema = z.array(PermissionInfoSchema)

export const MenuConfigSchema = z.array(MenuItemSchema)

export const PagePermissionsSchema = z.array(PagePermissionConfigSchema)

export const PermissionCategoriesSchema = z.record(z.string(), PermissionCategorySchema)

export const RoleLabelsSchema = z.record(RoleEnum, z.string())

export const PermissionLabelsSchema = z.record(PermissionEnum, z.string())

export type RoleType = z.infer<typeof RoleEnum>
export type PermissionType = z.infer<typeof PermissionEnum>
export type RoleInfo = z.infer<typeof RoleInfoSchema>
export type PermissionInfo = z.infer<typeof PermissionInfoSchema>
export type UserPermissions = z.infer<typeof UserPermissionsSchema>
export type MenuItem = z.infer<typeof MenuItemSchema>
export type PageAction = z.infer<typeof PageActionSchema>
export type PagePermissionConfig = z.infer<typeof PagePermissionConfigSchema>
export type PermissionCategory = z.infer<typeof PermissionCategorySchema>
