import { z } from '@hono/zod-openapi'

export const TicketStatusSchema = z.enum([
  'open',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
])
export const TicketPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
export const TicketCategorySchema = z.enum([
  'technical',
  'billing',
  'feature_request',
  'bug_report',
  'general',
])

export const TicketReplySchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  content: z.string(),
  author: z.string(),
  isCustomer: z.boolean(),
  createdAt: z.string(),
})

export const TicketSchema = z.object({
  id: z.string(),
  ticketNo: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  subject: z.string(),
  description: z.string(),
  status: TicketStatusSchema,
  priority: TicketPrioritySchema,
  category: TicketCategorySchema,
  assignedTo: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  replies: z.array(TicketReplySchema),
})

export const CreateTicketSchema = z.object({
  customerName: z.string(),
  customerEmail: z.string().email(),
  subject: z.string(),
  description: z.string(),
  category: TicketCategorySchema,
  priority: TicketPrioritySchema,
})

export const UpdateTicketSchema = z.object({
  status: TicketStatusSchema.optional(),
  assignedTo: z.string().optional(),
})

export const ReplyTicketSchema = z.object({
  content: z.string(),
  author: z.string(),
})

export const TicketListSchema = z.array(TicketSchema)

export const DeleteResultSchema = z.object({
  message: z.string(),
})

export type TicketStatus = z.infer<typeof TicketStatusSchema>
export type TicketPriority = z.infer<typeof TicketPrioritySchema>
export type TicketCategory = z.infer<typeof TicketCategorySchema>
export type TicketReply = z.infer<typeof TicketReplySchema>
export type Ticket = z.infer<typeof TicketSchema>
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>
export type ReplyTicketInput = z.infer<typeof ReplyTicketSchema>
export type DeleteResult = z.infer<typeof DeleteResultSchema>
