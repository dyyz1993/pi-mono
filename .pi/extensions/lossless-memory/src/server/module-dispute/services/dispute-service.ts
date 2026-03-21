import type {
  Dispute,
  CreateDisputeInput,
  UpdateDisputeInput,
  ResolveDisputeInput,
  DisputeType,
  DisputeStatus,
} from '@shared/modules/dispute'
import { generateDisputeNo, randomDate } from '@server/utils/generate'

const DISPUTE_TYPES: DisputeType[] = [
  'refund',
  'product_quality',
  'service_quality',
  'delivery',
  'other',
]
const DISPUTE_STATUSES: DisputeStatus[] = ['pending', 'investigating', 'resolved', 'rejected']

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

const MOCK_DISPUTES: Dispute[] = Array.from({ length: 15 }, (_, index) => {
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

export async function getDisputes(filters?: {
  status?: DisputeStatus
  type?: DisputeType
}): Promise<Dispute[]> {
  let result = [...MOCK_DISPUTES]

  if (filters?.status) {
    result = result.filter(d => d.status === filters.status)
  }

  if (filters?.type) {
    result = result.filter(d => d.type === filters.type)
  }

  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function getDisputeById(id: string): Promise<Dispute | null> {
  return MOCK_DISPUTES.find(d => d.id === id) || null
}

export async function createDispute(data: CreateDisputeInput): Promise<Dispute> {
  const newDispute: Dispute = {
    id: `dispute-${Date.now()}`,
    disputeNo: generateDisputeNo(),
    orderId: data.orderId,
    orderNo: data.orderNo,
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    type: data.type,
    status: 'pending',
    description: data.description,
    amount: data.amount,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  MOCK_DISPUTES.push(newDispute)
  return newDispute
}

export async function updateDispute(id: string, data: UpdateDisputeInput): Promise<Dispute | null> {
  const dispute = MOCK_DISPUTES.find(d => d.id === id)
  if (dispute) {
    Object.assign(dispute, data, { updatedAt: new Date().toISOString() })
    return dispute
  }
  return null
}

export async function deleteDispute(id: string): Promise<{ success: boolean; message: string }> {
  const index = MOCK_DISPUTES.findIndex(d => d.id === id)
  if (index !== -1) {
    MOCK_DISPUTES.splice(index, 1)
    return { success: true, message: '争议已删除' }
  }
  return { success: false, message: '争议不存在' }
}

export async function investigateDispute(id: string): Promise<Dispute | null> {
  const dispute = MOCK_DISPUTES.find(d => d.id === id)
  if (dispute && dispute.status === 'pending') {
    dispute.status = 'investigating'
    dispute.updatedAt = new Date().toISOString()
    return dispute
  }
  return null
}

export async function resolveDispute(
  id: string,
  data: ResolveDisputeInput
): Promise<Dispute | null> {
  const dispute = MOCK_DISPUTES.find(d => d.id === id)
  if (dispute && (dispute.status === 'pending' || dispute.status === 'investigating')) {
    dispute.status = 'resolved'
    dispute.resolution = data.resolution
    dispute.resolvedAt = new Date().toISOString()
    dispute.resolvedBy = data.resolvedBy
    dispute.updatedAt = dispute.resolvedAt
    return dispute
  }
  return null
}

export async function rejectDispute(
  id: string,
  reason: string,
  rejectedBy: string
): Promise<Dispute | null> {
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
