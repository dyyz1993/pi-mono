import { z } from '@hono/zod-openapi'

export const OrderStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'cancelled',
  'disputed',
])

export const OrderSchema = z.object({
  id: z.string(),
  orderNo: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  productName: z.string(),
  amount: z.number(),
  status: OrderStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const CreateOrderSchema = z.object({
  customerName: z.string(),
  customerEmail: z.string().email(),
  productName: z.string(),
  amount: z.number().positive(),
})

export const UpdateOrderSchema = z.object({
  status: OrderStatusSchema.optional(),
})

export const OrderListSchema = z.array(OrderSchema)

export const DeleteResultSchema = z.object({
  message: z.string(),
})

export const ProcessOrderSchema = z.object({
  orderId: z.string(),
})

export const CancelOrderSchema = z.object({
  orderId: z.string(),
  reason: z.string().optional(),
})

export type OrderStatus = z.infer<typeof OrderStatusSchema>
export type Order = z.infer<typeof OrderSchema>
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>
export type UpdateOrderInput = z.infer<typeof UpdateOrderSchema>
export type DeleteResult = z.infer<typeof DeleteResultSchema>
export type ProcessOrderInput = z.infer<typeof ProcessOrderSchema>
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>
