import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'
import { roles } from './roles'
import { permissions } from './permissions'

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  table => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
  })
)

export type RolePermission = typeof rolePermissions.$inferSelect
export type NewRolePermission = typeof rolePermissions.$inferInsert
