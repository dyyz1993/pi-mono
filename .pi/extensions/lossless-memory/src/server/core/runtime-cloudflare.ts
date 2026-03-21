/**
 * @framework-baseline 61609a9a0a7f2a0c
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */

import { createRealtimeCore, type RealtimeCore } from './realtime-core'
import type { RuntimeAdapter, RuntimePlatform, WSConnection, SSEConnection } from './runtime'

class CloudflareWSConnection implements WSConnection {
  readonly id: string
  private ws: WebSocket

  constructor(ws: WebSocket) {
    this.id = crypto.randomUUID()
    this.ws = ws
  }

  send(data: unknown): void {
    this.ws.send(JSON.stringify(data))
  }

  close(): void {
    this.ws.close()
  }
}

export class CloudflareRuntimeAdapter implements RuntimeAdapter {
  readonly platform: RuntimePlatform = {
    name: 'cloudflare',
    isCloudflare: true,
    isNode: false,
  }

  readonly core: RealtimeCore
  private wsPaths = new Set<string>()
  private ssePaths = new Set<string>()

  constructor() {
    this.core = createRealtimeCore()
  }

  handleWS(path: string): void {
    this.wsPaths.add(path)
  }

  handleSSE(path: string): void {
    this.ssePaths.add(path)
  }

  getWSConnections(): Map<string, WSConnection> {
    return this.core.wsClients as unknown as Map<string, WSConnection>
  }

  getSSEConnections(): Map<string, SSEConnection> {
    return this.core.sseClients as unknown as Map<string, SSEConnection>
  }

  broadcast(event: string, data: unknown, exclude: string[] = []): void {
    console.warn(
      `[Broadcast] event: ${event}, data: ${JSON.stringify(data)}, exclude: ${exclude}, sseClients: ${this.core.sseClients.size}`
    )
    this.core.broadcast(data, exclude, event)
  }

  registerRPC(method: string, handler: (params: unknown, clientId: string) => unknown): void {
    this.core.registerRPCHandler(method, handler)
  }

  registerEvent(type: string, handler: (payload: unknown, clientId: string) => void): void {
    this.core.registerEventHandler(type, (payload, clientId, _broadcast) => {
      handler(payload, clientId)
    })
  }

  hasWSPath(pathname: string): boolean {
    return this.wsPaths.has(pathname)
  }

  hasSSEPath(pathname: string): boolean {
    return this.ssePaths.has(pathname)
  }

  async handleWebSocketRequest(_request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    server.accept()
    const connection = new CloudflareWSConnection(server)

    this.core.wsClients.set(connection.id, connection)

    server.addEventListener('message', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string)
        this.core.handleWSMessage(connection.id, data)
      } catch {
        // Ignore invalid JSON messages
      }
    })

    server.addEventListener('close', () => {
      this.core.wsClients.delete(connection.id)
    })

    connection.send({
      type: 'connected',
      payload: { timestamp: Date.now() },
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  async handleSSERequest(): Promise<Response> {
    const clientId = crypto.randomUUID()
    let keepAliveTimeout: ReturnType<typeof setTimeout> | null = null
    let isActive = true

    console.warn(
      `[SSE] New connection, clientId: ${clientId}, current sseClients: ${this.core.sseClients.size}`
    )

    const scheduleKeepAlive = (controller: ReadableStreamDefaultController) => {
      if (!isActive) return

      keepAliveTimeout = setTimeout(() => {
        if (!isActive) return

        try {
          controller.enqueue(new TextEncoder().encode(':ping\n\n'))
          // Schedule next ping
          scheduleKeepAlive(controller)
        } catch {
          // Connection closed, clean up
          isActive = false
          this.core.sseClients.delete(clientId)
        }
      }, 30000)
    }

    const stream = new ReadableStream({
      start: controller => {
        this.core.sseClients.set(clientId, {
          id: clientId,
          send: (msg: string) => {
            try {
              controller.enqueue(new TextEncoder().encode(msg))
            } catch {
              this.core.sseClients.delete(clientId)
            }
          },
        })

        console.warn(`[SSE] Client added, total sseClients: ${this.core.sseClients.size}`)

        // Send initial connected event
        const connectMsg = `event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
        controller.enqueue(new TextEncoder().encode(connectMsg))

        // Start keep-alive pings using recursive setTimeout
        scheduleKeepAlive(controller)
      },
      cancel: () => {
        console.warn(`[SSE] Connection cancelled, clientId: ${clientId}`)
        isActive = false
        if (keepAliveTimeout) {
          clearTimeout(keepAliveTimeout)
          keepAliveTimeout = null
        }
        this.core.sseClients.delete(clientId)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  async handleBroadcastRequest(request: Request): Promise<Response> {
    const body = (await request.json()) as { event?: string; data: unknown; exclude?: string[] }
    const event = body.event || 'notification'
    this.core.broadcast(body.data, body.exclude || [], event)
    return Response.json({
      success: true,
      wsRecipients: this.core.wsClients.size,
      sseRecipients: this.core.sseClients.size,
    })
  }
}

let _instance: CloudflareRuntimeAdapter | null = null

export function getCloudflareRuntimeAdapter(): CloudflareRuntimeAdapter {
  if (!_instance) {
    _instance = new CloudflareRuntimeAdapter()
  }
  return _instance
}
