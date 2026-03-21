import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import * as todoService from '../services/todo-service'
import {
  TodoSchema,
  CreateTodoSchema,
  UpdateTodoSchema,
  TodoIdResponseSchema,
  TodoAttachmentSchema,
  TodoAttachmentListSchema,
  TodoWithAttachmentsSchema,
  UploadFileSchema,
  AttachmentIdResponseSchema,
} from '@shared/schemas'
import { successResponse, errorResponse, success, created } from '@server/utils/route-helpers'
import { getAuthUser } from '../../utils/auth'
import { NotFoundError, ValidationError } from '@server/utils/app-error'

const TodoListSchema = z.array(TodoSchema)

const listRoute = createRoute({
  method: 'get',
  path: '/todos',
  tags: ['todos'],
  responses: {
    200: successResponse(TodoListSchema, 'List all todos'),
    500: errorResponse('Internal server error'),
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/todos/{id}',
  tags: ['todos'],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: successResponse(TodoSchema, 'Get a todo by ID'),
    404: errorResponse('Todo not found'),
  },
})

const createRouteDef = createRoute({
  method: 'post',
  path: '/todos',
  tags: ['todos'],
  request: {
    body: {
      content: { 'application/json': { schema: CreateTodoSchema } },
    },
  },
  responses: {
    201: successResponse(TodoSchema, 'Create a new todo'),
    400: errorResponse('Invalid input'),
  },
})

const updateRoute = createRoute({
  method: 'put',
  path: '/todos/{id}',
  tags: ['todos'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: UpdateTodoSchema } },
    },
  },
  responses: {
    200: successResponse(TodoSchema, 'Update a todo'),
    404: errorResponse('Todo not found'),
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/todos/{id}',
  tags: ['todos'],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: successResponse(TodoIdResponseSchema, 'Delete a todo'),
    404: errorResponse('Todo not found'),
  },
})

const uploadAttachmentRoute = createRoute({
  method: 'post',
  path: '/todos/{id}/attachments',
  tags: ['todos'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: UploadFileSchema,
        },
      },
    },
  },
  responses: {
    201: successResponse(TodoAttachmentSchema, 'File uploaded successfully'),
    404: errorResponse('Todo not found'),
    400: errorResponse('Invalid file or file too large'),
  },
})

const listAttachmentsRoute = createRoute({
  method: 'get',
  path: '/todos/{id}/attachments',
  tags: ['todos'],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: successResponse(TodoAttachmentListSchema, 'List attachments'),
    404: errorResponse('Todo not found'),
  },
})

const getTodoWithAttachmentsRoute = createRoute({
  method: 'get',
  path: '/todos/{id}/with-attachments',
  tags: ['todos'],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: successResponse(TodoWithAttachmentsSchema, 'Get todo with attachments'),
    404: errorResponse('Todo not found'),
  },
})

const deleteAttachmentRoute = createRoute({
  method: 'delete',
  path: '/todos/{todoId}/attachments/{attachmentId}',
  tags: ['todos'],
  request: {
    params: z.object({
      todoId: z.string(),
      attachmentId: z.string(),
    }),
  },
  responses: {
    200: successResponse(AttachmentIdResponseSchema, 'Attachment deleted'),
    404: errorResponse('Attachment not found'),
  },
})

export const apiRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => {
    const todos = await todoService.listTodos()
    return c.json(success(todos), 200)
  })
  .openapi(getRoute, async c => {
    const { id } = c.req.valid('param')
    const todo = await todoService.getTodo(parseInt(id))
    if (!todo) throw new NotFoundError('Todo', id)
    return c.json(success(todo), 200)
  })
  .openapi(createRouteDef, async c => {
    const data = c.req.valid('json')
    const todo = await todoService.createTodo(data)
    return c.json(created(todo), 201)
  })
  .openapi(updateRoute, async c => {
    const { id } = c.req.valid('param')
    const data = c.req.valid('json')
    const todo = await todoService.updateTodo(parseInt(id), data)
    if (!todo) throw new NotFoundError('Todo', id)
    return c.json(success(todo), 200)
  })
  .openapi(deleteRoute, async c => {
    const { id } = c.req.valid('param')
    const numericId = parseInt(id)
    const result = await todoService.deleteTodo(numericId)
    if (!result) throw new NotFoundError('Todo', id)
    return c.json(success({ id: numericId }), 200)
  })
  .openapi(uploadAttachmentRoute, async c => {
    const { id } = c.req.valid('param')
    const todoId = parseInt(id)

    const todo = await todoService.getTodo(todoId)
    if (!todo) throw new NotFoundError('Todo', id)

    const body = c.req.valid('form')
    const file = body['file']

    if (!file || !(file instanceof File)) {
      throw new ValidationError('No file uploaded')
    }

    const user = getAuthUser(c)
    const arrayBuffer = await file.arrayBuffer()

    try {
      const attachment = await todoService.uploadAttachment(
        todoId,
        {
          name: file.name,
          type: file.type,
          size: file.size,
          data: arrayBuffer,
        },
        user?.id
      )

      return c.json(created(attachment), 201)
    } catch (error) {
      throw new ValidationError((error as Error).message)
    }
  })
  .openapi(listAttachmentsRoute, async c => {
    const { id } = c.req.valid('param')
    const todoId = parseInt(id)

    const todo = await todoService.getTodo(todoId)
    if (!todo) throw new NotFoundError('Todo', id)

    const attachments = await todoService.listAttachments(todoId)
    return c.json(success(attachments), 200)
  })
  .openapi(getTodoWithAttachmentsRoute, async c => {
    const { id } = c.req.valid('param')
    const todo = await todoService.getTodoWithAttachments(parseInt(id))
    if (!todo) throw new NotFoundError('Todo', id)
    return c.json(success(todo), 200)
  })
  .openapi(deleteAttachmentRoute, async c => {
    const { attachmentId } = c.req.valid('param')
    const numericId = parseInt(attachmentId)
    const result = await todoService.deleteAttachment(numericId)
    if (!result) throw new NotFoundError('Attachment', attachmentId)
    return c.json(success({ id: numericId }), 200)
  })
  .doc('/docs', {
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Todo API',
    },
  })
