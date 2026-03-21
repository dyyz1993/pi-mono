import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Role Routes', () => {
  const authHeaders = { Authorization: 'Bearer test-super-admin-1' }

  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  describe('GET /api/roles', () => {
    it('should get all roles', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles.$get(undefined, { headers: authHeaders })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(Array.isArray(data.data)).toBe(true)
        expect(data.data.length).toBeGreaterThan(0)
      }
    })

    it('should return roles with correct structure', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles.$get(undefined, { headers: authHeaders })
      expect(res.status).toBe(200)

      const data = await res.json()
      if (data.success && data.data.length > 0) {
        const firstRole = data.data[0]
        expect(firstRole).toHaveProperty('id')
        expect(firstRole).toHaveProperty('code')
        expect(firstRole).toHaveProperty('name')
        expect(firstRole).toHaveProperty('label')
        expect(firstRole).toHaveProperty('isSystem')
      }
    })
  })

  describe('GET /api/roles/:id', () => {
    it('should get role by id', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].$get(
        {
          param: { id: 'role_super_admin' },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.id).toBe('role_super_admin')
        expect(data.data.code).toBe('super_admin')
      }
    })

    it('should return 404 for non-existent role', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].$get(
        {
          param: { id: 'non-existent-role' },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/roles', () => {
    it('should create a new role', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles.$post(
        {
          json: {
            code: 'test_role',
            name: 'Test Role',
            label: 'Test Role',
          },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.code).toBe('test_role')
        expect(data.data.name).toBe('Test Role')
      }
    })
  })

  describe('PUT /api/roles/:id', () => {
    it('should update role', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].$put(
        {
          param: { id: 'role_user' },
          json: {
            name: 'Updated User',
            label: 'Updated User',
          },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.name).toBe('Updated User')
      }
    })

    it('should return 404 for non-existent role', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].$put(
        {
          param: { id: 'non-existent-role' },
          json: {
            name: 'Updated Name',
          },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/roles/:id', () => {
    it('should not delete system role', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].$delete(
        {
          param: { id: 'role_super_admin' },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(400)
    })

    it('should return 404 for non-existent role', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].$delete(
        {
          param: { id: 'non-existent-role' },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(400)
    })
  })

  describe('PUT /api/roles/:id/permissions', () => {
    it('should update role permissions', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].permissions.$put(
        {
          param: { id: 'role_user' },
          json: {
            permissionIds: ['perm_user_view', 'perm_content_view'],
          },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
    })

    it('should not modify super admin permissions', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].permissions.$put(
        {
          param: { id: 'role_super_admin' },
          json: {
            permissionIds: ['perm_user_view'],
          },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(403)

      const data = await res.json()
      expect(data.success).toBe(false)
      if (!data.success) {
        expect(data.error).toBe('Cannot modify super admin permissions')
      }
    })

    it('should return 404 for non-existent role when updating permissions', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.roles[':id'].permissions.$put(
        {
          param: { id: 'non-existent-role' },
          json: {
            permissionIds: ['perm_user_view'],
          },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(404)
    })
  })
})
