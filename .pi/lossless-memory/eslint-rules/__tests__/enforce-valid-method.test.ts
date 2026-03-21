import { RuleTester } from 'eslint'
import { enforceValidMethod } from '../enforce-valid-method.js'

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
})

ruleTester.run('enforce-valid-method', enforceValidMethod, {
  valid: [
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const createRouteDef = createRoute({
  method: 'post',
  path: '/todos',
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ name: z.string() }) } },
    },
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(createRouteDef, async c => {
    const data = c.req.valid('json')
    return c.json({ data })
  })
`,
    },
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const getRoute = createRoute({
  method: 'get',
  path: '/todos/{id}',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(getRoute, async c => {
    const { id } = c.req.valid('param')
    return c.json({ id })
  })
`,
    },
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const listRoute = createRoute({
  method: 'get',
  path: '/todos',
  request: {
    query: z.object({ page: z.string().optional() }),
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(listRoute, async c => {
    const query = c.req.valid('query')
    return c.json({ query })
  })
`,
    },
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const updateRoute = createRoute({
  method: 'put',
  path: '/todos/{id}',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: z.object({ name: z.string() }) } },
    },
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(updateRoute, async c => {
    const { id } = c.req.valid('param')
    const data = c.req.valid('json')
    return c.json({ id, data })
  })
`,
    },
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const noSchemaRoute = createRoute({
  method: 'get',
  path: '/health',
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(noSchemaRoute, async c => {
    return c.json({ status: 'ok' })
  })
`,
    },
  ],
  invalid: [
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const createRouteDef = createRoute({
  method: 'post',
  path: '/todos',
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ name: z.string() }) } },
    },
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(createRouteDef, async c => {
    const data = await c.req.json()
    return c.json({ data })
  })
`,
      errors: [{ messageId: 'forbiddenRawMethod' }],
    },
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const getRoute = createRoute({
  method: 'get',
  path: '/todos/{id}',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(getRoute, async c => {
    const id = c.req.param('id')
    return c.json({ id })
  })
`,
      errors: [{ messageId: 'forbiddenRawMethod' }],
    },
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const listRoute = createRoute({
  method: 'get',
  path: '/todos',
  request: {
    query: z.object({ page: z.string().optional() }),
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(listRoute, async c => {
    const page = c.req.query('page')
    return c.json({ page })
  })
`,
      errors: [{ messageId: 'forbiddenRawMethod' }],
    },
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const createRouteDef = createRoute({
  method: 'post',
  path: '/todos',
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ name: z.string() }) } },
    },
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(createRouteDef, async c => {
    return c.json({ status: 'ok' })
  })
`,
      errors: [{ messageId: 'unusedSchema' }],
    },
    {
      filename: 'src/server/module-todos/routes/todos-routes.ts',
      code: `
import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'

const updateRoute = createRoute({
  method: 'put',
  path: '/todos/{id}',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: z.object({ name: z.string() }) } },
    },
  },
  responses: { 200: { description: 'OK' } },
})

export const routes = new OpenAPIHono()
  .openapi(updateRoute, async c => {
    const { id } = c.req.valid('param')
    return c.json({ id })
  })
`,
      errors: [{ messageId: 'unusedSchema' }],
    },
  ],
})

console.log('enforce-valid-method tests passed!')
