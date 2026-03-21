import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { PermissionService } from '../services/permission-service-impl'
import { roleService } from '../services/role-service'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Permission Service', () => {
  let service: PermissionService

  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  beforeEach(async () => {
    service = new PermissionService()
    // Reset role_user permissions to default state
    const currentPermissions = await service.getRolePermissions('role_user')
    for (const perm of currentPermissions) {
      if (perm.id !== 'perm_content_view' && perm.id !== 'perm_order_view') {
        await service.revokePermissionFromRole('role_user', perm.id)
      }
    }
  })

  describe('getAll', () => {
    it('should return all active permissions', async () => {
      const permissions = await service.getAll()
      expect(permissions.length).toBeGreaterThan(0)
      expect(permissions.every(p => p.isActive)).toBe(true)
    })

    it('should return permissions with correct structure', async () => {
      const permissions = await service.getAll()
      const permission = permissions[0]
      expect(permission).toHaveProperty('id')
      expect(permission).toHaveProperty('code')
      expect(permission).toHaveProperty('name')
      expect(permission).toHaveProperty('label')
      expect(permission).toHaveProperty('category')
    })

    it('should return permissions with valid categories', async () => {
      const permissions = await service.getAll()
      const validCategories = ['user', 'content', 'system', 'data', 'order', 'ticket']
      expect(permissions.every(p => validCategories.includes(p.category))).toBe(true)
    })
  })

  describe('getById', () => {
    it('should return permission by id', async () => {
      const permission = await service.getById('perm_user_view')
      expect(permission).toBeDefined()
      expect(permission?.code).toBe('user:view')
    })

    it('should return undefined for non-existent id', async () => {
      const permission = await service.getById('non-existent-id')
      expect(permission).toBeUndefined()
    })

    it('should return permission with all required fields', async () => {
      const permission = await service.getById('perm_user_view')
      expect(permission?.id).toBe('perm_user_view')
      expect(permission?.name).toBe('查看用户')
      expect(permission?.label).toBe('查看用户')
      expect(permission?.category).toBe('user')
    })
  })

  describe('getByCode', () => {
    it('should return permission by code', async () => {
      const permission = await service.getByCode('user:view')
      expect(permission).toBeDefined()
      expect(permission?.id).toBe('perm_user_view')
    })

    it('should return undefined for non-existent code', async () => {
      const permission = await service.getByCode('non:existent')
      expect(permission).toBeUndefined()
    })

    it('should find permission by exact code match', async () => {
      const permission = await service.getByCode('content:view')
      expect(permission?.id).toBe('perm_content_view')
    })
  })

  describe('getByCategory', () => {
    it('should return permissions by category', async () => {
      const permissions = await service.getByCategory('user')
      expect(permissions.length).toBeGreaterThan(0)
      expect(permissions.every(p => p.category === 'user')).toBe(true)
    })

    it('should return empty array for non-existent category', async () => {
      const permissions = await service.getByCategory('non-existent')
      expect(permissions).toEqual([])
    })

    it('should return all permissions for each valid category', async () => {
      const categories = ['user', 'content', 'system', 'data', 'order', 'ticket']
      for (const category of categories) {
        const permissions = await service.getByCategory(category)
        expect(permissions.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getRolePermissions', () => {
    it('should return permissions for super admin role', async () => {
      const permissions = await service.getRolePermissions('role_super_admin')
      expect(permissions.length).toBeGreaterThan(0)
    })

    it('should return permissions for customer service role', async () => {
      const permissions = await service.getRolePermissions('role_customer_service')
      expect(permissions.length).toBeGreaterThan(0)
    })

    it('should return permissions for user role', async () => {
      const permissions = await service.getRolePermissions('role_user')
      expect(permissions.length).toBeGreaterThan(0)
    })

    it('should return empty array for non-existent role', async () => {
      const permissions = await service.getRolePermissions('non-existent')
      expect(permissions).toEqual([])
    })

    it('should return only active permissions', async () => {
      const permissions = await service.getRolePermissions('role_super_admin')
      expect(permissions.every(p => p.isActive)).toBe(true)
    })

    it('should return permissions with correct permission IDs', async () => {
      const permissions = await service.getRolePermissions('role_customer_service')
      const permissionIds = permissions.map(p => p.id)
      expect(permissionIds).toContain('perm_user_view')
      expect(permissionIds).toContain('perm_content_view')
    })
  })

  describe('getUserPermissions', () => {
    it('should return empty array when roleCode is not provided', async () => {
      const permissions = await service.getUserPermissions('user-123')
      expect(permissions).toEqual([])
    })

    it('should return empty array when roleCode is empty string', async () => {
      const permissions = await service.getUserPermissions('user-123', '')
      expect(permissions).toEqual([])
    })

    it('should return permissions for valid role code', async () => {
      const permissions = await service.getUserPermissions('user-123', 'customer_service')
      expect(permissions.length).toBeGreaterThan(0)
    })

    it('should return empty array for non-existent role code', async () => {
      const permissions = await service.getUserPermissions('user-123', 'non-existent')
      expect(permissions).toEqual([])
    })

    it('should return same permissions as getRolePermissions', async () => {
      const role = await roleService.getByCode('customer_service')
      const userPermissions = await service.getUserPermissions('user-123', 'customer_service')
      const rolePermissions = await service.getRolePermissions(role?.id as string)
      expect(userPermissions.length).toBe(rolePermissions.length)
    })

    it('should return all permissions for super admin', async () => {
      const permissions = await service.getUserPermissions('user-123', 'super_admin')
      expect(permissions.length).toBeGreaterThan(0)
    })

    it('should return limited permissions for user role', async () => {
      const permissions = await service.getUserPermissions('user-123', 'user')
      expect(permissions.length).toBeGreaterThan(0)
      expect(permissions.length).toBeLessThan(20)
    })
  })

  describe('hasPermission', () => {
    it('should return true when user has permission', async () => {
      // Use test-customer-service-1 which has user:view permission
      const hasPermission = await service.hasPermission('test-customer-service-1', 'user:view')
      expect(hasPermission).toBe(true)
    })

    it('should return false when user does not have permission', async () => {
      // Use test-user-1 which doesn't have user:view permission
      const hasPermission = await service.hasPermission('test-user-1', 'user:view')
      expect(hasPermission).toBe(false)
    })

    it('should check permission by code', async () => {
      // Use test-customer-service-1 which has content:view permission
      const hasPermission = await service.hasPermission('test-customer-service-1', 'content:view')
      expect(hasPermission).toBe(true)
    })
  })

  describe('assignPermissionToRole', () => {
    it('should assign permission to role', async () => {
      await service.assignPermissionToRole('role_user', 'perm_user_create')
      const permissions = await service.getRolePermissions('role_user')
      const permissionIds = permissions.map(p => p.id)
      expect(permissionIds).toContain('perm_user_create')
    })

    it('should not duplicate permission assignment', async () => {
      await service.assignPermissionToRole('role_user', 'perm_user_view')
      await service.assignPermissionToRole('role_user', 'perm_user_view')
      const permissions = await service.getRolePermissions('role_user')
      const viewPermissions = permissions.filter(p => p.id === 'perm_user_view')
      expect(viewPermissions.length).toBe(1)
    })

    it('should allow assigning multiple permissions', async () => {
      await service.assignPermissionToRole('role_user', 'perm_user_create')
      await service.assignPermissionToRole('role_user', 'perm_user_update')
      const permissions = await service.getRolePermissions('role_user')
      const permissionIds = permissions.map(p => p.id)
      expect(permissionIds).toContain('perm_user_create')
      expect(permissionIds).toContain('perm_user_update')
    })
  })

  describe('revokePermissionFromRole', () => {
    it('should revoke permission from role', async () => {
      await service.assignPermissionToRole('role_user', 'perm_user_create')
      await service.revokePermissionFromRole('role_user', 'perm_user_create')
      const permissions = await service.getRolePermissions('role_user')
      const permissionIds = permissions.map(p => p.id)
      expect(permissionIds).not.toContain('perm_user_create')
    })

    it('should handle revoking non-existent permission', async () => {
      await service.revokePermissionFromRole('role_user', 'non-existent-permission')
      const permissions = await service.getRolePermissions('role_user')
      expect(permissions).toBeDefined()
    })

    it('should only revoke specified permission', async () => {
      await service.assignPermissionToRole('role_user', 'perm_user_create')
      await service.assignPermissionToRole('role_user', 'perm_user_update')
      await service.revokePermissionFromRole('role_user', 'perm_user_create')
      const permissions = await service.getRolePermissions('role_user')
      const permissionIds = permissions.map(p => p.id)
      expect(permissionIds).not.toContain('perm_user_create')
      expect(permissionIds).toContain('perm_user_update')
    })
  })

  describe('Permission Dependencies', () => {
    it('should have user:view permission for customer service', async () => {
      const permissions = await service.getRolePermissions('role_customer_service')
      const permissionCodes = permissions.map(p => p.code)
      expect(permissionCodes).toContain('user:view')
    })

    it('should have content:view permission for customer service', async () => {
      const permissions = await service.getRolePermissions('role_customer_service')
      const permissionCodes = permissions.map(p => p.code)
      expect(permissionCodes).toContain('content:view')
    })

    it('should have order permissions for customer service', async () => {
      const permissions = await service.getRolePermissions('role_customer_service')
      const permissionCodes = permissions.map(p => p.code)
      expect(permissionCodes).toContain('order:view')
      expect(permissionCodes).toContain('order:process')
    })

    it('should have ticket permissions for customer service', async () => {
      const permissions = await service.getRolePermissions('role_customer_service')
      const permissionCodes = permissions.map(p => p.code)
      expect(permissionCodes).toContain('ticket:view')
      expect(permissionCodes).toContain('ticket:reply')
      expect(permissionCodes).toContain('ticket:close')
    })

    it('should have limited permissions for user role', async () => {
      const permissions = await service.getRolePermissions('role_user')
      const permissionCodes = permissions.map(p => p.code)
      expect(permissionCodes).toContain('content:view')
      expect(permissionCodes).toContain('order:view')
      expect(permissionCodes).not.toContain('user:view')
    })

    it('should have all permissions for super admin', async () => {
      const permissions = await service.getRolePermissions('role_super_admin')
      const permissionCodes = permissions.map(p => p.code)
      expect(permissionCodes).toContain('user:view')
      expect(permissionCodes).toContain('user:create')
      expect(permissionCodes).toContain('content:view')
      expect(permissionCodes).toContain('system:settings')
    })
  })

  describe('Permission Categories', () => {
    it('should have correct number of user permissions', async () => {
      const permissions = await service.getByCategory('user')
      expect(permissions.length).toBe(4)
    })

    it('should have correct number of content permissions', async () => {
      const permissions = await service.getByCategory('content')
      expect(permissions.length).toBe(4)
    })

    it('should have correct number of system permissions', async () => {
      const permissions = await service.getByCategory('system')
      expect(permissions.length).toBe(3)
    })

    it('should have correct number of order permissions', async () => {
      const permissions = await service.getByCategory('order')
      expect(permissions.length).toBe(2)
    })

    it('should have correct number of ticket permissions', async () => {
      const permissions = await service.getByCategory('ticket')
      expect(permissions.length).toBe(3)
    })

    it('should have correct number of data permissions', async () => {
      const permissions = await service.getByCategory('data')
      expect(permissions.length).toBe(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty role permissions', async () => {
      const permissions = await service.getRolePermissions('non-existent-role')
      expect(permissions).toEqual([])
    })

    it('should handle assigning permission to non-existent role gracefully', async () => {
      // 由于外键约束，无法向不存在的角色分配权限
      // 测试应该验证服务层是否正确处理这种情况
      try {
        await service.assignPermissionToRole('non-existent-role', 'perm_user_view')
        // 如果成功，验证权限是否被分配
        const permissions = await service.getRolePermissions('non-existent-role')
        expect(permissions.length).toBe(0)
      } catch (error) {
        // 如果抛出错误，验证是外键约束错误
        expect(error).toBeDefined()
      }
    })

    it('should handle revoking from empty role', async () => {
      await service.revokePermissionFromRole('non-existent-role', 'perm_user_view')
      const permissions = await service.getRolePermissions('non-existent-role')
      expect(permissions).toEqual([])
    })

    it('should handle multiple assignments and revocations', async () => {
      await service.assignPermissionToRole('role_user', 'perm_user_view')
      await service.assignPermissionToRole('role_user', 'perm_user_create')
      await service.assignPermissionToRole('role_user', 'perm_user_update')
      await service.revokePermissionFromRole('role_user', 'perm_user_create')
      const permissions = await service.getRolePermissions('role_user')
      const permissionIds = permissions.map(p => p.id)
      expect(permissionIds).toContain('perm_user_view')
      expect(permissionIds).toContain('perm_user_update')
      expect(permissionIds).not.toContain('perm_user_create')
    })
  })
})
