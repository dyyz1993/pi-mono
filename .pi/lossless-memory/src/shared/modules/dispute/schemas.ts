import { z } from '@hono/zod-openapi'

export const DisputeTypeSchema = z.enum([
  'refund',
  'product_quality',
  'service_quality',
  'delivery',
  'other',
])
export const DisputeStatusSchema = z.enum(['pending', 'investigating', 'resolved', 'rejected'])

export const DisputeSchema = z.object({
  id: z.string(),
  disputeNo: z.string(),
  orderId: z.string(),
  orderNo: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  type: DisputeTypeSchema,
  status: DisputeStatusSchema,
  description: z.string(),
  resolution: z.string().optional(),
  amount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().optional(),
  resolvedBy: z.string().optional(),
})

export const CreateDisputeSchema = z.object({
  orderId: z.string(),
  orderNo: z.string(),
  customerName: z.string(),
  customerEmail: z.string().email(),
  type: DisputeTypeSchema,
  description: z.string(),
  amount: z.number().positive(),
})

export const UpdateDisputeSchema = z.object({
  status: DisputeStatusSchema.optional(),
  resolution: z.string().optional(),
})

export const ResolveDisputeSchema = z.object({
  resolution: z.string(),
  resolvedBy: z.string(),
})

export const DisputeListSchema = z.array(DisputeSchema)

export const DeleteResultSchema = z.object({
  message: z.string(),
})

export type DisputeType = z.infer<typeof DisputeTypeSchema>
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>
export type Dispute = z.infer<typeof DisputeSchema>
export type CreateDisputeInput = z.infer<typeof CreateDisputeSchema>
export type UpdateDisputeInput = z.infer<typeof UpdateDisputeSchema>
export type ResolveDisputeInput = z.infer<typeof ResolveDisputeSchema>
export type DeleteResult = z.infer<typeof DeleteResultSchema>
