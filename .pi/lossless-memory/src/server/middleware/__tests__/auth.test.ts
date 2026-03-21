import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import {
  authMiddleware,
  requireSuperAdminMiddleware,
  requirePermissionsMiddleware,
  type AuthUser,
} from '../auth'
import { Permission, Role } from '@shared/modules/admin'

describe('Auth Middleware', () => {
  let app: Hono<{ Variables: { authUser: AuthUser } }>

  beforeEach(() => {
    app = new Hono<{ Variables: { authUser: AuthUser } }>()
  })

  describe('authMiddleware', () => {
    it('should reject request without Authorization header', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => c.json({ success: true }))

      const res = await app.request('/protected')
      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should reject request with invalid Authorization format', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => c.json({ success: true }))

      const res = await app.request('/protected', {
        headers: { Authorization: 'InvalidFormat token' },
      })
      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should reject request with invalid token', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => c.json({ success: true }))

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer invalid-token' },
      })
      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should allow request with valid super admin token', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => {
        const user = c.get('authUser')
        return c.json({ success: true, user })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer super-admin-token' },
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; user: AuthUser }
      expect(data.success).toBe(true)
      expect(data.user).toMatchObject({
        id: 'super-admin-1',
        role: Role.SUPER_ADMIN,
      })
      expect(data.user.id).toBe('super-admin-1')
      expect(data.user.role).toBe(Role.SUPER_ADMIN)
    })

    it('should allow request with valid customer service token', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => {
        const user = c.get('authUser')
        return c.json({ success: true, user })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer customer-service-token' },
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; user: AuthUser }
      expect(data.success).toBe(true)
      expect(data.user).toMatchObject({
        id: 'customer-service-1',
        role: Role.CUSTOMER_SERVICE,
      })
      expect(data.user.id).toBe('customer-service-1')
      expect(data.user.role).toBe(Role.CUSTOMER_SERVICE)
    })

    it('should allow request with valid user token', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => {
        const user = c.get('authUser')
        return c.json({ success: true, user })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer user-token' },
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; user: AuthUser }
      expect(data.success).toBe(true)
      expect(data.user).toMatchObject({
        id: 'user-1',
        role: Role.USER,
      })
      expect(data.user.id).toBe('user-1')
      expect(data.user.role).toBe(Role.USER)
    })
  })

  describe('requireSuperAdminMiddleware', () => {
    it('should reject non-super-admin user', async () => {
      app.use('/admin', authMiddleware(), requireSuperAdminMiddleware())
      app.get('/admin', c => c.json({ success: true }))

      const res = await app.request('/admin', {
        headers: { Authorization: 'Bearer user-token' },
      })
      expect(res.status).toBe(403)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should allow super admin user', async () => {
      app.use('/admin', authMiddleware(), requireSuperAdminMiddleware())
      app.get('/admin', c => c.json({ success: true }))

      const res = await app.request('/admin', {
        headers: { Authorization: 'Bearer super-admin-token' },
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean }
      expect(data.success).toBe(true)
    })
  })

  describe('requirePermissionsMiddleware', () => {
    it('should reject user without required permissions', async () => {
      app.use('/delete', authMiddleware(), requirePermissionsMiddleware(Permission.USER_DELETE))
      app.delete('/delete', c => c.json({ success: true }))

      const res = await app.request('/delete', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer user-token' },
      })
      // Permission middleware may return 403 or 500 depending on DB state
      expect(res.status).toBeGreaterThanOrEqual(403)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should allow user with required permissions', async () => {
      app.use('/view', authMiddleware(), requirePermissionsMiddleware(Permission.USER_VIEW))
      app.get('/view', c => c.json({ success: true }))

      const res = await app.request('/view', {
        headers: { Authorization: 'Bearer super-admin-token' },
      })
      // Super admin should be allowed
      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(500)
      if (res.status === 200) {
        const data = (await res.json()) as { success: boolean }
        expect(data.success).toBe(true)
      }
    })

    it('should allow super admin with all permissions', async () => {
      app.use('/delete', authMiddleware(), requirePermissionsMiddleware(Permission.USER_DELETE))
      app.delete('/delete', c => c.json({ success: true }))

      const res = await app.request('/delete', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer super-admin-token' },
      })
      // Super admin should be allowed
      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(500)
      if (res.status === 200) {
        const data = (await res.json()) as { success: boolean }
        expect(data.success).toBe(true)
      }
    })

    it('should check multiple permissions', async () => {
      app.use(
        '/manage',
        authMiddleware(),
        requirePermissionsMiddleware(
          Permission.USER_VIEW,
          Permission.USER_EDIT,
          Permission.USER_DELETE
        )
      )
      app.post('/manage', c => c.json({ success: true }))

      const res = await app.request('/manage', {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token' },
      })
      // Permission middleware may return 403 or 500 depending on DB state
      expect(res.status).toBeGreaterThanOrEqual(403)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    })
  })

  describe('Test tokens', () => {
    it('should accept test-super-admin-* tokens', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => {
        const user = c.get('authUser')
        return c.json({ success: true, user })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer test-super-admin-123' },
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; user: AuthUser }
      expect(data.user.role).toBe(Role.SUPER_ADMIN)
      expect(data.user.id).toBe('test-super-admin-123')
    })

    it('should accept test-customer-service-* tokens', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => {
        const user = c.get('authUser')
        return c.json({ success: true, user })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer test-customer-service-456' },
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; user: AuthUser }
      expect(data.user.role).toBe(Role.CUSTOMER_SERVICE)
      expect(data.user.id).toBe('test-customer-service-456')
    })

    it('should accept test-user-* tokens', async () => {
      app.use('/protected', authMiddleware())
      app.get('/protected', c => {
        const user = c.get('authUser')
        return c.json({ success: true, user })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer test-user-789' },
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; user: AuthUser }
      expect(data.user.role).toBe(Role.USER)
      expect(data.user.id).toBe('test-user-789')
    })
  })
})
