import { describe, it, expect, beforeEach } from 'vitest'
import * as service from '../services/dispute-service'
import type { CreateDisputeInput } from '@shared/modules/dispute'

describe('Dispute Service', () => {
  const createdDisputeIds: string[] = []

  beforeEach(async () => {
    for (const id of createdDisputeIds) {
      await service.deleteDispute(id)
    }
    createdDisputeIds.length = 0
  })

  describe('getDisputes', () => {
    it('should return all disputes', async () => {
      const result = await service.getDisputes()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('getDisputeById', () => {
    it('should return null for non-existent dispute', async () => {
      const result = await service.getDisputeById('non-existent-dispute-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('createDispute', () => {
    it('should create a new dispute', async () => {
      const data: CreateDisputeInput = {
        orderId: 'order-1',
        orderNo: 'ORD123',
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        type: 'refund',
        description: 'Test Description',
        amount: 100,
      }
      const result = await service.createDispute(data)
      createdDisputeIds.push(result.id)
      expect(result).toMatchObject({
        customerName: 'Test Customer',
        type: 'refund',
      })
    })
  })

  describe('updateDispute', () => {
    it('should return null for non-existent dispute', async () => {
      const result = await service.updateDispute('non-existent-dispute-id-xyz', {})
      expect(result).toBeNull()
    })
  })

  describe('investigateDispute', () => {
    it('should investigate a pending dispute', async () => {
      const data: CreateDisputeInput = {
        orderId: 'order-1',
        orderNo: 'ORD123',
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        type: 'refund',
        description: 'Test Description',
        amount: 100,
      }
      const created = await service.createDispute(data)
      createdDisputeIds.push(created.id)
      const result = await service.investigateDispute(created.id)
      expect(result).not.toBeNull()
      expect(result?.status).toBe('investigating')
    })

    it('should return null for non-existent dispute', async () => {
      const result = await service.investigateDispute('non-existent-dispute-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('resolveDispute', () => {
    it('should resolve a dispute', async () => {
      const data: CreateDisputeInput = {
        orderId: 'order-1',
        orderNo: 'ORD123',
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        type: 'refund',
        description: 'Test Description',
        amount: 100,
      }
      const created = await service.createDispute(data)
      createdDisputeIds.push(created.id)
      const result = await service.resolveDispute(created.id, {
        resolution: 'Resolved',
        resolvedBy: 'Admin',
      })
      expect(result).not.toBeNull()
      expect(result?.status).toBe('resolved')
    })

    it('should return null for non-existent dispute', async () => {
      const result = await service.resolveDispute('non-existent-dispute-id-xyz', {
        resolution: 'Resolved',
        resolvedBy: 'Admin',
      })
      expect(result).toBeNull()
    })
  })

  describe('rejectDispute', () => {
    it('should reject a dispute', async () => {
      const data: CreateDisputeInput = {
        orderId: 'order-1',
        orderNo: 'ORD123',
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        type: 'refund',
        description: 'Test Description',
        amount: 100,
      }
      const created = await service.createDispute(data)
      createdDisputeIds.push(created.id)
      const result = await service.rejectDispute(created.id, 'Rejected', 'Admin')
      expect(result).not.toBeNull()
      expect(result?.status).toBe('rejected')
    })

    it('should return null for non-existent dispute', async () => {
      const result = await service.rejectDispute('non-existent-dispute-id-xyz', 'Rejected', 'Admin')
      expect(result).toBeNull()
    })
  })
})
