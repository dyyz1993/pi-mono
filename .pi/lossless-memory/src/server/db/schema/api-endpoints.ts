import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core'

export const routes = sqliteTable(
  'routes',
  {
    id: text('id').primaryKey(),
    path: text('path').notNull(),
    method: text('method').notNull(),
    name: text('name'),
    description: text('description'),
    module: text('module'),
    isPublic: integer('is_public', { mode: 'boolean' }).default(false),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  table => ({
    pathMethodUnique: unique().on(table.path, table.method),
  })
)

export type Route = typeof routes.$inferSelect
export type NewRoute = typeof routes.$inferInsert
