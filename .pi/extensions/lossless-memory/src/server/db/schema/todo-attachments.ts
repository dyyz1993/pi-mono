import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { todos } from './todos'

export const todoAttachments = sqliteTable('todo_attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  todoId: integer('todo_id')
    .notNull()
    .references(() => todos.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  path: text('path').notNull(),
  uploadedBy: text('uploaded_by'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

export type TodoAttachmentTable = typeof todoAttachments.$inferSelect
export type NewTodoAttachment = typeof todoAttachments.$inferInsert
