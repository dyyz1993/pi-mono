import { describe, it, expect } from 'vitest'
import * as service from '../services/dispute-service'

describe('Admin Dispute Service', () => {
  describe('getDisputes', () => {
    it('should return all disputes', () => {
      const result = service.getDisputes()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should filter disputes by status', () => {
      const result = service.getDisputes({ status: 'pending' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(dispute => {
        expect(dispute.status).toBe('pending')
      })
    })

    it('should filter disputes by type', () => {
      const result = service.getDisputes({ type: 'refund' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(dispute => {
        expect(dispute.type).toBe('refund')
      })
    })
  })

  describe('getDisputeById', () => {
    it('should return dispute when id exists', () => {
      const allDisputes = service.getDisputes()
      const firstDispute = allDisputes[0]
      const result = service.getDisputeById(firstDispute.id)
      expect(result).not.toBeNull()
      expect(result?.id).toBe(firstDispute.id)
    })

    it('should return null for non-existent dispute', () => {
      const result = service.getDisputeById('non-existent-dispute-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('investigateDispute', () => {
    it('should investigate a pending dispute', () => {
      const allDisputes = service.getDisputes()
      const pendingDispute = allDisputes.find(d => d.status === 'pending')

      if (pendingDispute) {
        const result = service.investigateDispute(pendingDispute.id)
        expect(result).not.toBeNull()
        expect(result?.status).toBe('investigating')
      }
    })

    it('should return null for non-existent dispute', () => {
      const result = service.investigateDispute('non-existent-dispute-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('resolveDispute', () => {
    it('should resolve a pending dispute', () => {
      const allDisputes = service.getDisputes()
      const pendingDispute = allDisputes.find(d => d.status === 'pending')

      if (pendingDispute) {
        const result = service.resolveDispute(
          pendingDispute.id,
          'Issue resolved successfully',
          'Admin User'
        )
        expect(result).not.toBeNull()
        expect(result?.status).toBe('resolved')
        expect(result?.resolution).toBe('Issue resolved successfully')
      }
    })

    it('should return null for non-existent dispute', () => {
      const result = service.resolveDispute('non-existent-dispute-id-xyz', 'Resolved', 'Admin')
      expect(result).toBeNull()
    })
  })

  describe('rejectDispute', () => {
    it('should reject a pending dispute', () => {
      const allDisputes = service.getDisputes()
      const pendingDispute = allDisputes.find(d => d.status === 'pending')

      if (pendingDispute) {
        const result = service.rejectDispute(pendingDispute.id, 'Invalid claim', 'Admin User')
        expect(result).not.toBeNull()
        expect(result?.status).toBe('rejected')
      }
    })

    it('should return null for non-existent dispute', () => {
      const result = service.rejectDispute('non-existent-dispute-id-xyz', 'Reason', 'Admin')
      expect(result).toBeNull()
    })
  })
})
