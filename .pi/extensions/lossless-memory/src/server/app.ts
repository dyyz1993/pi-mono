import { OpenAPIHono } from '@hono/zod-openapi'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import type { AppBindings, CreateAppOptions } from './types/bindings'
import { autoRegisterRealtime } from './core/realtime-scanner'
import { corsMiddleware, loggerMiddleware, errorHandlerMiddleware } from './middleware'
import { realtimeEnvMiddleware } from './middleware/realtime-env'
import { captchaMiddleware } from './middleware/captcha'
import { auditLogMiddleware } from './middleware/audit-log'
import { createModuleLoggerSync } from './utils/logger'
import { AppError, toAppError } from './utils/app-error'
import { adminApiRoutes, clientApiRoutes } from './route-registry'
import { fileRoutes } from './module-file/routes/file-routes'

export { type AppBindings, type CreateAppOptions } from './types/bindings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function globalErrorHandler(err: Error, c: any) {
  const log = createModuleLoggerSync('api')

  c.res.headers.set('Content-Type', 'application/json')

  if (AppError.isAppError(err)) {
    const logData = {
      errorType: err.name,
      code: err.code,
      message: err.message,
      status: err.statusCode,
      details: err.details,
      path: c.req.path,
      method: c.req.method,
    }

    switch (err.logLevel) {
      case 'debug':
        log.debug(logData, err.message)
        break
      case 'info':
        log.info(logData, err.message)
        break
      case 'warn':
        log.warn(logData, err.message)
        break
      case 'error':
        log.error({ ...logData, stack: err.stack, cause: err.cause }, err.message)
        break
    }

    const isProduction = process.env.NODE_ENV === 'production'
    const shouldHideDetails = isProduction && err.statusCode >= 500

    return c.json(
      {
        success: false,
        error: shouldHideDetails ? 'Internal server error' : err.message,
        code: err.code,
        status: err.statusCode,
        details: shouldHideDetails ? undefined : err.details,
        timestamp: err.timestamp,
      },
      err.statusCode
    )
  }

  if (err instanceof ZodError) {
    const formattedErrors = err.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }))

    log.warn(
      {
        errorType: 'ZodError',
        errors: formattedErrors,
        path: c.req.path,
        method: c.req.method,
      },
      'Validation error'
    )

    return c.json(
      {
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        status: 400,
        details: formattedErrors,
      },
      400
    )
  }

  if (err instanceof HTTPException) {
    log.warn(
      {
        errorType: 'HTTPException',
        error: err.message,
        status: err.status,
        path: c.req.path,
        method: c.req.method,
      },
      'HTTP exception'
    )

    const statusCode = err.status || 500
    return c.json(
      {
        success: false,
        error: err.message,
        code: 'HTTP_EXCEPTION',
        status: statusCode,
      },
      statusCode
    )
  }

  const appError = toAppError(err)
  log.error(
    {
      errorType: 'UnknownError',
      error: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
    },
    'Unhandled error'
  )

  const isProduction = process.env.NODE_ENV === 'production'
  return c.json(
    {
      success: false,
      error: isProduction ? 'Internal server error' : appError.message,
      code: appError.code,
      status: 500,
      timestamp: appError.timestamp,
    },
    500
  )
}

export function createApp<T extends AppBindings = AppBindings>(_options: CreateAppOptions = {}) {
  const app = new OpenAPIHono<{ Bindings: T }>()
    .use('*', errorHandlerMiddleware())
    .use('*', loggerMiddleware())
    .use('*', corsMiddleware())
    .use('*', realtimeEnvMiddleware())
    .use('/api/*', auditLogMiddleware())
    .use(
      '/api/admin/*',
      captchaMiddleware({
        maxRequests: 20,
        windowMs: 60000,
      })
    )
    .route('/', clientApiRoutes)
    .route('/', adminApiRoutes)
    .route('/files', fileRoutes)
    .get('/health', async c => {
      try {
        const { getDb } = await import('./db')
        await getDb()
        return c.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'connected' })
      } catch {
        return c.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'not configured' })
      }
    })
    .post('/api/__test__/cleanup', async c => {
      try {
        const { cleanupTestDatabase } = await import('./db/test-setup')
        await cleanupTestDatabase()
        return c.json({ success: true, message: 'Database cleaned up' })
      } catch (error) {
        console.error('Error during database cleanup:', error)
        return c.json({ success: false, message: 'Failed to cleanup database' }, 500)
      }
    })
    .onError(globalErrorHandler)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  autoRegisterRealtime(app as any)

  return app
}
export type AdminApiType = typeof adminApiRoutes
export type ClientApiType = typeof clientApiRoutes
export type AppType = ReturnType<typeof createApp>
