import { describe, it, expect } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'

describe('Content Routes', () => {
  const authHeaders = { Authorization: 'Bearer admin-token' }

  describe('GET /api/contents', () => {
    it('should return list of contents', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api['contents'].$get()
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(Array.isArray(data.data)).toBe(true)
      }
    })
  })

  describe('GET /api/contents/:id', () => {
    it('should return 404 for non-existent content', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api['contents'][':id'].$get({
        param: { id: 'non-existent' },
      })
      expect(res.status).toBe(404)
      expect(typeof res.status).toBe('number')
    })
  })
})
