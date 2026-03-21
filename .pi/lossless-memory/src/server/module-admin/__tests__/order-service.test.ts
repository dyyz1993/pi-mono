import { describe, it, expect } from 'vitest'
import * as service from '../services/order-service'

describe('Admin Order Service', () => {
  describe('getOrders', () => {
    it('should return all orders when no filters provided', () => {
      const result = service.getOrders()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should filter orders by status', () => {
      const result = service.getOrders({ status: 'pending' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(order => {
        expect(order.status).toBe('pending')
      })
    })

    it('should filter orders by customer name', () => {
      const result = service.getOrders({ customerName: '张三' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(order => {
        expect(order.customerName.includes('张三') || order.customerEmail.includes('张三')).toBe(
          true
        )
      })
    })
  })

  describe('getOrderById', () => {
    it('should return order when id exists', () => {
      const allOrders = service.getOrders()
      const firstOrder = allOrders[0]
      const result = service.getOrderById(firstOrder.id)
      expect(result).not.toBeNull()
      expect(result?.id).toBe(firstOrder.id)
    })

    it('should return null for non-existent order id', () => {
      const result = service.getOrderById('non-existent-order-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('processOrder', () => {
    it('should process a pending order', () => {
      const allOrders = service.getOrders()
      const pendingOrder = allOrders.find(o => o.status === 'pending')

      if (pendingOrder) {
        const result = service.processOrder(pendingOrder.id)
        expect(result).not.toBeNull()
        expect(result?.status).toBe('processing')
      }
    })

    it('should return null for non-existent order', () => {
      const result = service.processOrder('non-existent-order-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('cancelOrder', () => {
    it('should cancel a pending order', () => {
      const allOrders = service.getOrders()
      const pendingOrder = allOrders.find(o => o.status === 'pending')

      if (pendingOrder) {
        const result = service.cancelOrder(pendingOrder.id)
        expect(result).not.toBeNull()
        expect(result?.status).toBe('cancelled')
      }
    })

    it('should return null for non-existent order', () => {
      const result = service.cancelOrder('non-existent-order-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('completeOrder', () => {
    it('should complete a processing order', () => {
      const allOrders = service.getOrders()
      const processingOrder = allOrders.find(o => o.status === 'processing')

      if (processingOrder) {
        const result = service.completeOrder(processingOrder.id)
        expect(result).not.toBeNull()
        expect(result?.status).toBe('completed')
      }
    })

    it('should return null for non-existent order', () => {
      const result = service.completeOrder('non-existent-order-id-xyz')
      expect(result).toBeNull()
    })
  })
})
