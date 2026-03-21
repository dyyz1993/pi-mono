/**
 * @framework-baseline b18502d5cc33f07d
 *
 * @framework-modify
 * @reason 添加 headers 参数支持，以便在测试中传递认证头
 * @impact 测试客户端现在支持自定义 headers，用于认证测试
 */

import { hc } from 'hono/client'
import type { AppType } from '@server/index'
import { createApp } from '@server/app'
import type { SSEClient } from '@shared/schemas'

/**
 * 测试客户端类型
 *
 * 注意：TypeScript 5.8+ 和 Hono 4.12+ 已优化类型推导性能，
 * 无需修改 TypeScript 的类型实例化深度限制即可正常工作。
 */
export type TestClient = ReturnType<typeof hc<AppType>>

export interface TestClientOptions {
  webSocket?: (url: string | URL) => WebSocket
  sse?: (url: string | URL) => SSEClient
  headers?: Record<string, string>
}

/**
 * 创建测试客户端
 */
export function createTestClient(baseUrl?: string, options?: TestClientOptions): TestClient {
  const app = createApp()
  const defaultHeaders = {
    'User-Agent': 'TestClient/1.0 (Unit Test)',
    ...options?.headers,
  }

  if (baseUrl) {
    return hc<AppType>(baseUrl, {
      headers: defaultHeaders,
      webSocket: options?.webSocket ? url => options.webSocket!(url) : undefined,
      sse: options?.sse,
    })
  }
  return hc<AppType>('http://localhost', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: (input: any, init?: any) => {
      const request = new Request(input, init)
      // Add default headers if not present
      Object.entries(defaultHeaders).forEach(([key, value]) => {
        if (!request.headers.has(key)) {
          request.headers.set(key, value)
        }
      })
      return app.fetch(request)
    },
    sse: options?.sse,
  })
}
