/**
 * @framework-baseline 159d5e23f19e9793
 * @framework-modify
 * @reason 添加 SPA 前端路由处理，区分开发/生产环境
 * @impact 新增前端路由处理逻辑，/admin/* 返回 admin.html，其他路由返回 index.html
 */

import '../config'

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { WebSocketServer } from 'ws'
import { getAppConfig } from '../config'
import { logger } from '../utils/logger'
import { createApp } from '../app'
import { getDb, runMigrations } from '../db'
import { setRuntimeAdapter } from '@server/core/runtime'
import { getNodeRuntimeAdapter } from '@server/core/runtime-node'

const config = getAppConfig()
const isProduction = process.env.NODE_ENV === 'production'
const distPath = resolve(process.cwd(), 'dist/client')
const hasDist = isProduction && existsSync(distPath)

// HTML 文件路径
const indexHtmlPath = hasDist
  ? resolve(distPath, 'index.html')
  : resolve(process.cwd(), 'index.html')
const adminHtmlPath = hasDist
  ? resolve(distPath, 'admin.html')
  : resolve(process.cwd(), 'admin.html')

const indexHtml = existsSync(indexHtmlPath)
  ? readFileSync(indexHtmlPath, 'utf-8')
  : '<html><body>index.html not found</body></html>'
const adminHtml = existsSync(adminHtmlPath)
  ? readFileSync(adminHtmlPath, 'utf-8')
  : '<html><body>admin.html not found</body></html>'

const log = logger.api()

const runtimeAdapter = getNodeRuntimeAdapter()
setRuntimeAdapter(runtimeAdapter)

// 先创建基础应用
const baseApp = createApp()

// 添加日志中间件
const app = baseApp.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  log.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms }, 'request')
})

if (config.enableDocs) {
  app.get('/docs', c =>
    c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>API Documentation</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
        <script>
          window.onload = function() {
            SwaggerUIBundle({
              url: "/api/docs",
              dom_id: '#swagger-ui',
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIBundle.SwaggerUIStandalonePreset
              ],
              layout: "BaseLayout"
            });
          }
        </script>
      </body>
    </html>
  `)
  )
}

// 生产环境：静态资源服务
if (hasDist) {
  app.use('/*', async (c, next) => {
    // API 路由不走静态资源
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/files/')) {
      return await next()
    }
    return serveStatic({ root: distPath })(c, next)
  })
}

// Admin 路由返回 admin.html
app.get('/admin/*', c => {
  return c.html(adminHtml)
})

// 其他非 API 路由返回 index.html
app.get('*', c => {
  // 如果路径以 /api/ 或 /files/ 开头，让 Hono 继续处理（可能会返回 404）
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/files/')) {
    return c.notFound()
  }
  return c.html(indexHtml)
})

app.onError((err, c) => {
  log.error({ err, path: c.req.path }, 'server error')
  // Always return JSON response
  c.res.headers.set('Content-Type', 'application/json')
  const statusCode =
    err instanceof Error && 'status' in err ? (err as { status: number }).status : 500
  const message = err.message || 'Internal server error'
  const responseStatus = statusCode || 500
  return c.json({ success: false, error: message, status: responseStatus }, responseStatus as 500)
})

export default app
export type AppType = typeof app

export async function createServer() {
  const server = serve({
    fetch: app.fetch,
    port: config.port,
  })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://localhost`)

    if (runtimeAdapter.hasWSPath(url.pathname)) {
      const wssInstance = new WebSocketServer({ noServer: true })

      wssInstance.handleUpgrade(req, socket, head, ws => {
        runtimeAdapter.handleConnection(ws)
      })
    } else {
      socket.destroy()
    }
  })

  return { server, port: config.port }
}

export async function startServer() {
  const bootstrapLog = logger.bootstrap()

  bootstrapLog.info({}, 'Initializing database...')
  try {
    await getDb()
    await runMigrations()
    const { initializeDatabase } = await import('../db/init')
    await initializeDatabase()
    bootstrapLog.info({}, 'Database ready')
  } catch (err) {
    bootstrapLog.error({ err }, 'Database initialization failed')
    process.exit(1)
  }

  const { server, port } = await createServer()

  bootstrapLog.info({ port }, 'Server running')
  if (config.enableDocs) {
    bootstrapLog.info({ url: `http://localhost:${port}/docs` }, 'API docs available')
  }

  const shutdown = async () => {
    bootstrapLog.info({}, 'Shutting down...')
    server.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.env.NODE_ENV === 'production') {
  startServer().catch(err => {
    console.error('Failed to start server:', err)
    process.exit(1)
  })
}
