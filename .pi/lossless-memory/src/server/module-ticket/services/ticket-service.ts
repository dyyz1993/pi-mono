import type {
  Ticket,
  TicketReply,
  CreateTicketInput,
  UpdateTicketInput,
  ReplyTicketInput,
  TicketStatus,
  TicketPriority,
  TicketCategory,
} from '@shared/modules/ticket'
import { generateTicketNo, randomDate } from '@server/utils/generate'

const PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent']
const STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']
const CATEGORIES: TicketCategory[] = [
  'technical',
  'billing',
  'feature_request',
  'bug_report',
  'general',
]

const CUSTOMERS = [
  { name: '张三', email: 'zhangsan@example.com' },
  { name: '李四', email: 'lisi@example.com' },
  { name: '王五', email: 'wangwu@example.com' },
  { name: '赵六', email: 'zhaoliu@example.com' },
  { name: '钱七', email: 'qianqi@example.com' },
]

const SUBJECTS = [
  '无法登录系统',
  '订单支付失败',
  '功能使用咨询',
  '数据导出问题',
  '账号权限申请',
  '系统性能问题',
  '界面显示异常',
  'API 调用错误',
]

const AGENTS = ['客服小王', '客服小李', '客服小张']

function randomElement<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

const MOCK_TICKETS: Ticket[] = Array.from({ length: 20 }, (_, index) => {
  const customer = randomElement(CUSTOMERS)
  const status = randomElement(STATUSES)
  const priority = randomElement(PRIORITIES)
  const category = randomElement(CATEGORIES)
  const subject = randomElement(SUBJECTS)
  const createdAt = randomDate(new Date('2024-01-01'), new Date())
  const assignedTo = status !== 'open' ? randomElement(AGENTS) : undefined

  const replies: TicketReply[] = []
  if (status !== 'open') {
    const replyCount = Math.floor(Math.random() * 3) + 1
    for (let i = 0; i < replyCount; i++) {
      replies.push({
        id: `reply-${index}-${i}`,
        ticketId: `ticket-${index + 1}`,
        content: `这是第 ${i + 1} 条回复内容，解决了用户的问题。`,
        author: i % 2 === 0 ? randomElement(AGENTS) : customer.name,
        isCustomer: i % 2 !== 0,
        createdAt: randomDate(new Date(createdAt), new Date()),
      })
    }
  }

  return {
    id: `ticket-${index + 1}`,
    ticketNo: generateTicketNo(),
    customerName: customer.name,
    customerEmail: customer.email,
    subject,
    description: `关于${subject}的详细描述，用户遇到了一些问题需要解决。`,
    status,
    priority,
    category,
    assignedTo,
    createdAt,
    updatedAt: replies.length > 0 ? replies[replies.length - 1].createdAt : createdAt,
    replies,
  }
})

export async function getTickets(filters?: {
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
}): Promise<Ticket[]> {
  let result = [...MOCK_TICKETS]

  if (filters?.status) {
    result = result.filter(t => t.status === filters.status)
  }

  if (filters?.priority) {
    result = result.filter(t => t.priority === filters.priority)
  }

  if (filters?.category) {
    result = result.filter(t => t.category === filters.category)
  }

  return result.sort((a, b) => {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  })
}

export async function getTicketById(id: string): Promise<Ticket | null> {
  return MOCK_TICKETS.find(t => t.id === id) || null
}

export async function createTicket(data: CreateTicketInput): Promise<Ticket> {
  const newTicket: Ticket = {
    id: `ticket-${Date.now()}`,
    ticketNo: generateTicketNo(),
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    subject: data.subject,
    description: data.description,
    status: 'open',
    priority: data.priority,
    category: data.category,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    replies: [],
  }

  MOCK_TICKETS.push(newTicket)
  return newTicket
}

export async function updateTicket(id: string, data: UpdateTicketInput): Promise<Ticket | null> {
  const ticket = MOCK_TICKETS.find(t => t.id === id)
  if (ticket) {
    Object.assign(ticket, data, { updatedAt: new Date().toISOString() })
    return ticket
  }
  return null
}

export async function deleteTicket(id: string): Promise<{ message: string }> {
  const index = MOCK_TICKETS.findIndex(t => t.id === id)
  if (index !== -1) {
    MOCK_TICKETS.splice(index, 1)
    return { message: '工单已删除' }
  }
  return { message: '工单不存在' }
}

export async function replyTicket(id: string, data: ReplyTicketInput): Promise<Ticket | null> {
  const ticket = MOCK_TICKETS.find(t => t.id === id)
  if (ticket) {
    const reply: TicketReply = {
      id: `reply-${Date.now()}`,
      ticketId: id,
      content: data.content,
      author: data.author,
      isCustomer: false,
      createdAt: new Date().toISOString(),
    }
    ticket.replies.push(reply)
    ticket.updatedAt = reply.createdAt
    if (ticket.status === 'open') {
      ticket.status = 'in_progress'
    }
    return ticket
  }
  return null
}

export async function closeTicket(id: string): Promise<Ticket | null> {
  const ticket = MOCK_TICKETS.find(t => t.id === id)
  if (ticket) {
    ticket.status = 'closed'
    ticket.updatedAt = new Date().toISOString()
    return ticket
  }
  return null
}
