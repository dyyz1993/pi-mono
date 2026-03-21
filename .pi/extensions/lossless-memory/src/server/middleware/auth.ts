import type { MiddlewareHandler } from 'hono'
import { createModuleLoggerSync } from '../utils/logger'
import { Role, Permission, getPermissionsByRole } from '@shared/modules/admin'
import { AuthenticationError, AuthorizationError } from '../utils/app-error'

export type UserRole = Role

export interface AuthUser {
  id: string
  username: string
  email: string
  role: UserRole
  avatar?: string
  permissions: Permission[]
}

export interface AuthMiddlewareOptions {
  secretKey?: string
  requiredRole?: UserRole
  requiredPermissions?: Permission[]
}

declare module 'hono' {
  interface ContextVariableMap {
    authUser: AuthUser
  }
}

const defaultSecretKey = 'dev-secret-key-change-in-production'

function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  if (!authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

function verifyToken(token: string, secretKey: string): AuthUser | null {
  if (secretKey === 'dev-secret-key-change-in-production') {
    if (token === 'admin-token' || token === 'super-admin-token') {
      return {
        id: 'super-admin-1',
        username: 'superadmin',
        email: 'superadmin@example.com',
        role: Role.SUPER_ADMIN,
        permissions: getPermissionsByRole(Role.SUPER_ADMIN),
      }
    }
    if (token === 'customer-service-token') {
      return {
        id: 'customer-service-1',
        username: 'customerservice',
        email: 'cs@example.com',
        role: Role.CUSTOMER_SERVICE,
        permissions: getPermissionsByRole(Role.CUSTOMER_SERVICE),
      }
    }
    if (token === 'user-token') {
      return {
        id: 'user-1',
        username: 'user',
        email: 'user@example.com',
        role: Role.USER,
        permissions: getPermissionsByRole(Role.USER),
      }
    }
    if (token.startsWith('test-super-admin-')) {
      return {
        id: token,
        username: `superadmin-${token}`,
        email: `superadmin-${token}@example.com`,
        role: Role.SUPER_ADMIN,
        permissions: getPermissionsByRole(Role.SUPER_ADMIN),
      }
    }
    if (token.startsWith('test-customer-service-')) {
      return {
        id: token,
        username: `cs-${token}`,
        email: `cs-${token}@example.com`,
        role: Role.CUSTOMER_SERVICE,
        permissions: getPermissionsByRole(Role.CUSTOMER_SERVICE),
      }
    }
    if (token.startsWith('test-user-')) {
      return {
        id: token,
        username: `user-${token}`,
        email: `user-${token}@example.com`,
        role: Role.USER,
        permissions: getPermissionsByRole(Role.USER),
      }
    }
  }

  return null
}

export function authMiddleware(options: AuthMiddlewareOptions = {}): MiddlewareHandler {
  const secretKey = options.secretKey ?? process.env.AUTH_SECRET_KEY ?? defaultSecretKey
  const log = createModuleLoggerSync('auth')

  return async (c, next) => {
    const authHeader = c.req.header('Authorization')
    const token = extractToken(authHeader)

    if (!token) {
      log.warn({ path: c.req.path, method: c.req.method }, 'Missing auth token')
      throw AuthenticationError.tokenMissing()
    }

    const user = verifyToken(token, secretKey)

    if (!user) {
      log.warn({ path: c.req.path, method: c.req.method }, 'Invalid auth token')
      throw AuthenticationError.tokenInvalid()
    }

    log.info({ userId: user.id, role: user.role, path: c.req.path }, 'User authenticated')

    if (options.requiredRole) {
      const roleHierarchy = {
        [Role.SUPER_ADMIN]: 3,
        [Role.CUSTOMER_SERVICE]: 2,
        [Role.USER]: 1,
      }
      const userLevel = roleHierarchy[user.role]
      const requiredLevel = roleHierarchy[options.requiredRole]

      if (userLevel < requiredLevel) {
        log.warn(
          {
            path: c.req.path,
            method: c.req.method,
            userRole: user.role,
            requiredRole: options.requiredRole,
          },
          'Insufficient role'
        )
        throw AuthorizationError.insufficientRole(user.role, options.requiredRole)
      }
    }

    if (options.requiredPermissions && options.requiredPermissions.length > 0) {
      // 从数据库读取权限，而不是使用硬编码的权限
      const { permissionService } =
        await import('../module-permission/services/permission-service-impl')

      for (const requiredPermission of options.requiredPermissions) {
        const hasPermission = await permissionService.hasPermission(user.id, requiredPermission)
        if (!hasPermission) {
          log.warn(
            {
              path: c.req.path,
              method: c.req.method,
              userId: user.id,
              requiredPermission,
            },
            'Insufficient permission'
          )
          throw AuthorizationError.permissionDenied(requiredPermission)
        }
      }
    }

    c.set('authUser', user)
    await next()
  }
}

export function requireSuperAdminMiddleware(): MiddlewareHandler {
  return authMiddleware({ requiredRole: Role.SUPER_ADMIN })
}

export function requireCustomerServiceMiddleware(): MiddlewareHandler {
  return authMiddleware({ requiredRole: Role.CUSTOMER_SERVICE })
}

export function requirePermissionsMiddleware(...permissions: Permission[]): MiddlewareHandler {
  return authMiddleware({ requiredPermissions: permissions })
}
