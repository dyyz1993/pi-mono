import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { authMiddleware } from '../../middleware/auth'
import { getAuthUser } from '../../utils/auth'
import { permissionService } from '../services/permission-service-impl'
import { successResponse, errorResponse, success } from '../../utils/route-helpers'
import {
  RoleInfoSchema,
  PermissionInfoSchema,
  UserPermissionsSchema,
  MenuConfigSchema,
  PagePermissionsSchema,
  PermissionCategoriesSchema,
  RoleLabelsSchema,
  PermissionLabelsSchema,
  Permission,
} from '@shared/modules/permission'
import * as permissionServiceOld from '../services/permission-service'

const getRolesRoute = createRoute({
  method: 'get',
  path: '/permissions/roles',
  tags: ['permissions'],
  responses: {
    200: successResponse(RoleInfoSchema.array(), 'Get all roles'),
  },
})

const getPermissionsRoute = createRoute({
  method: 'get',
  path: '/permissions',
  tags: ['permissions'],
  responses: {
    200: successResponse(PermissionInfoSchema.array(), 'Get all permissions'),
  },
})

const getUserPermissionsRoute = createRoute({
  method: 'get',
  path: '/permissions/me',
  tags: ['permissions'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  responses: {
    200: successResponse(UserPermissionsSchema, 'Get current user permissions'),
    401: errorResponse('Unauthorized'),
  },
})

const getMenuConfigRoute = createRoute({
  method: 'get',
  path: '/permissions/menu-config',
  tags: ['permissions'],
  responses: {
    200: successResponse(MenuConfigSchema, 'Get menu configuration'),
  },
})

const getPagePermissionsRoute = createRoute({
  method: 'get',
  path: '/permissions/page-permissions',
  tags: ['permissions'],
  responses: {
    200: successResponse(PagePermissionsSchema, 'Get page permissions configuration'),
  },
})

const getPermissionCategoriesRoute = createRoute({
  method: 'get',
  path: '/permissions/categories',
  tags: ['permissions'],
  responses: {
    200: successResponse(PermissionCategoriesSchema, 'Get permission categories'),
  },
})

const getRoleLabelsRoute = createRoute({
  method: 'get',
  path: '/permissions/role-labels',
  tags: ['permissions'],
  responses: {
    200: successResponse(RoleLabelsSchema, 'Get role labels'),
  },
})

const getPermissionLabelsRoute = createRoute({
  method: 'get',
  path: '/permissions/permission-labels',
  tags: ['permissions'],
  responses: {
    200: successResponse(PermissionLabelsSchema, 'Get permission labels'),
  },
})

export const permissionRoutes = new OpenAPIHono()
  .openapi(getRolesRoute, async c => {
    const roles = await permissionService.getAllRoles()
    return c.json(success(roles), 200)
  })
  .openapi(getPermissionsRoute, async c => {
    const permissions = await permissionService.getAllPermissions()
    return c.json(success(permissions), 200)
  })
  .openapi(getUserPermissionsRoute, async c => {
    const user = getAuthUser(c)
    const userPermissions = await permissionService.getUserPermissions(user.id, user.role)
    const permissionCodes = userPermissions.map(p => p.code) as Permission[]
    return c.json(
      success({
        userId: user.id,
        role: user.role,
        permissions: permissionCodes,
      }),
      200
    )
  })
  .openapi(getMenuConfigRoute, async c => {
    const menuConfig = permissionServiceOld.getMenuConfig()
    return c.json(success(menuConfig), 200)
  })
  .openapi(getPagePermissionsRoute, async c => {
    const pagePermissions = permissionServiceOld.getPagePermissions()
    return c.json(success(pagePermissions), 200)
  })
  .openapi(getPermissionCategoriesRoute, async c => {
    const categories = permissionServiceOld.getPermissionCategories()
    return c.json(success(categories), 200)
  })
  .openapi(getRoleLabelsRoute, async c => {
    const labels = permissionServiceOld.getRoleLabels()
    return c.json(success(labels), 200)
  })
  .openapi(getPermissionLabelsRoute, async c => {
    const labels = permissionServiceOld.getPermissionLabels()
    return c.json(success(labels), 200)
  })
