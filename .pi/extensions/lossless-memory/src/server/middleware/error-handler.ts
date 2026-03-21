import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { createModuleLoggerSync } from '../utils/logger'
import type { LogFnFields } from '../utils/logger'

export type ErrorHandlerOptions = {
  includeStackTrace?: boolean
  logErrors?: boolean
}

const defaultErrorHandlerOptions: ErrorHandlerOptions = {
  includeStackTrace: false,
  logErrors: true,
}

type ZodIssueFormatted = {
  field: string
  message: string
  code?: string
}

function formatZodError(error: ZodError): ZodIssueFormatted[] {
  return error.issues.map(issue => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

function createErrorResponse(status: number, message: string, details?: unknown) {
  const response: { success: false; error: string; status: number; details?: unknown } = {
    success: false,
    error: message,
    status,
  }
  if (details) {
    response.details = details
  }
  return response
}

export function errorHandlerMiddleware(options: ErrorHandlerOptions = {}): MiddlewareHandler {
  const mergedOptions = { ...defaultErrorHandlerOptions, ...options }
  const log = createModuleLoggerSync('api')

  return async (c, next) => {
    try {
      await next()
    } catch (error) {
      // Always return JSON response
      c.res.headers.set('Content-Type', 'application/json')

      if (error instanceof ZodError) {
        const formattedErrors = formatZodError(error)

        if (mergedOptions.logErrors) {
          const fields: LogFnFields = {
            errorType: 'ZodError',
            errors: formattedErrors,
            path: c.req.path,
            method: c.req.method,
          }
          log.warn(fields, 'Validation error')
        }

        return c.json(createErrorResponse(400, 'Validation failed', formattedErrors), 400)
      }

      if (error instanceof HTTPException) {
        if (mergedOptions.logErrors) {
          const fields: LogFnFields = {
            errorType: 'HTTPException',
            error: error.message,
            status: error.status,
            path: c.req.path,
            method: c.req.method,
            cause: error.cause,
          }
          log.warn(fields, 'HTTP exception')
        }

        // Ensure we always return JSON even if HTTPException has a text response
        const status = error.status || 500
        const message = error.message || 'Internal server error'
        return c.json(createErrorResponse(status, message), status)
      }

      if (mergedOptions.logErrors) {
        const fields: LogFnFields = {
          errorType: 'UnknownError',
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          path: c.req.path,
          method: c.req.method,
        }
        log.error(fields, 'Unhandled error')
      }

      const message = error instanceof Error ? error.message : 'Internal server error'
      const response: { success: false; error: string; status: number; stack?: string } = {
        success: false,
        error: message,
        status: 500,
      }

      if (mergedOptions.includeStackTrace && error instanceof Error && error.stack) {
        response.stack = error.stack
      }

      return c.json(response, 500)
    }
  }
}

export function createErrorHandlerMiddleware(options: ErrorHandlerOptions = {}) {
  return errorHandlerMiddleware(options)
}
