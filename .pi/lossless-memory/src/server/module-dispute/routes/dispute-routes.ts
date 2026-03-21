import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import * as disputeService from '../services/dispute-service'
import {
  defineResponses,
  defineCreateResponses,
  defineDeleteResponses,
  idRequest,
  bodyRequest,
  success,
  created,
} from '../../utils/route-helpers'
import { authMiddleware } from '../../middleware/auth'
import { Permission } from '@shared/modules/permission'
import {
  DisputeSchema,
  CreateDisputeSchema,
  UpdateDisputeSchema,
  DisputeListSchema,
  ResolveDisputeSchema,
} from '@shared/modules/dispute'
import { NotFoundError, BusinessError } from '../../utils/app-error'

// 列表路由 - 无特殊业务错误
const listRoute = createRoute({
  method: 'get',
  path: '/disputes',
  tags: ['disputes'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.DISPUTE_VIEW] })],
  responses: defineResponses(DisputeListSchema, 'List all disputes'),
})

// 获取单个 - 可能 404
const getRoute = createRoute({
  method: 'get',
  path: '/disputes/{id}',
  tags: ['disputes'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.DISPUTE_VIEW] })],
  request: { params: DisputeSchema.pick({ id: true }) },
  responses: defineResponses(DisputeSchema, 'Get dispute by id', {
    notFound: 'Dispute not found',
  }),
})

// 创建路由 - 201
const createRouteDef = createRoute({
  method: 'post',
  path: '/disputes',
  tags: ['disputes'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.DISPUTE_CREATE] })],
  request: bodyRequest(CreateDisputeSchema),
  responses: defineCreateResponses(DisputeSchema, 'Create dispute'),
})

// 更新路由 - 可能 404
const updateRoute = createRoute({
  method: 'put',
  path: '/disputes/{id}',
  tags: ['disputes'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.DISPUTE_EDIT] })],
  request: { params: DisputeSchema.pick({ id: true }), ...bodyRequest(UpdateDisputeSchema) },
  responses: defineResponses(DisputeSchema, 'Update dispute', {
    notFound: 'Dispute not found',
  }),
})

// 删除路由 - 可能 404
const deleteRoute = createRoute({
  method: 'delete',
  path: '/disputes/{id}',
  tags: ['disputes'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.DISPUTE_DELETE] })],
  request: idRequest,
  responses: defineDeleteResponses({ notFound: 'Dispute not found' }),
})

// 解决争议 - 可能 404 或 422（业务规则）
const resolveRoute = createRoute({
  method: 'put',
  path: '/disputes/{id}/resolve',
  tags: ['disputes'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.DISPUTE_RESOLVE] })],
  request: { params: DisputeSchema.pick({ id: true }), ...bodyRequest(ResolveDisputeSchema) },
  responses: defineResponses(DisputeSchema, 'Dispute resolved', {
    notFound: 'Dispute not found',
    businessError: 'Cannot resolve dispute in current state',
  }),
})

export const disputeRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => {
    const result = await disputeService.getDisputes()
    return c.json(success(result), 200)
  })
  .openapi(getRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await disputeService.getDisputeById(id)
    if (!result) throw NotFoundError.dispute(id)
    return c.json(success(result), 200)
  })
  .openapi(createRouteDef, async c => {
    const body = c.req.valid('json')
    const result = await disputeService.createDispute(body)
    return c.json(created(result), 201)
  })
  .openapi(updateRoute, async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await disputeService.updateDispute(id, body)
    if (!result) throw NotFoundError.dispute(id)
    return c.json(success(result), 200)
  })
  .openapi(deleteRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await disputeService.deleteDispute(id)
    if (!result.success) throw NotFoundError.dispute(id)
    return c.json(success({ message: 'Deleted successfully' }), 200)
  })
  .openapi(resolveRoute, async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await disputeService.resolveDispute(id, body)
    if (!result) throw new BusinessError('Cannot resolve dispute in current state')
    return c.json(success(result), 200)
  })
