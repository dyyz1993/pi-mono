import { describe, it, expect } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'

describe('Captcha Routes', () => {
  const authHeaders = { Authorization: 'Bearer admin-token' }

  describe('GET /api/captcha', () => {
    it('should return captcha with id and image', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api.captcha.$get(undefined, { headers: authHeaders })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.data.id).toBeDefined()
      expect(data.data.image).toBeDefined()
    })
  })

  describe('POST /api/verify-captcha', () => {
    it('should reject request with non-existent id', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api['verify-captcha'].$post(
        {
          json: { id: 'non-existent', code: '123456' },
        },
        { headers: authHeaders }
      )
      expect(res.status).toBe(400)

      const data = await res.json()
      expect(data.success).toBe(false)
    })
  })
})
