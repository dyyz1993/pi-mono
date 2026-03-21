import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import * as contentService from '../services/content-service'
import { successResponse, errorResponse, success, created } from '../../utils/route-helpers'
import { NotFoundError } from '@server/utils/app-error'
import { authMiddleware } from '../../middleware/auth'
import { Permission } from '@shared/modules/permission'
import {
  ContentSchema,
  CreateContentSchema,
  UpdateContentSchema,
  ContentListSchema,
  DeleteResultSchema,
} from '@shared/modules/content'

const listRoute = createRoute({
  method: 'get',
  path: '/contents',
  tags: ['contents'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.CONTENT_VIEW] })],
  responses: {
    200: successResponse(ContentListSchema, 'List all contents'),
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/contents/{id}',
  tags: ['contents'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.CONTENT_VIEW] })],
  request: {
    params: ContentSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(ContentSchema, 'Get content by id'),
    404: errorResponse('Content not found'),
  },
})

const createRouteDef = createRoute({
  method: 'post',
  path: '/contents',
  tags: ['contents'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.CONTENT_CREATE] })],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateContentSchema,
        },
      },
    },
  },
  responses: {
    201: successResponse(ContentSchema, 'Create content'),
    400: errorResponse('Invalid input'),
  },
})

const updateRoute = createRoute({
  method: 'put',
  path: '/contents/{id}',
  tags: ['contents'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.CONTENT_EDIT] })],
  request: {
    params: ContentSchema.pick({ id: true }),
    body: {
      content: {
        'application/json': {
          schema: UpdateContentSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(ContentSchema, 'Update content'),
    404: errorResponse('Content not found'),
    400: errorResponse('Invalid input'),
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/contents/{id}',
  tags: ['contents'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.CONTENT_DELETE] })],
  request: {
    params: ContentSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(DeleteResultSchema, 'Content deleted'),
    404: errorResponse('Content not found'),
  },
})

export const contentRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => {
    const result = await contentService.getContents()
    return c.json(success(result), 200)
  })
  .openapi(getRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await contentService.getContentById(id)
    if (!result) throw new NotFoundError('Content', id)
    return c.json(success(result), 200)
  })
  .openapi(createRouteDef, async c => {
    const body = c.req.valid('json')
    const result = await contentService.createContent(body)
    return c.json(created(result), 201)
  })
  .openapi(updateRoute, async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await contentService.updateContent(id, body)
    if (!result) throw new NotFoundError('Content', id)
    return c.json(success(result), 200)
  })
  .openapi(deleteRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await contentService.deleteContent(id)
    if (!result) throw new NotFoundError('Content', id)
    return c.json(success(result), 200)
  })
