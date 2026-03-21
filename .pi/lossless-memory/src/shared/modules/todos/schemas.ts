import { z } from '@hono/zod-openapi'

export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed'])

export const TodoSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(1000, 'Description too long').optional(),
  status: TodoStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const CreateTodoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(1000, 'Description too long').optional(),
})

export const UpdateTodoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long').optional(),
  description: z.string().max(1000, 'Description too long').optional(),
  status: TodoStatusSchema.optional(),
})

export const TodoIdSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const TodoIdResponseSchema = z.object({
  id: z.number(),
})

export const TodoAttachmentSchema = z.object({
  id: z.number().int().positive(),
  todoId: z.number().int().positive(),
  fileName: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int().positive(),
  path: z.string(),
  uploadedBy: z.string().optional(),
  createdAt: z.string().datetime(),
})

export const TodoAttachmentListSchema = z.array(TodoAttachmentSchema)

export const TodoWithAttachmentsSchema = TodoSchema.extend({
  attachments: TodoAttachmentListSchema,
})

export const UploadFileSchema = z.object({
  file: z.file().openapi({ type: 'string', format: 'binary' }),
})

export const AttachmentIdResponseSchema = z.object({
  id: z.number(),
})

export type TodoStatus = z.infer<typeof TodoStatusSchema>
export type Todo = z.infer<typeof TodoSchema>
export type CreateTodoInput = z.infer<typeof CreateTodoSchema>
export type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>
export type TodoIdResponse = z.infer<typeof TodoIdResponseSchema>
export type TodoAttachment = z.infer<typeof TodoAttachmentSchema>
export type TodoWithAttachments = z.infer<typeof TodoWithAttachmentsSchema>
