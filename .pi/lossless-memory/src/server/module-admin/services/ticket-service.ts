import { generateTicketNo, randomDate } from '@server/utils/generate'

export interface Ticket {
  id: string
  ticketNo: string
  customerName: string
  customerEmail: string
  subject: string
  description: string
  status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  category: 'technical' | 'billing' | 'feature_request' | 'bug_report' | 'general'
  assignedTo?: string
  createdAt: string
  updatedAt: string
  replies: TicketReply[]
}

export interface TicketReply {
  id: string
  ticketId: string
  content: string
  author: string
  isCustomer: boolean
  createdAt: string
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const
const CATEGORIES = ['technical', 'billing', 'feature_request', 'bug_report', 'general'] as const

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

export const MOCK_TICKETS: Ticket[] = Array.from({ length: 20 }, (_, index) => {
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

export function getTickets(filters?: {
  status?: Ticket['status']
  priority?: Ticket['priority']
  category?: Ticket['category']
}): Ticket[] {
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

export function getTicketById(id: string): Ticket | null {
  return MOCK_TICKETS.find(t => t.id === id) || null
}

export function replyTicket(id: string, content: string, author: string): Ticket | null {
  const ticket = MOCK_TICKETS.find(t => t.id === id)
  if (ticket) {
    const reply: TicketReply = {
      id: `reply-${Date.now()}`,
      ticketId: id,
      content,
      author,
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

export function closeTicket(id: string): Ticket | null {
  const ticket = MOCK_TICKETS.find(t => t.id === id)
  if (ticket) {
    ticket.status = 'closed'
    ticket.updatedAt = new Date().toISOString()
    return ticket
  }
  return null
}
