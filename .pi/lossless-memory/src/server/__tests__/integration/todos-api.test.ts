import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'
import { getDb } from '../../db'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Integration: Todos API (Real Database)', () => {
  const authHeaders = { Authorization: 'Bearer admin-token' }

  beforeAll(async () => {
    await setupTestDatabase()
    const db = await getDb()
    expect(db).toBeDefined()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  beforeEach(async () => {
    await cleanupTestDatabase()
  })

  afterEach(async () => {
    await cleanupTestDatabase()
  })

  describe('Full CRUD Flow', () => {
    it('should handle complete todo lifecycle', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const listRes = await client.api.todos.$get(undefined, { headers: authHeaders })
      const listData = await listRes.json()
      expect(listData).toEqual({ success: true, data: [] })

      const createRes = await client.api.todos.$post(
        {
          json: { title: 'Integration Todo', description: 'Full test' },
        },
        { headers: authHeaders }
      )
      expect(createRes.status).toBe(201)
      const created = await createRes.json()
      expect(created.success).toBe(true)
      if (created.success && 'data' in created) {
        expect(created.data.title).toBe('Integration Todo')

        const readRes = await client.api.todos[':id'].$get(
          {
            param: { id: String(created.data.id) },
          },
          { headers: authHeaders }
        )
        const readData = await readRes.json()
        expect(readData.success).toBe(true)

        const updateRes = await client.api.todos[':id'].$put(
          {
            param: { id: String(created.data.id) },
            json: { status: 'completed' },
          },
          { headers: authHeaders }
        )
        const updated = await updateRes.json()
        expect(updated.success).toBe(true)
        if (updated.success && 'data' in updated) {
          expect(updated.data.status).toBe('completed')
        }

        const deleteRes = await client.api.todos[':id'].$delete(
          {
            param: { id: String(created.data.id) },
          },
          { headers: authHeaders }
        )
        const deleted = await deleteRes.json()
        expect(deleted.success).toBe(true)

        const verifyRes = await client.api.todos[':id'].$get(
          {
            param: { id: String(created.data.id) },
          },
          { headers: authHeaders }
        )
        expect(verifyRes.status).toBe(404)
      }
    })

    it('should handle concurrent requests', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const promises = Array.from({ length: 10 }, (_, i) =>
        client.api.todos.$post(
          {
            json: { title: `Concurrent Todo ${i}` },
          },
          { headers: authHeaders }
        )
      )

      const results = await Promise.all(promises)
      results.forEach((res: { status: number }) => {
        expect(res.status).toBe(201)
      })

      const listRes = await client.api.todos.$get(undefined, { headers: authHeaders })
      const listData = await listRes.json()
      if (listData.success && 'data' in listData) {
        expect(listData.data).toHaveLength(10)
      }
    })
  })

  describe('Edge Cases', () => {
    it('should return 404 for non-existent todo', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$get(
        {
          param: { id: '99999' },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(404)
    })

    it('should reject invalid todo data', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post(
        {
          json: { title: '' },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(400)
    })
  })
})
