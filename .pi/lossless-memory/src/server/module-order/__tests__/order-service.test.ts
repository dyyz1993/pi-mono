import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import * as service from '../services/order-service'
import { resetMockOrders } from '../services/order-service'
import type { CreateOrderInput, UpdateOrderInput } from '@shared/modules/order'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Order Service', () => {
  // Track created orders for cleanup
  let createdOrderIds: string[] = []

  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  beforeEach(() => {
    // 重置 mock orders 以确保测试隔离
    resetMockOrders()
    createdOrderIds = []
  })

  describe('getOrders', () => {
    it('should return all orders when no filters provided', async () => {
      const result = await service.getOrders()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should filter orders by status', async () => {
      const result = await service.getOrders({ status: 'pending' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(order => {
        expect(order.status).toBe('pending')
      })
    })
  })

  describe('getOrderById', () => {
    it('should return order when id exists', async () => {
      const allOrders = await service.getOrders()
      const firstOrder = allOrders[0]
      const result = await service.getOrderById(firstOrder.id)
      expect(result).not.toBeNull()
      expect(result?.id).toBe(firstOrder.id)
    })

    it('should return null for non-existent order id', async () => {
      const result = await service.getOrderById('non-existent-order-id')
      expect(result).toBeNull()
    })
  })

  describe('createOrder', () => {
    it('should create a new order with correct data', async () => {
      const data: CreateOrderInput = {
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        productName: 'Test Product',
        amount: 100,
      }
      const result = await service.createOrder(data)
      createdOrderIds.push(result.id)

      expect(result).toMatchObject({
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        productName: 'Test Product',
        amount: 100,
        status: 'pending',
      })
      expect(result.id).toBeDefined()
    })
  })

  describe('updateOrder', () => {
    it('should update existing order status', async () => {
      const data: CreateOrderInput = {
        customerName: 'Update Test',
        customerEmail: 'update@example.com',
        productName: 'Update Product',
        amount: 200,
      }
      const created = await service.createOrder(data)
      createdOrderIds.push(created.id)

      const updateData: UpdateOrderInput = {
        status: 'processing',
      }
      const result = await service.updateOrder(created.id, updateData)

      expect(result).not.toBeNull()
      expect(result?.status).toBe('processing')
    })

    it('should return null when updating non-existent order', async () => {
      const result = await service.updateOrder('non-existent-order-id', { status: 'completed' })
      expect(result).toBeNull()
    })
  })

  describe('deleteOrder', () => {
    it('should delete existing order successfully', async () => {
      const data: CreateOrderInput = {
        customerName: 'Delete Test',
        customerEmail: 'delete@example.com',
        productName: 'Delete Product',
        amount: 100,
      }
      const created = await service.createOrder(data)

      const result = await service.deleteOrder(created.id)
      expect(result.message).toBe('订单已删除')

      const found = await service.getOrderById(created.id)
      expect(found).toBeNull()
    })

    it('should return failure when deleting non-existent order', async () => {
      const result = await service.deleteOrder('non-existent-order-id')
      expect(result.message).toBe('订单不存在')
    })
  })

  describe('processOrder', () => {
    it('should process a pending order', async () => {
      const data: CreateOrderInput = {
        customerName: 'Process Test',
        customerEmail: 'process@example.com',
        productName: 'Process Product',
        amount: 150,
      }
      const created = await service.createOrder(data)
      createdOrderIds.push(created.id)

      const result = await service.processOrder(created.id)
      expect(result).not.toBeNull()
      expect(result?.status).toBe('processing')
    })

    it('should return null when processing non-existent order', async () => {
      const result = await service.processOrder('non-existent-order-id')
      expect(result).toBeNull()
    })
  })

  describe('cancelOrder', () => {
    it('should cancel a pending order', async () => {
      const data: CreateOrderInput = {
        customerName: 'Cancel Test',
        customerEmail: 'cancel@example.com',
        productName: 'Cancel Product',
        amount: 200,
      }
      const created = await service.createOrder(data)
      createdOrderIds.push(created.id)

      const result = await service.cancelOrder(created.id)
      expect(result).not.toBeNull()
      expect(result?.status).toBe('cancelled')
    })

    it('should return null when cancelling non-existent order', async () => {
      const result = await service.cancelOrder('non-existent-order-id')
      expect(result).toBeNull()
    })
  })

  describe('completeOrder', () => {
    it('should complete a processing order', async () => {
      const data: CreateOrderInput = {
        customerName: 'Complete Test',
        customerEmail: 'complete@example.com',
        productName: 'Complete Product',
        amount: 300,
      }
      const created = await service.createOrder(data)
      createdOrderIds.push(created.id)

      // First process the order to change status from pending to processing
      const processed = await service.processOrder(created.id)
      expect(processed).not.toBeNull()
      expect(processed?.status).toBe('processing')

      // Then complete the order
      const result = await service.completeOrder(created.id)
      expect(result).not.toBeNull()
      expect(result?.status).toBe('completed')
    })

    it('should return null when completing non-existent order', async () => {
      const result = await service.completeOrder('non-existent-order-id')
      expect(result).toBeNull()
    })

    it('should return null when completing pending order (not processing)', async () => {
      const data: CreateOrderInput = {
        customerName: 'Complete Pending Test',
        customerEmail: 'complete-pending@example.com',
        productName: 'Complete Pending Product',
        amount: 400,
      }
      const created = await service.createOrder(data)
      createdOrderIds.push(created.id)
      // Order is in pending status, cannot complete directly
      const result = await service.completeOrder(created.id)
      expect(result).toBeNull()
    })
  })
})
