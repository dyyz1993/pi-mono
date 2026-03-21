import { z } from '@hono/zod-openapi'

export const ContentCategorySchema = z.enum([
  'article',
  'announcement',
  'tutorial',
  'news',
  'policy',
])
export const ContentStatusSchema = z.enum(['draft', 'published', 'archived'])

export const ContentSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  category: ContentCategorySchema,
  status: ContentStatusSchema,
  author: z.string(),
  tags: z.array(z.string()),
  viewCount: z.number(),
  likeCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().optional(),
})

export const CreateContentSchema = z.object({
  title: z.string(),
  content: z.string(),
  category: ContentCategorySchema,
  tags: z.array(z.string()).optional(),
})

export const UpdateContentSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  category: ContentCategorySchema.optional(),
  tags: z.array(z.string()).optional(),
  status: ContentStatusSchema.optional(),
})

export const ContentListSchema = z.array(ContentSchema)

export const DeleteResultSchema = z.object({
  message: z.string(),
})

export type ContentCategory = z.infer<typeof ContentCategorySchema>
export type ContentStatus = z.infer<typeof ContentStatusSchema>
export type Content = z.infer<typeof ContentSchema>
export type CreateContentInput = z.infer<typeof CreateContentSchema>
export type UpdateContentInput = z.infer<typeof UpdateContentSchema>
export type DeleteResult = z.infer<typeof DeleteResultSchema>
