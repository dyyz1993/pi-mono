import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import { authMiddleware, type AuthUser } from '../../middleware/auth'
import * as adminService from '../services/admin-service'
import { errorResponse } from '../../utils/route-helpers'

const getAvatarRoute = createRoute({
  method: 'get',
  path: '/admin/avatar/:id',
  tags: ['media'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: {
      content: {
        'image/png': { schema: z.any().openapi({ type: 'string', format: 'binary' }) },
        'image/jpeg': { schema: z.any().openapi({ type: 'string', format: 'binary' }) },
      },
      description: 'User avatar image',
    },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Avatar not found'),
  },
})

const getIconRoute = createRoute({
  method: 'get',
  path: '/admin/icon/:name',
  tags: ['media'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware()],
  request: {
    params: z.object({
      name: z.string(),
    }),
  },
  responses: {
    200: {
      content: {
        'image/svg+xml': { schema: z.string() },
      },
      description: 'SVG icon',
    },
    401: errorResponse('Unauthorized'),
    404: errorResponse('Icon not found'),
  },
})

export const mediaRoutes = new OpenAPIHono<{ Variables: { authUser: AuthUser } }>()
  .openapi(getAvatarRoute, async c => {
    const { id } = c.req.valid('param')
    const avatar = await adminService.getAvatar(id)
    if (!avatar) {
      return c.json({ success: false, error: 'Avatar not found' }, 404)
    }
    return new Response(avatar.data, {
      headers: {
        'Content-Type': avatar.contentType,
      },
    })
  })
  .openapi(getIconRoute, async c => {
    const { name } = c.req.valid('param')
    const svg = await adminService.getIcon(name)
    if (!svg) {
      return c.json({ success: false, error: 'Icon not found' }, 404)
    }
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
      },
    })
  })
