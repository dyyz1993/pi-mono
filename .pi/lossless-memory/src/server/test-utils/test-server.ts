/**
 * @framework-baseline ecef67ddd440f5b9
 * @framework-modify
 * @reason 修复 ReadableStream 类型检查，添加 null 检查以避免类型错误
 * @impact 测试工具中的流式响应处理更加健壮，避免运行时错误
 */

import { createServer, type Server } from 'http'
import { WebSocketServer } from 'ws'
import type { Hono, Env, Schema } from 'hono'
import { getNodeRuntimeAdapter } from '@server/core/runtime-node'
import type { ReadableStream } from 'stream/web'

export interface TestServer {
  server: Server
  port: number
  wsUrl: string
  close: () => Promise<void>
}

interface AddressInfo {
  address: string
  family: string
  port: number
}

export function createTestServer<E extends Env, S extends Schema, BasePath extends string>(
  app: Hono<E, S, BasePath>,
  wsPaths: string[] = []
): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    const runtimeAdapter = getNodeRuntimeAdapter()
    const wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '', `http://localhost`)

      if (runtimeAdapter.hasWSPath(url.pathname)) {
        wss.handleUpgrade(req, socket, head, ws => {
          runtimeAdapter.handleConnection(ws)
        })
      } else {
        socket.destroy()
      }
    })

    server.on('request', (req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const address = server.address() as AddressInfo | null
        const port = address?.port ?? 0
        const url = new URL(req.url || '/', `http://localhost:${port}`)
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) {
            headers.set(key, Array.isArray(value) ? value.join(', ') : value)
          }
        }
        const request = new Request(url, {
          method: req.method,
          headers,
          body: body.length > 0 ? body : undefined,
        })
        Promise.resolve(app.fetch(request))
          .then((response: Response) => {
            res.statusCode = response.status
            response.headers.forEach((value: string, key: string) => {
              res.setHeader(key, value)
            })

            const contentType = response.headers.get('content-type') || ''
            if (contentType.includes('text/event-stream')) {
              const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader()
              if (!reader) {
                res.end()
                return
              }
              const pump = (): Promise<void> =>
                reader.read().then(({ done, value }) => {
                  if (done) {
                    res.end()
                    return
                  }
                  res.write(Buffer.from(value))
                  return pump()
                })
              pump().catch((err: Error) => {
                console.error('SSE stream error:', err)
                res.end()
              })
            } else {
              response.arrayBuffer().then((buffer: ArrayBuffer) => {
                res.end(Buffer.from(buffer))
              })
            }
          })
          .catch((err: Error) => {
            res.statusCode = 500
            res.end(err.message)
          })
      })
    })

    server.listen(0, () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const port = address.port
        const wsUrl =
          wsPaths.length > 0 ? `ws://localhost:${port}${wsPaths[0]}` : `ws://localhost:${port}`

        resolve({
          server,
          port,
          wsUrl,
          close: () =>
            new Promise<void>(res => {
              wss.close(() => {
                server.close(() => res())
              })
            }),
        })
      } else {
        reject(new Error('Failed to get server address'))
      }
    })
  })
}
