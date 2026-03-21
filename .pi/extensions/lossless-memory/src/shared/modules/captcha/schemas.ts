import { z } from '@hono/zod-openapi'

export const CaptchaResponseSchema = z.object({
  id: z.string(),
  image: z.string(),
})

export const VerifyCaptchaRequestSchema = z.object({
  id: z.string(),
  code: z.string(),
})

export const CaptchaVerifyResponseSchema = z.object({
  message: z.string(),
})

export type CaptchaResponse = z.infer<typeof CaptchaResponseSchema>
export type VerifyCaptchaRequest = z.infer<typeof VerifyCaptchaRequestSchema>
export type CaptchaVerifyResponse = z.infer<typeof CaptchaVerifyResponseSchema>
