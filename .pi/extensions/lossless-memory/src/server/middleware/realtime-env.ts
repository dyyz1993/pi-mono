import type { MiddlewareHandler } from 'hono'
import { setRealtimeEnv } from '../core/index'

export function realtimeEnvMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const env = c.env as { REALTIME_DO?: DurableObjectNamespace } | undefined
    if (env) {
      setRealtimeEnv(env)
    }
    await next()
  }
}
