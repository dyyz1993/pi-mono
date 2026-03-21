import { describe, it, expect } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'

describe('Error Response Format', () => {
  describe('Authentication Errors', () => {
    it('should return JSON format for missing authentication token', async () => {
      const client = createTestClient()

      // Call a protected endpoint (admin routes still require auth)
      const res = await client.api.admin.stats.$get()

      // Should return 401
      expect(res.status).toBe(401)

      // Response should be JSON
      const contentType = res.headers.get('content-type')
      expect(contentType).toContain('application/json')

      // Response body should be JSON object
      const data = await res.json()
      expect(data).toMatchObject({
        success: false,
        error: expect.stringContaining('Missing authentication token'),
        status: 401,
      })
    })

    it('should return JSON format for invalid authentication token', async () => {
      const client = createTestClient()

      // Call a protected endpoint with invalid token
      const res = await client.api.admin.stats.$get(undefined, {
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      })

      // Should return 401
      expect(res.status).toBe(401)

      // Response body should be JSON object
      const data = await res.json()
      expect(data).toMatchObject({
        success: false,
        error: expect.stringContaining('Invalid authentication token'),
        status: 401,
      })
    })
  })

  describe('Permission Errors', () => {
    it('should return JSON format for insufficient permissions', async () => {
      const client = createTestClient()

      // Call a protected endpoint with valid token but insufficient permissions
      // user-token has 'user' role which doesn't have admin permissions
      const res = await client.api.admin.stats.$get(undefined, {
        headers: {
          Authorization: 'Bearer user-token',
        },
      })

      // Should return 403
      expect(res.status).toBe(403)

      // Response should be JSON
      const contentType = res.headers.get('content-type')
      expect(contentType).toContain('application/json')

      // Response body should be JSON object
      const data = await res.json()
      expect(data).toMatchObject({
        success: false,
        error: expect.stringContaining('Insufficient permissions'),
        status: 403,
      })
    })
  })

  describe('All error responses should be JSON', () => {
    it('should never return plain text error', async () => {
      const client = createTestClient()

      // Make request without auth
      const res = await client.api.admin.stats.$get()

      const text = await res.text()

      // Should be valid JSON, not plain text
      expect(() => JSON.parse(text)).not.toThrow()

      // Should not contain plain text error message without JSON structure
      expect(text.trim().startsWith('{')).toBe(true)
      expect(text.trim().endsWith('}')).toBe(true)
    })
  })
})
