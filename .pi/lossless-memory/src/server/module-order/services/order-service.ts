/**
 * Order 服务层 (基础模板 - 无数据库)
 *
 * 职责：
 * - 业务逻辑处理
 * - 数据验证
 * - 内存存储
 */

import type { Order, CreateOrderInput, UpdateOrderInput, OrderStatus } from '@shared/modules/order'
import { generateOrderNo, randomDate } from '@server/utils/generate'

const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'processing',
  'completed',
  'cancelled',
  'disputed',
]

const CUSTOMERS = [
  { name: '张三', email: 'zhangsan@example.com' },
  { name: '李四', email: 'lisi@example.com' },
  { name: '王五', email: 'wangwu@example.com' },
  { name: '赵六', email: 'zhaoliu@example.com' },
  { name: '钱七', email: 'qianqi@example.com' },
]

const PRODUCTS = [
  '高级会员订阅',
  '专业版软件授权',
  '企业级解决方案',
  '数据分析服务',
  '技术支持套餐',
  '定制开发服务',
]

function randomElement<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

// 使用 let 而不是 const，允许在测试中重置
let MOCK_ORDERS: Order[] = Array.from({ length: 25 }, (_, index) => {
  const customer = randomElement(CUSTOMERS)
  const product = randomElement(PRODUCTS)
  const status = randomElement(ORDER_STATUSES)
  const createdAt = randomDate(new Date('2024-01-01'), new Date())

  return {
    id: `order-${index + 1}`,
    orderNo: generateOrderNo(),
    customerName: customer.name,
    customerEmail: customer.email,
    productName: product,
    amount: Math.floor(Math.random() * 10000) + 100,
    status,
    createdAt,
    updatedAt: randomDate(new Date(createdAt), new Date()),
  }
})

// 用于测试的重置函数
export function resetMockOrders(): void {
  MOCK_ORDERS = Array.from({ length: 25 }, (_, index) => {
    const customer = randomElement(CUSTOMERS)
    const product = randomElement(PRODUCTS)
    const status = randomElement(ORDER_STATUSES)
    const createdAt = randomDate(new Date('2024-01-01'), new Date())

    return {
      id: `order-${index + 1}`,
      orderNo: generateOrderNo(),
      customerName: customer.name,
      customerEmail: customer.email,
      productName: product,
      amount: Math.floor(Math.random() * 10000) + 100,
      status,
      createdAt,
      updatedAt: randomDate(new Date(createdAt), new Date()),
    }
  })
}

export async function getOrders(filters?: {
  status?: OrderStatus
  customerName?: string
}): Promise<Order[]> {
  let result = [...MOCK_ORDERS]

  if (filters?.status) {
    result = result.filter(o => o.status === filters.status)
  }

  if (filters?.customerName) {
    result = result.filter(
      o =>
        o.customerName.includes(filters.customerName!) ||
        o.customerEmail.includes(filters.customerName!)
    )
  }

  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function getOrderById(id: string): Promise<Order | null> {
  return MOCK_ORDERS.find(o => o.id === id) || null
}

export async function createOrder(data: CreateOrderInput): Promise<Order> {
  const newOrder: Order = {
    id: `order-${Date.now()}`,
    orderNo: generateOrderNo(),
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    productName: data.productName,
    amount: data.amount,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  MOCK_ORDERS.push(newOrder)
  return newOrder
}

export async function updateOrder(id: string, data: UpdateOrderInput): Promise<Order | null> {
  const order = MOCK_ORDERS.find(o => o.id === id)
  if (order) {
    Object.assign(order, data, { updatedAt: new Date().toISOString() })
    return order
  }
  return null
}

export async function deleteOrder(id: string): Promise<{ message: string }> {
  const index = MOCK_ORDERS.findIndex(o => o.id === id)
  if (index !== -1) {
    MOCK_ORDERS.splice(index, 1)
    return { message: '订单已删除' }
  }
  return { message: '订单不存在' }
}

export async function processOrder(id: string): Promise<Order | null> {
  const order = MOCK_ORDERS.find(o => o.id === id)
  if (order && order.status === 'pending') {
    order.status = 'processing'
    order.updatedAt = new Date().toISOString()
    return order
  }
  return null
}

export async function cancelOrder(id: string): Promise<Order | null> {
  const order = MOCK_ORDERS.find(o => o.id === id)
  if (order && (order.status === 'pending' || order.status === 'processing')) {
    order.status = 'cancelled'
    order.updatedAt = new Date().toISOString()
    return order
  }
  return null
}

export async function completeOrder(id: string): Promise<Order | null> {
  const order = MOCK_ORDERS.find(o => o.id === id)
  if (order && order.status === 'processing') {
    order.status = 'completed'
    order.updatedAt = new Date().toISOString()
    return order
  }
  return null
}
