import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { authMiddleware, type AuthUser } from '../../middleware/auth'
import { getAuthUser } from '../../utils/auth'
import * as adminService from '../services/admin-service'
import { successResponse, errorResponse, success } from '../../utils/route-helpers'
import {
  AuthUserSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  RegisterRequestSchema,
  UserSchema,
} from '@shared/modules/admin'

const getCurrentUserRoute = createRoute({
  method: 'get',
  path: '/admin/me',
  tags: ['admin'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  responses: {
    200: successResponse(AuthUserSchema, 'Get current authenticated user'),
    401: errorResponse('Unauthorized'),
  },
})

const loginRoute = createRoute({
  method: 'post',
  path: '/admin/login',
  tags: ['admin'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(LoginResponseSchema, 'Login successful'),
    401: errorResponse('Invalid credentials'),
  },
})

const registerRoute = createRoute({
  method: 'post',
  path: '/admin/register',
  tags: ['admin'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: RegisterRequestSchema,
        },
      },
    },
  },
  responses: {
    201: successResponse(UserSchema, 'User registered'),
    400: errorResponse('User already exists'),
  },
})

export const authRoutes = new OpenAPIHono<{ Variables: { authUser: AuthUser } }>()
  .openapi(getCurrentUserRoute, async c => {
    const user = getAuthUser(c)
    return c.json(success(user), 200)
  })
  .openapi(loginRoute, async c => {
    const data = c.req.valid('json')
    const result = await adminService.login(data)
    return c.json(success(result), 200)
  })
  .openapi(registerRoute, async c => {
    const data = c.req.valid('json')
    const user = await adminService.register(data)
    return c.json(success(user), 201)
  })
