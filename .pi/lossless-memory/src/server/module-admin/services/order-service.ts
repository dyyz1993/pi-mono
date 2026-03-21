import { generateOrderNo, randomDate } from '@server/utils/generate'

export interface Order {
  id: string
  orderNo: string
  customerName: string
  customerEmail: string
  productName: string
  amount: number
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'disputed'
  createdAt: string
  updatedAt: string
}

const ORDER_STATUSES = ['pending', 'processing', 'completed', 'cancelled', 'disputed'] as const

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

export const MOCK_ORDERS: Order[] = Array.from({ length: 25 }, (_, index) => {
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

export function getOrders(filters?: { status?: Order['status']; customerName?: string }): Order[] {
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

export function getOrderById(id: string): Order | null {
  return MOCK_ORDERS.find(o => o.id === id) || null
}

export function processOrder(id: string): Order | null {
  const order = MOCK_ORDERS.find(o => o.id === id)
  if (order && order.status === 'pending') {
    order.status = 'processing'
    order.updatedAt = new Date().toISOString()
    return order
  }
  return null
}

export function cancelOrder(id: string): Order | null {
  const order = MOCK_ORDERS.find(o => o.id === id)
  if (order && (order.status === 'pending' || order.status === 'processing')) {
    order.status = 'cancelled'
    order.updatedAt = new Date().toISOString()
    return order
  }
  return null
}

export function completeOrder(id: string): Order | null {
  const order = MOCK_ORDERS.find(o => o.id === id)
  if (order && order.status === 'processing') {
    order.status = 'completed'
    order.updatedAt = new Date().toISOString()
    return order
  }
  return null
}
