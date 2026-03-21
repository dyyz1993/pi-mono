import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { authMiddleware } from '../auth'
import { Role } from '@shared/modules/admin'

describe('Auth Middleware Simple Test', () => {
  describe('Success Scenarios', () => {
    it('should allow super admin with requiredRole', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer super-admin-token' },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean }
      expect(data.success).toBe(true)
    })

    it('should allow super admin with admin-token', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer admin-token' },
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean }
      expect(data.success).toBe(true)
    })
  })

  describe('Error Scenarios', () => {
    it('should reject request without Authorization header', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test')

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should reject request with invalid token format', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test', {
        headers: { Authorization: 'InvalidFormat token123' },
      })

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should reject request with invalid token', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer invalid-token-xyz' },
      })

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should reject user with insufficient role', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer user-token' },
      })

      expect(res.status).toBe(403)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should reject customer service user for super admin routes', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer customer-service-token' },
      })

      expect(res.status).toBe(403)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should handle empty Authorization header', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test', {
        headers: { Authorization: '' },
      })

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should handle Bearer prefix without token', async () => {
      const app = new Hono()
      app.use('/test', authMiddleware({ requiredRole: Role.SUPER_ADMIN }))
      app.get('/test', c => c.json({ success: true }))

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer ' },
      })

      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })
  })
})
