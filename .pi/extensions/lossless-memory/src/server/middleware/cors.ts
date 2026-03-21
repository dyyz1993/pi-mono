import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

export type CorsOptions = {
  origin?: string | string[]
  credentials?: boolean
  allowMethods?: string[]
  allowHeaders?: string[]
  exposeHeaders?: string[]
  maxAge?: number
}

const defaultCorsOptions: Required<Omit<CorsOptions, 'exposeHeaders' | 'maxAge'>> & CorsOptions = {
  origin: ['*'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}

export function corsMiddleware(options: CorsOptions = {}): MiddlewareHandler {
  const mergedOptions = { ...defaultCorsOptions, ...options }

  return cors(mergedOptions as never)
}

export function createCorsMiddleware(options: CorsOptions = {}) {
  return corsMiddleware(options)
}
