import { MiddlewareHandler } from 'hono'
import { getAuthUser } from '../utils/auth'
import { permissionService } from '../module-permission/services/permission-service-impl'
import { roleService } from '../module-permission/services/role-service'
import { logger } from '../utils/logger'

const log = logger.api()

interface RouteConfig {
  path: string
  method: string
  isPublic: boolean
  permissions: string[]
}

const publicRoutes: RouteConfig[] = [
  { path: '/api/admin/login', method: 'POST', isPublic: true, permissions: [] },
  { path: '/api/admin/register', method: 'POST', isPublic: true, permissions: [] },
  { path: '/api/permissions', method: 'GET', isPublic: true, permissions: [] },
  { path: '/api/permissions/roles', method: 'GET', isPublic: true, permissions: [] },
  { path: '/api/permissions/categories', method: 'GET', isPublic: true, permissions: [] },
  { path: '/api/permissions/role-labels', method: 'GET', isPublic: true, permissions: [] },
  { path: '/api/permissions/permission-labels', method: 'GET', isPublic: true, permissions: [] },
  { path: '/api/permissions/menu-config', method: 'GET', isPublic: true, permissions: [] },
  { path: '/api/permissions/page-permissions', method: 'GET', isPublic: true, permissions: [] },
]

const permissionRoutes: RouteConfig[] = [
  { path: '/api/admin/users', method: 'GET', isPublic: false, permissions: ['user:view'] },
  { path: '/api/admin/users', method: 'POST', isPublic: false, permissions: ['user:create'] },
  { path: '/api/admin/users/:id', method: 'PUT', isPublic: false, permissions: ['user:edit'] },
  { path: '/api/admin/users/:id', method: 'DELETE', isPublic: false, permissions: ['user:delete'] },
  { path: '/api/content', method: 'GET', isPublic: false, permissions: ['content:view'] },
  { path: '/api/content', method: 'POST', isPublic: false, permissions: ['content:create'] },
  { path: '/api/content/:id', method: 'PUT', isPublic: false, permissions: ['content:edit'] },
  { path: '/api/content/:id', method: 'DELETE', isPublic: false, permissions: ['content:delete'] },
  { path: '/api/admin/settings', method: 'GET', isPublic: false, permissions: ['system:settings'] },
  { path: '/api/admin/settings', method: 'PUT', isPublic: false, permissions: ['system:settings'] },
  { path: '/api/admin/logs', method: 'GET', isPublic: false, permissions: ['system:logs'] },
]

function matchRoute(requestPath: string, requestMethod: string): RouteConfig | undefined {
  const publicRoute = publicRoutes.find(r => r.path === requestPath && r.method === requestMethod)
  if (publicRoute) return publicRoute

  for (const route of permissionRoutes) {
    const routeParts = route.path.split('/')
    const requestParts = requestPath.split('/')

    if (routeParts.length !== requestParts.length || route.method !== requestMethod) {
      continue
    }

    let match = true
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        continue
      }
      if (routeParts[i] !== requestParts[i]) {
        match = false
        break
      }
    }

    if (match) return route
  }

  return undefined
}

export function permissionMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path
    const method = c.req.method

    const routeConfig = matchRoute(path, method)

    if (!routeConfig || routeConfig.isPublic) {
      return next()
    }

    const user = getAuthUser(c)
    if (!user) {
      // 没有用户信息，跳过权限检查，让路由的认证中间件处理
      return next()
    }

    if (routeConfig.permissions.length === 0) {
      return next()
    }

    log.info(
      { path, method, userId: user.id, requiredPermissions: routeConfig.permissions },
      'Checking permissions'
    )

    const userRoles = await roleService.getUserRoles(user.id)
    const isSuperAdmin = userRoles.some(r => r.code === 'super_admin')

    if (isSuperAdmin) {
      log.info({ userId: user.id }, 'User is super admin, allowing access')
      return next()
    }

    for (const permissionCode of routeConfig.permissions) {
      const hasPermission = await permissionService.hasPermission(user.id, permissionCode)
      log.info({ userId: user.id, permissionCode, hasPermission }, 'Permission check result')
      if (hasPermission) {
        return next()
      }
    }

    log.warn(
      { path, method, userId: user.id, requiredPermissions: routeConfig.permissions },
      'Forbidden: no permission'
    )
    return c.json(
      {
        success: false,
        error: 'Forbidden: You do not have permission to access this resource',
      },
      403
    )
  }
}
