import { Command } from 'commander'
import { registerAutoCommand, type RouteConfig } from '../../utils/auto-command'
import { z } from '@hono/zod-openapi'

const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed'])

const todoRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/todos',
    command: 'list',
    description: 'List all todos',
  },
  {
    method: 'get',
    path: '/todos/{id}',
    command: 'get',
    description: 'Get a todo by ID',
    params: z.object({ id: z.string() }),
  },
  {
    method: 'post',
    path: '/todos',
    command: 'create',
    description: 'Create a new todo',
    body: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
    }),
  },
  {
    method: 'put',
    path: '/todos/{id}',
    command: 'update',
    description: 'Update a todo',
    params: z.object({ id: z.string() }),
    body: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      status: TodoStatusSchema.optional(),
    }),
  },
  {
    method: 'delete',
    path: '/todos/{id}',
    command: 'delete',
    description: 'Delete a todo',
    params: z.object({ id: z.string() }),
  },
]

export function registerTodoCommands(program: Command) {
  const todo = program.command('todo').description('Todo management commands')

  for (const route of todoRoutes) {
    registerAutoCommand(todo, route)
  }
}

export { todoRoutes }
