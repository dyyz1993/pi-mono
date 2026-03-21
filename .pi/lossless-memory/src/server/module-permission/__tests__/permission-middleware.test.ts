import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { permissionService } from '../services/permission-service-impl'
import { roleService } from '../services/role-service'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Permission Middleware Integration', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  describe('hasPermission', () => {
    it('should return true when test customer service user has order:view permission', async () => {
      const hasPermission = await permissionService.hasPermission(
        'test-customer-service-2',
        'order:view'
      )
      expect(hasPermission).toBe(true)
    })

    it('should return false when test customer service user does not have user:delete permission', async () => {
      const hasPermission = await permissionService.hasPermission(
        'test-customer-service-2',
        'user:delete'
      )
      expect(hasPermission).toBe(false)
    })

    it('should return true when test customer service user has user:view permission', async () => {
      const hasPermission = await permissionService.hasPermission(
        'test-customer-service-2',
        'user:view'
      )
      expect(hasPermission).toBe(true)
    })

    it('should return true for test super admin with any permission', async () => {
      const hasPermission = await permissionService.hasPermission(
        'test-super-admin-1',
        'user:delete'
      )
      expect(hasPermission).toBe(true)
    })

    it('should return false for non-existent user', async () => {
      const hasPermission = await permissionService.hasPermission('non-existent-user', 'user:view')
      expect(hasPermission).toBe(false)
    })
  })

  describe('getUserRoles', () => {
    it('should return empty array for test user (no user_roles data)', async () => {
      const roles = await roleService.getUserRoles('test-customer-service-2')
      expect(roles).toEqual([])
    })

    it('should return empty array for non-existent user', async () => {
      const roles = await roleService.getUserRoles('non-existent-user')
      expect(roles).toEqual([])
    })
  })

  describe('getByCode', () => {
    it('should return customer_service role by code', async () => {
      const role = await roleService.getByCode('customer_service')
      expect(role).toBeDefined()
      expect(role?.code).toBe('customer_service')
      expect(role?.name).toBe('客服人员')
    })

    it('should return super_admin role by code', async () => {
      const role = await roleService.getByCode('super_admin')
      expect(role).toBeDefined()
      expect(role?.code).toBe('super_admin')
      expect(role?.name).toBe('超级管理员')
    })

    it('should return undefined for non-existent role code', async () => {
      const role = await roleService.getByCode('non_existent_role')
      expect(role).toBeUndefined()
    })
  })
})
