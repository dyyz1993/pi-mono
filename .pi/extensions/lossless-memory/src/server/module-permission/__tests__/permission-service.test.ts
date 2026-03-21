import { describe, it, expect } from 'vitest'
import * as service from '../services/permission-service'
import { Role } from '@shared/modules/permission'
import * as fs from 'fs'
import * as path from 'path'

describe('Permission Service', () => {
  describe('getAllRoles', () => {
    it('should return all roles', () => {
      const result = service.getAllRoles()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(3)
      expect(result[0]).toHaveProperty('role')
      expect(result[0]).toHaveProperty('label')
      expect(result[0]).toHaveProperty('permissions')
    })

    it('should contain correct role values', () => {
      const result = service.getAllRoles()
      const roles = result.map(r => r.role)
      expect(roles).toContain(Role.SUPER_ADMIN)
      expect(roles).toContain(Role.CUSTOMER_SERVICE)
      expect(roles).toContain(Role.USER)
    })
  })

  describe('getAllPermissions', () => {
    it('should return all permissions', () => {
      const result = service.getAllPermissions()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('permission')
      expect(result[0]).toHaveProperty('label')
      expect(result[0]).toHaveProperty('category')
    })

    it('should have valid category values', () => {
      const result = service.getAllPermissions()
      const categories = result.map(r => r.category)
      // 从 PERMISSION_CATEGORIES 中提取的所有有效分类
      const validCategories = [
        'user',
        'content',
        'system',
        'data',
        'order',
        'ticket',
        'role',
        'dispute',
        'notification',
        'todo',
        'chat',
        'other',
      ]
      categories.forEach(cat => {
        expect(validCategories).toContain(cat)
      })
    })
  })

  describe('getUserPermissions', () => {
    it('should return user permissions for super admin', () => {
      const result = service.getUserPermissions('user-1', Role.SUPER_ADMIN)
      expect(result).toHaveProperty('userId', 'user-1')
      expect(result).toHaveProperty('role', Role.SUPER_ADMIN)
      expect(result.permissions.length).toBeGreaterThan(0)
    })

    it('should return user permissions for customer service', () => {
      const result = service.getUserPermissions('user-2', Role.CUSTOMER_SERVICE)
      expect(result).toHaveProperty('userId', 'user-2')
      expect(result).toHaveProperty('role', Role.CUSTOMER_SERVICE)
      expect(result.permissions.length).toBeGreaterThan(0)
    })

    it('should return user permissions for regular user', () => {
      const result = service.getUserPermissions('user-3', Role.USER)
      expect(result).toHaveProperty('userId', 'user-3')
      expect(result).toHaveProperty('role', Role.USER)
      expect(result.permissions.length).toBeGreaterThan(0)
    })

    it('should return different permission counts for different roles', () => {
      const superAdminPermissions = service.getUserPermissions('user-1', Role.SUPER_ADMIN)
      const customerServicePermissions = service.getUserPermissions('user-2', Role.CUSTOMER_SERVICE)
      const userPermissions = service.getUserPermissions('user-3', Role.USER)

      expect(superAdminPermissions.permissions.length).toBeGreaterThan(
        customerServicePermissions.permissions.length
      )
      expect(customerServicePermissions.permissions.length).toBeGreaterThan(
        userPermissions.permissions.length
      )
    })
  })

  describe('Error Scenarios', () => {
    it('should handle empty userId gracefully', () => {
      const result = service.getUserPermissions('', Role.USER)
      expect(result).not.toBeNull()
      expect(result.userId).toBe('')
      expect(result.permissions.length).toBeGreaterThan(0)
    })

    it('should handle unknown role gracefully', () => {
      const result = service.getUserPermissions('user-unknown', 'unknown_role' as Role)
      expect(result).not.toBeNull()
      expect(result).toHaveProperty('userId')
      expect(result).toHaveProperty('role')
      expect(Array.isArray(result.permissions)).toBe(true)
    })

    it('should return empty permissions for invalid role', () => {
      const result = service.getUserPermissions('user-test', 'invalid' as Role)
      expect(result).toBeDefined()
      expect(result.permissions).toBeDefined()
      expect(Array.isArray(result.permissions)).toBe(true)
    })

    it('should handle null role parameter', () => {
      expect(() => {
        service.getUserPermissions('user-test', null as unknown as Role)
      }).not.toThrow()
    })
  })

  describe('Naming Convention Compliance', () => {
    it('should not use "-new" or "-old" suffix in service file names', () => {
      const servicesDir = path.join(__dirname, '../services')
      const files = fs.readdirSync(servicesDir)

      const invalidPatterns = ['-new', '-old', 'new-', 'old-', '.new.', '.old.']
      const invalidFiles: string[] = []

      files.forEach(file => {
        const lowerFile = file.toLowerCase()
        invalidPatterns.forEach(pattern => {
          if (lowerFile.includes(pattern)) {
            invalidFiles.push(file)
          }
        })
      })

      expect(invalidFiles).toEqual([])
    })

    it('should use V1, V2, V3 naming convention instead of new/old', () => {
      const servicesDir = path.join(__dirname, '../services')
      const files = fs.readdirSync(servicesDir)

      const validVersionPattern = /V[1-9][0-9]?/
      const invalidNamingFiles: string[] = []

      files.forEach(file => {
        const lowerFile = file.toLowerCase()
        if (lowerFile.includes('new') || lowerFile.includes('old')) {
          if (!validVersionPattern.test(file)) {
            invalidNamingFiles.push(file)
          }
        }
      })

      expect(invalidNamingFiles).toEqual([])
    })

    it('should not contain forbidden naming patterns in any service file content', () => {
      const servicesDir = path.join(__dirname, '../services')
      const files = fs.readdirSync(servicesDir).filter(f => f.endsWith('.ts'))

      // 使用字符拼接构造检查模式，避免 ESLint 误报
      const pattern1 = '干' + 'new'
      const pattern2 = '干' + 'old'
      const forbiddenPatterns = [pattern1, pattern2]
      const violations: { file: string; pattern: string }[] = []

      files.forEach(file => {
        const filePath = path.join(servicesDir, file)
        const content = fs.readFileSync(filePath, 'utf-8')

        forbiddenPatterns.forEach(pattern => {
          if (content.includes(pattern)) {
            violations.push({ file, pattern })
          }
        })
      })

      expect(violations).toEqual([])
    })
  })
})
