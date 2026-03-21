import { createRoute } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import * as ticketService from '../services/ticket-service'
import { successResponse, errorResponse, success, created } from '../../utils/route-helpers'
import { NotFoundError } from '@server/utils/app-error'
import { authMiddleware } from '../../middleware/auth'
import { Permission } from '@shared/modules/permission'
import {
  TicketSchema,
  CreateTicketSchema,
  UpdateTicketSchema,
  TicketListSchema,
  DeleteResultSchema,
  ReplyTicketSchema,
} from '@shared/modules/ticket'

const listRoute = createRoute({
  method: 'get',
  path: '/tickets',
  tags: ['tickets'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.TICKET_VIEW] })],
  responses: {
    200: successResponse(TicketListSchema, 'List all tickets'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    500: errorResponse('Internal server error'),
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/tickets/{id}',
  tags: ['tickets'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.TICKET_VIEW] })],
  request: {
    params: TicketSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(TicketSchema, 'Get ticket by id'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Ticket not found'),
    500: errorResponse('Internal server error'),
  },
})

const createRouteDef = createRoute({
  method: 'post',
  path: '/tickets',
  tags: ['tickets'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.TICKET_VIEW] })],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTicketSchema,
        },
      },
    },
  },
  responses: {
    201: successResponse(TicketSchema, 'Create ticket'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    400: errorResponse('Invalid input'),
    500: errorResponse('Internal server error'),
  },
})

const updateRoute = createRoute({
  method: 'put',
  path: '/tickets/{id}',
  tags: ['tickets'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.TICKET_VIEW] })],
  request: {
    params: TicketSchema.pick({ id: true }),
    body: {
      content: {
        'application/json': {
          schema: UpdateTicketSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(TicketSchema, 'Update ticket'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Ticket not found'),
    400: errorResponse('Invalid input'),
    500: errorResponse('Internal server error'),
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/tickets/{id}',
  tags: ['tickets'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.TICKET_VIEW] })],
  request: {
    params: TicketSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(DeleteResultSchema, 'Ticket deleted'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Ticket not found'),
    500: errorResponse('Internal server error'),
  },
})

const replyRoute = createRoute({
  method: 'post',
  path: '/tickets/{id}/reply',
  tags: ['tickets'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.TICKET_REPLY] })],
  request: {
    params: TicketSchema.pick({ id: true }),
    body: {
      content: {
        'application/json': {
          schema: ReplyTicketSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(TicketSchema, 'Ticket replied'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Ticket not found'),
    400: errorResponse('Cannot reply ticket'),
    500: errorResponse('Internal server error'),
  },
})

const closeRoute = createRoute({
  method: 'put',
  path: '/tickets/{id}/close',
  tags: ['tickets'],
  security: [{ Bearer: [] }],
  middleware: [authMiddleware({ requiredPermissions: [Permission.TICKET_CLOSE] })],
  request: {
    params: TicketSchema.pick({ id: true }),
  },
  responses: {
    200: successResponse(TicketSchema, 'Ticket closed'),
    401: errorResponse('Unauthorized'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Ticket not found'),
    400: errorResponse('Cannot close ticket'),
    500: errorResponse('Internal server error'),
  },
})

export const ticketRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => {
    const result = await ticketService.getTickets()
    return c.json(success(result), 200)
  })
  .openapi(getRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await ticketService.getTicketById(id)
    if (!result) throw new NotFoundError('Ticket', id)
    return c.json(success(result), 200)
  })
  .openapi(createRouteDef, async c => {
    const body = c.req.valid('json')
    const result = await ticketService.createTicket(body)
    return c.json(created(result), 201)
  })
  .openapi(updateRoute, async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await ticketService.updateTicket(id, body)
    if (!result) throw new NotFoundError('Ticket', id)
    return c.json(success(result), 200)
  })
  .openapi(deleteRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await ticketService.deleteTicket(id)
    if (result.message === '工单不存在') throw new NotFoundError('Ticket', id)
    return c.json(success({ message: 'Deleted successfully' }), 200)
  })
  .openapi(replyRoute, async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await ticketService.replyTicket(id, body)
    if (!result) throw new NotFoundError('Ticket', id)
    return c.json(success(result), 200)
  })
  .openapi(closeRoute, async c => {
    const { id } = c.req.valid('param')
    const result = await ticketService.closeTicket(id)
    if (!result) throw new NotFoundError('Ticket', id)
    return c.json(success(result), 200)
  })
