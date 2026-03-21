import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import * as orderService from '../services/order-service'
import { successResponse, errorResponse, success, created } from '../../utils/route-helpers'
import { NotFoundError } from '@server/utils/app-error'
import { authMiddleware } from '../../middleware/auth'
import { Permission } from '@shared/modules/permission'
import {
  OrderSchema,
  CreateOrderSchema,
  UpdateOrderSchema,
  OrderListSchema,
  DeleteResultSchema,
} from '@shared/modules/order'

const listRoute = createRoute({
  method: 'get',
  path: '/orders',
  tags: ['orders'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.ORDER_VIEW] })],
  responses: {
    200: successResponse(OrderListSchema, 'List all orders'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    500: errorResponse('Internal server error'),
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/orders/{id}',
  tags: ['orders'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.ORDER_VIEW] })],
  request: {
    params: OrderSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(OrderSchema, 'Get order by id'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Order not found'),
    500: errorResponse('Internal server error'),
  },
})

const createRouteDef = createRoute({
  method: 'post',
  path: '/orders',
  tags: ['orders'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.ORDER_VIEW] })],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateOrderSchema,
        },
      },
    },
  },
  responses: {
    201: successResponse(OrderSchema, 'Create order'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    400: errorResponse('Invalid input'),
    500: errorResponse('Internal server error'),
  },
})

const updateRoute = createRoute({
  method: 'put',
  path: '/orders/{id}',
  tags: ['orders'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.ORDER_VIEW] })],
  request: {
    params: OrderSchema.pick({ id: true }),
    body: {
      content: {
        'application/json': {
          schema: UpdateOrderSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(OrderSchema, 'Update order'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Order not found'),
    400: errorResponse('Invalid input'),
    500: errorResponse('Internal server error'),
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/orders/{id}',
  tags: ['orders'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.ORDER_VIEW] })],
  request: {
    params: OrderSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(DeleteResultSchema, 'Order deleted'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Order not found'),
    500: errorResponse('Internal server error'),
  },
})

const processRoute = createRoute({
  method: 'put',
  path: '/orders/{id}/process',
  tags: ['orders'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.ORDER_PROCESS] })],
  request: {
    params: OrderSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(OrderSchema, 'Order processed'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Order not found'),
    400: errorResponse('Cannot process order'),
    500: errorResponse('Internal server error'),
  },
})

const cancelRoute = createRoute({
  method: 'put',
  path: '/orders/{id}/cancel',
  tags: ['orders'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.ORDER_PROCESS] })],
  request: {
    params: OrderSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(OrderSchema, 'Order cancelled'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Order not found'),
    400: errorResponse('Cannot cancel order'),
    500: errorResponse('Internal server error'),
  },
})

export const orderRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => {
    const result = await orderService.getOrders()
    return c.json(success(result), 200)
  })
  .openapi(getRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await orderService.getOrderById(id)
    if (!result) throw new NotFoundError('Order', id)
    return c.json(success(result), 200)
  })
  .openapi(createRouteDef, async c => {
    const body = c.req.valid('json')
    const result = await orderService.createOrder(body)
    return c.json(created(result), 201)
  })
  .openapi(updateRoute, async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await orderService.updateOrder(id, body)
    if (!result) throw new NotFoundError('Order', id)
    return c.json(success(result), 200)
  })
  .openapi(deleteRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await orderService.deleteOrder(id)
    if (!result) throw new NotFoundError('Order', id)
    return c.json(success({ message: 'Deleted successfully' }), 200)
  })
  .openapi(processRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await orderService.processOrder(id)
    if (!result) throw new NotFoundError('Order', id)
    return c.json(success(result), 200)
  })
  .openapi(cancelRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await orderService.cancelOrder(id)
    if (!result) throw new NotFoundError('Order', id)
    return c.json(success(result), 200)
  })
