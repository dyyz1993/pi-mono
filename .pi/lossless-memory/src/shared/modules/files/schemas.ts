import { z } from '@hono/zod-openapi'

export const FileDownloadSchema = z.object({
  namespace: z.string(),
  filename: z.string(),
})

export const PrivateFileQuerySchema = z.object({
  expiry: z.string().transform(Number),
  signature: z.string(),
})

export const PublicFileUrlSchema = z.object({
  url: z.string(),
})

export const PrivateFileUrlSchema = z.object({
  url: z.string(),
  expiry: z.number(),
})

export const GenerateUrlRequestSchema = z.object({
  namespace: z.string(),
  filename: z.string(),
  isPrivate: z.boolean().optional().default(false),
  expirySeconds: z.number().optional(),
})

export const FileUrlResponseSchema = z.union([PublicFileUrlSchema, PrivateFileUrlSchema])

export const EmptySchema = z.object({})
