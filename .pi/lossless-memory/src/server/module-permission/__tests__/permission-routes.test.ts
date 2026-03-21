import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Permission Routes', () => {
  const authHeaders = { Authorization: 'Bearer test-super-admin-1' }

  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  describe('GET /api/permissions', () => {
    it('should return list of permissions', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions.$get(undefined, { headers: authHeaders })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(Array.isArray(data.data)).toBe(true)
        expect(data.data.length).toBeGreaterThan(0)
      }
    })

    it('should return permissions with correct structure', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions.$get(undefined, { headers: authHeaders })
      expect(res.status).toBe(200)

      const data = await res.json()
      if (data.success && data.data.length > 0) {
        const firstPermission = data.data[0]
        expect(firstPermission).toHaveProperty('permission')
        expect(firstPermission).toHaveProperty('label')
        expect(firstPermission).toHaveProperty('category')
      }
    })
  })

  describe('GET /api/permissions/roles', () => {
    it('should return list of roles', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions.roles.$get(undefined, { headers: authHeaders })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(Array.isArray(data.data)).toBe(true)
        expect(data.data.length).toBeGreaterThanOrEqual(3)
      }
    })

    it('should return roles with correct structure', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions.roles.$get(undefined, { headers: authHeaders })
      expect(res.status).toBe(200)

      const data = await res.json()
      if (data.success && data.data.length > 0) {
        const firstRole = data.data[0]
        expect(firstRole).toHaveProperty('role')
        expect(firstRole).toHaveProperty('label')
        expect(firstRole).toHaveProperty('permissions')
        expect(Array.isArray(firstRole.permissions)).toBe(true)
      }
    })
  })

  describe('GET /api/permissions/menu-config', () => {
    it('should return menu configuration', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions['menu-config'].$get(undefined, {
        headers: authHeaders,
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(Array.isArray(data.data)).toBe(true)
        expect(data.data.length).toBeGreaterThan(0)
      }
    })

    it('should return menu items with correct structure', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions['menu-config'].$get(undefined, {
        headers: authHeaders,
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      if (data.success && data.data.length > 0) {
        const firstItem = data.data[0]
        expect(firstItem).toHaveProperty('path')
        expect(firstItem).toHaveProperty('label')
        expect(firstItem).toHaveProperty('icon')
        expect(firstItem).toHaveProperty('permissions')
      }
    })
  })

  describe('GET /api/permissions/page-permissions', () => {
    it('should return page permissions configuration', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions['page-permissions'].$get(undefined, {
        headers: authHeaders,
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(Array.isArray(data.data)).toBe(true)
      }
    })
  })

  describe('GET /api/permissions/categories', () => {
    it('should return permission categories', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions.categories.$get(undefined, { headers: authHeaders })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(typeof data.data).toBe('object')
      }
    })
  })

  describe('GET /api/permissions/role-labels', () => {
    it('should return role labels', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions['role-labels'].$get(undefined, {
        headers: authHeaders,
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(typeof data.data).toBe('object')
      }
    })
  })

  describe('GET /api/permissions/permission-labels', () => {
    it('should return permission labels', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.permissions['permission-labels'].$get(undefined, {
        headers: authHeaders,
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(typeof data.data).toBe('object')
      }
    })
  })

  describe('Error Scenarios', () => {
    it('should handle unauthorized access to /permissions/me', async () => {
      const client = createTestClient()
      const res = await client.api.permissions.me.$get()
      // /permissions/me 需要认证，应该返回 401 或 403
      expect([401, 403]).toContain(res.status)
      // 响应可能是纯文本而不是 JSON，所以不解析 JSON
      const text = await res.text()
      expect(text).toBeDefined()
    })

    it('should handle access to /permissions without auth (public route)', async () => {
      const client = createTestClient()
      const res = await client.api.permissions.$get()
      // /permissions 是公开路由，应该返回 200
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('success')
    })

    it('should handle access to /permissions/roles without auth (public route)', async () => {
      const client = createTestClient()
      const res = await client.api.permissions.roles.$get()
      // /permissions/roles 是公开路由，应该返回 200
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('success')
    })

    it('should handle unauthorized access', async () => {
      const client = createTestClient()
      // 测试未授权访问需要认证的路由
      const res = await client.api.permissions.me.$get()
      // 应该返回 401
      expect(res.status).toBe(401)
    })
  })
})
