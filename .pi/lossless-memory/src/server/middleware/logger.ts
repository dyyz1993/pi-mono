import type { MiddlewareHandler } from 'hono'
import { createModuleLoggerSync } from '../utils/logger'
import type { LogFnFields } from '../utils/logger'

export type LoggerOptions = {
  logRequests?: boolean
  logResponses?: boolean
  logErrors?: boolean
  excludePaths?: string[]
}

const defaultLoggerOptions: LoggerOptions = {
  logRequests: true,
  logResponses: true,
  logErrors: true,
  excludePaths: ['/health'],
}

export function loggerMiddleware(options: LoggerOptions = {}): MiddlewareHandler {
  const mergedOptions = { ...defaultLoggerOptions, ...options }
  const log = createModuleLoggerSync('api')

  return async (c, next) => {
    const { req } = c
    const path = new URL(req.url).pathname

    if (mergedOptions.excludePaths?.some(p => path.startsWith(p))) {
      return next()
    }

    const startTime = Date.now()

    if (mergedOptions.logRequests) {
      const fields: LogFnFields = {
        method: req.method,
        path,
        userAgent: req.header('user-agent'),
      }
      log.info(fields, 'Request started')
    }

    try {
      await next()

      if (mergedOptions.logResponses) {
        const duration = Date.now() - startTime
        const fields: LogFnFields = {
          method: req.method,
          path,
          status: c.res?.status,
          duration: `${duration}ms`,
        }
        log.info(fields, 'Request completed')
      }
    } catch (error) {
      if (mergedOptions.logErrors) {
        const duration = Date.now() - startTime
        const fields: LogFnFields = {
          method: req.method,
          path,
          error: error instanceof Error ? error.message : 'Unknown error',
          duration: `${duration}ms`,
        }
        log.error(fields, 'Request failed')
      }
      throw error
    }
  }
}

export function createLoggerMiddleware(options: LoggerOptions = {}) {
  return loggerMiddleware(options)
}
