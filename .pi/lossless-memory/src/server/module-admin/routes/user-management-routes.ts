import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { authMiddleware, type AuthUser } from '../../middleware/auth'
import * as adminService from '../services/admin-service'
import { successResponse, errorResponse, success } from '../../utils/route-helpers'
import { Permission } from '@shared/modules/permission'
import {
  UserSchema,
  UserListSchema,
  UpdateUserRequestSchema,
  CreateUserRequestSchema,
  SuccessSchema,
} from '@shared/modules/admin'

const getUsersRoute = createRoute({
  method: 'get',
  path: '/admin/users',
  tags: ['admin'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.USER_VIEW] })],
  responses: {
    200: successResponse(UserListSchema, 'Get user list'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
  },
})

const getUserRoute = createRoute({
  method: 'get',
  path: '/admin/users/:id',
  tags: ['admin'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.USER_VIEW] })],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: successResponse(UserSchema, 'Get user'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('User not found'),
  },
})

const updateUserRoute = createRoute({
  method: 'put',
  path: '/admin/users/:id',
  tags: ['admin'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.USER_EDIT] })],
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateUserRequestSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(UserSchema, 'User updated'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('User not found'),
  },
})

const deleteUserRoute = createRoute({
  method: 'delete',
  path: '/admin/users/:id',
  tags: ['admin'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.USER_DELETE] })],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: successResponse(SuccessSchema, 'User deleted'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('User not found'),
  },
})

const createUserRoute = createRoute({
  method: 'post',
  path: '/admin/users',
  tags: ['admin'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.USER_CREATE] })],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateUserRequestSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(UserSchema, 'User created'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    400: errorResponse('Invalid request'),
  },
})

export const userManagementRoutes = new OpenAPIHono<{ Variables: { authUser: AuthUser } }>()
  .openapi(getUsersRoute, async c => {
    const users = await adminService.getUsers()
    return c.json(success(users), 200)
  })
  .openapi(getUserRoute, async c => {
    const { id } = c.req.valid('param')
    const user = await adminService.getUserById(id)
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404)
    }
    return c.json(success(user), 200)
  })
  .openapi(updateUserRoute, async c => {
    const { id } = c.req.valid('param')
    const data = c.req.valid('json')
    const user = await adminService.updateUser(id, data)
    return c.json(success(user), 200)
  })
  .openapi(deleteUserRoute, async c => {
    const { id } = c.req.valid('param')
    await adminService.deleteUser(id)
    return c.json(success({}), 200)
  })
  .openapi(createUserRoute, async c => {
    const data = c.req.valid('json')
    const user = await adminService.createUser(data)
    return c.json(success(user), 200)
  })
