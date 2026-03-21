import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'
import { permissions } from './permissions'
import { routes } from './api-endpoints'

export const permissionRouteMappings = sqliteTable(
  'permission_routes',
  {
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    routeId: text('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  table => ({
    pk: primaryKey({ columns: [table.permissionId, table.routeId] }),
  })
)

export type PermissionRouteMapping = typeof permissionRouteMappings.$inferSelect
export type NewPermissionRouteMapping = typeof permissionRouteMappings.$inferInsert
