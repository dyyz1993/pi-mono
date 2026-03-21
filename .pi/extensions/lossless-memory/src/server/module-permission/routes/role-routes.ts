import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import { authMiddleware } from '../../middleware/auth'
import { Role } from '@shared/modules/permission'
import { roleService } from '../services/role-service'
import { permissionService } from '../services/permission-service-impl'
import { successResponse, errorResponse, success } from '../../utils/route-helpers'
import {
  RoleSchema,
  CreateRoleSchema,
  UpdateRoleSchema,
  UpdateRolePermissionsSchema,
  SuccessSchema,
} from '@shared/modules/role/schemas'
import { validatePermissionDependencies } from '@shared/modules/permission/permission-dependencies'

const RoleWithPermissionsSchema = RoleSchema.extend({
  permissions: z.array(z.string()),
})

const getRolesRoute = createRoute({
  method: 'get',
  path: '/roles',
  tags: ['roles'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredRole: Role.SUPER_ADMIN })],
  responses: {
    200: successResponse(RoleSchema.array(), 'Get all roles'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
  },
})

const getRoleRoute = createRoute({
  method: 'get',
  path: '/roles/:id',
  tags: ['roles'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredRole: Role.SUPER_ADMIN })],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: successResponse(RoleWithPermissionsSchema, 'Get role by ID'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Role not found'),
  },
})

const createRoleRoute = createRoute({
  method: 'post',
  path: '/roles',
  tags: ['roles'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredRole: Role.SUPER_ADMIN })],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateRoleSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(RoleSchema, 'Role created'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    400: errorResponse('Invalid request'),
  },
})

const updateRoleRoute = createRoute({
  method: 'put',
  path: '/roles/:id',
  tags: ['roles'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredRole: Role.SUPER_ADMIN })],
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateRoleSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(RoleSchema, 'Role updated'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Role not found'),
  },
})

const deleteRoleRoute = createRoute({
  method: 'delete',
  path: '/roles/:id',
  tags: ['roles'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredRole: Role.SUPER_ADMIN })],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: successResponse(SuccessSchema, 'Role deleted'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    400: errorResponse('Cannot delete system role'),
  },
})

const updateRolePermissionsRoute = createRoute({
  method: 'put',
  path: '/roles/:id/permissions',
  tags: ['roles'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredRole: Role.SUPER_ADMIN })],
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateRolePermissionsSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(SuccessSchema, 'Role permissions updated'),
    400: errorResponse('Permission dependency validation failed'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Role not found'),
  },
})

export const roleRoutes = new OpenAPIHono()
  .openapi(getRolesRoute, async c => {
    const roles = await roleService.getAll()
    return c.json(success(roles), 200)
  })
  .openapi(getRoleRoute, async c => {
    const { id } = c.req.valid('param')
    const role = await roleService.getById(id)

    if (!role) {
      return c.json({ success: false, error: 'Role not found' }, 404)
    }

    const permissions = await permissionService.getRolePermissions(id)

    return c.json(
      success({
        ...role,
        permissions: permissions.map(p => p.code),
      }),
      200
    )
  })
  .openapi(createRoleRoute, async c => {
    const data = c.req.valid('json')
    const role = await roleService.create({
      id: `role_${Date.now()}`,
      ...data,
      sortOrder: data.sortOrder ?? 0,
    })

    return c.json(success(role), 200)
  })
  .openapi(updateRoleRoute, async c => {
    const { id } = c.req.valid('param')
    const data = c.req.valid('json')

    const role = await roleService.update(id, data)

    if (!role) {
      return c.json({ success: false, error: 'Role not found' }, 404)
    }

    return c.json(success(role), 200)
  })
  .openapi(deleteRoleRoute, async c => {
    const { id } = c.req.valid('param')

    const deleted = await roleService.delete(id)

    if (!deleted) {
      return c.json({ success: false, error: 'Cannot delete system role or role not found' }, 400)
    }

    return c.json(success({}), 200)
  })
  .openapi(updateRolePermissionsRoute, async c => {
    const { id } = c.req.valid('param')
    const { permissionIds } = c.req.valid('json')

    const role = await roleService.getById(id)
    if (!role) {
      return c.json({ success: false, error: 'Role not found' }, 404)
    }

    if (role.code === 'super_admin') {
      return c.json({ success: false, error: 'Cannot modify super admin permissions' }, 403)
    }

    const validation = validatePermissionDependencies(permissionIds)
    if (!validation.valid) {
      return c.json(
        {
          success: false,
          error: '权限依赖校验失败',
          details: validation.errors,
        },
        400
      )
    }

    const permissionObjects = await Promise.all(
      permissionIds.map(code => permissionService.getByCode(code))
    )
    const validPermissionIds = permissionObjects
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .map(p => p.id)

    const currentPermissions = await permissionService.getRolePermissions(id)
    const currentPermissionIds = currentPermissions.map(p => p.id)

    for (const permissionId of currentPermissionIds) {
      if (!validPermissionIds.includes(permissionId)) {
        await permissionService.revokePermissionFromRole(id, permissionId)
      }
    }

    for (const permissionId of validPermissionIds) {
      if (!currentPermissionIds.includes(permissionId)) {
        await permissionService.assignPermissionToRole(id, permissionId)
      }
    }

    return c.json(success({}), 200)
  })
