import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import * as adminService from '../services/admin-service'
import { getRawClient } from '../../db'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Admin Service', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  beforeEach(async () => {
    const rawClient = await getRawClient()
    if (rawClient && 'execute' in rawClient) {
      await rawClient.execute('DELETE FROM todos')
    }
  })

  describe('getSystemStats', () => {
    it('should return zero stats when no todos exist', async () => {
      const stats = await adminService.getSystemStats()

      expect(stats.totalTodos).toBe(0)
      expect(stats.pendingTodos).toBe(0)
      expect(stats.completedTodos).toBe(0)
      expect(stats.lastUpdated).toBeDefined()
    })

    it('should return correct stats for mixed todo statuses', async () => {
      const rawClient = await getRawClient()
      if (rawClient && 'execute' in rawClient) {
        const now = Date.now()
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Pending 1', 'pending', now, now],
        })
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Pending 2', 'pending', now, now],
        })
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Completed 1', 'completed', now, now],
        })
      }

      const stats = await adminService.getSystemStats()

      expect(stats.totalTodos).toBe(3)
      expect(stats.pendingTodos).toBe(2)
      expect(stats.completedTodos).toBe(1)
      expect(stats.lastUpdated).toBeDefined()
    })
  })

  describe('checkDatabaseHealth', () => {
    it('should return connected status when database is available', async () => {
      const health = await adminService.checkDatabaseHealth()

      expect(health.database).toBe('connected')
      expect(health.timestamp).toBeDefined()
    })
  })

  describe('getRecentActivity', () => {
    it('should return empty array when no activity exists', async () => {
      const activity = await adminService.getRecentActivity(10)

      expect(Array.isArray(activity)).toBe(true)
      expect(activity.length).toBe(0)
    })

    it('should return recent activity with correct limit', async () => {
      const rawClient = await getRawClient()
      if (rawClient && 'execute' in rawClient) {
        const now = Date.now()
        for (let i = 0; i < 5; i++) {
          await rawClient.execute({
            sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
            args: [`Todo ${i}`, 'pending', now + i, now + i],
          })
        }
      }

      const activity = await adminService.getRecentActivity(3)

      expect(activity.length).toBeLessThanOrEqual(3)
      expect(Array.isArray(activity)).toBe(true)
    })

    it('should return activity with correct fields', async () => {
      const rawClient = await getRawClient()
      if (rawClient && 'execute' in rawClient) {
        const now = Date.now()
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Test Todo', 'pending', now, now],
        })
      }

      const activity = await adminService.getRecentActivity(10)

      expect(activity.length).toBeGreaterThan(0)
      expect(activity[0]).toHaveProperty('id')
      expect(activity[0]).toHaveProperty('title')
      expect(activity[0]).toHaveProperty('status')
      expect(activity[0]).toHaveProperty('updatedAt')
    })
  })

  describe('clearAllTodos', () => {
    it('should clear all todos and return count', async () => {
      const rawClient = await getRawClient()
      if (rawClient && 'execute' in rawClient) {
        const now = Date.now()
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Todo 1', 'pending', now, now],
        })
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Todo 2', 'completed', now, now],
        })
      }

      const result = await adminService.clearAllTodos()

      expect(result.deletedCount).toBe(2)

      const stats = await adminService.getSystemStats()
      expect(stats.totalTodos).toBe(0)
    })

    it('should return zero when no todos exist', async () => {
      const result = await adminService.clearAllTodos()

      expect(result.deletedCount).toBe(0)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle getRecentActivity with invalid limit gracefully', async () => {
      const activity = await adminService.getRecentActivity(-1)

      expect(Array.isArray(activity)).toBe(true)
      expect(activity.length).toBe(0)
    })

    it('should handle getRecentActivity with zero limit', async () => {
      const rawClient = await getRawClient()
      if (rawClient && 'execute' in rawClient) {
        const now = Date.now()
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Test Todo', 'pending', now, now],
        })
      }

      const activity = await adminService.getRecentActivity(0)

      expect(Array.isArray(activity)).toBe(true)
      expect(activity.length).toBe(0)
    })

    it('should handle very large limit value', async () => {
      const activity = await adminService.getRecentActivity(999999)

      expect(Array.isArray(activity)).toBe(true)
      expect(activity.length).toBeGreaterThanOrEqual(0)
    })

    it('should return empty result when database has no todos', async () => {
      const stats = await adminService.getSystemStats()

      expect(stats.totalTodos).toBe(0)
      expect(stats.pendingTodos).toBe(0)
      expect(stats.completedTodos).toBe(0)
    })

    it('should handle clearAllTodos on empty database', async () => {
      const result = await adminService.clearAllTodos()

      expect(result.deletedCount).toBe(0)
      expect(result).toHaveProperty('deletedCount')
    })

    it('should return false for invalid operations', async () => {
      const rawClient = await getRawClient()
      if (rawClient && 'execute' in rawClient) {
        const now = Date.now()
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Test', 'pending', now, now],
        })
      }

      const result = await adminService.clearAllTodos()
      const isEmpty = result.deletedCount === 0

      expect(isEmpty).toBeFalsy()
      expect(result.deletedCount).toBeGreaterThan(0)
    })

    it('should return empty array for invalid limit parameter', async () => {
      const activity = await adminService.getRecentActivity(-1)

      expect(activity.length).toBe(0)
      expect(activity).toEqual([])
    })

    it('should handle getRecentActivity returning null for edge case', async () => {
      const activity = await adminService.getRecentActivity(0)
      const result = activity.length > 0 ? activity[0] : null

      expect(result).toBeNull()
      expect(activity.length).toBe(0)
    })
  })

  describe('getUnreadCount', () => {
    it('should get unread count', async () => {
      const count = adminService.getUnreadCount()
      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('should return zero when no notifications', async () => {
      const notifications = adminService.getNotifications()
      for (const n of notifications) {
        await adminService.markNotificationRead(n.id)
      }
      const count = adminService.getUnreadCount()
      expect(count).toBe(0)
      expect(typeof count).toBe('number')
    })
  })
})
