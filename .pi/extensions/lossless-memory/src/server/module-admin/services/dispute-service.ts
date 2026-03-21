import { generateDisputeNo, randomDate } from '@server/utils/generate'

export interface Dispute {
  id: string
  disputeNo: string
  orderId: string
  orderNo: string
  customerName: string
  customerEmail: string
  type: 'refund' | 'product_quality' | 'service_quality' | 'delivery' | 'other'
  status: 'pending' | 'investigating' | 'resolved' | 'rejected'
  description: string
  resolution?: string
  amount: number
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  resolvedBy?: string
}

const DISPUTE_TYPES = ['refund', 'product_quality', 'service_quality', 'delivery', 'other'] as const
const DISPUTE_STATUSES = ['pending', 'investigating', 'resolved', 'rejected'] as const

const DISPUTE_DESCRIPTIONS = [
  '商品与描述不符，要求退款',
  '商品质量问题，要求换货',
  '服务态度差，要求赔偿',
  '配送延迟，要求补偿',
  '订单金额错误，要求更正',
]

const RESOLUTIONS = [
  '已同意退款，3-5个工作日内到账',
  '已安排换货，预计3天内送达',
  '已发放优惠券作为补偿',
  '已部分退款，问题已解决',
  '经核实，驳回争议申请',
]

function randomElement<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

export const MOCK_DISPUTES: Dispute[] = Array.from({ length: 15 }, (_, index) => {
  const type = randomElement(DISPUTE_TYPES)
  const status = randomElement(DISPUTE_STATUSES)
  const createdAt = randomDate(new Date('2024-01-01'), new Date())
  const isResolved = status === 'resolved' || status === 'rejected'

  return {
    id: `dispute-${index + 1}`,
    disputeNo: generateDisputeNo(),
    orderId: `order-${Math.floor(Math.random() * 25) + 1}`,
    orderNo: `ORD${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    customerName: ['张三', '李四', '王五', '赵六', '钱七'][index % 5],
    customerEmail: ['zhangsan', 'lisi', 'wangwu', 'zhaoliu', 'qianqi'][index % 5] + '@example.com',
    type,
    status,
    description: randomElement(DISPUTE_DESCRIPTIONS),
    resolution: isResolved ? randomElement(RESOLUTIONS) : undefined,
    amount: Math.floor(Math.random() * 5000) + 100,
    createdAt,
    updatedAt: isResolved ? randomDate(new Date(createdAt), new Date()) : createdAt,
    resolvedAt: isResolved ? randomDate(new Date(createdAt), new Date()) : undefined,
    resolvedBy: isResolved ? '客服小王' : undefined,
  }
})

export function getDisputes(filters?: {
  status?: Dispute['status']
  type?: Dispute['type']
}): Dispute[] {
  let result = [...MOCK_DISPUTES]

  if (filters?.status) {
    result = result.filter(d => d.status === filters.status)
  }

  if (filters?.type) {
    result = result.filter(d => d.type === filters.type)
  }

  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function getDisputeById(id: string): Dispute | null {
  return MOCK_DISPUTES.find(d => d.id === id) || null
}

export function investigateDispute(id: string): Dispute | null {
  const dispute = MOCK_DISPUTES.find(d => d.id === id)
  if (dispute && dispute.status === 'pending') {
    dispute.status = 'investigating'
    dispute.updatedAt = new Date().toISOString()
    return dispute
  }
  return null
}

export function resolveDispute(id: string, resolution: string, resolvedBy: string): Dispute | null {
  const dispute = MOCK_DISPUTES.find(d => d.id === id)
  if (dispute && (dispute.status === 'pending' || dispute.status === 'investigating')) {
    dispute.status = 'resolved'
    dispute.resolution = resolution
    dispute.resolvedAt = new Date().toISOString()
    dispute.resolvedBy = resolvedBy
    dispute.updatedAt = dispute.resolvedAt
    return dispute
  }
  return null
}

export function rejectDispute(id: string, reason: string, rejectedBy: string): Dispute | null {
  const dispute = MOCK_DISPUTES.find(d => d.id === id)
  if (dispute && (dispute.status === 'pending' || dispute.status === 'investigating')) {
    dispute.status = 'rejected'
    dispute.resolution = reason
    dispute.resolvedAt = new Date().toISOString()
    dispute.resolvedBy = rejectedBy
    dispute.updatedAt = dispute.resolvedAt
    return dispute
  }
  return null
}
