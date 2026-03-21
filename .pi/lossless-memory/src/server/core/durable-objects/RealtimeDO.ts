/**
 * @framework-baseline a6639465c6bc7806
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason 重命名为 RealtimeDurableObject，使其更通用，不再绑定特定业务
 * @impact Cloudflare Workers 环境下的 SSE/WebSocket 实时通信功能
 */

import { createRealtimeCore, type RealtimeCore } from '../realtime-core'

export class RealtimeDurableObject {
  private core: RealtimeCore

  constructor(_state: DurableObjectState) {
    this.core = createRealtimeCore()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle WebSocket upgrade (check Upgrade header)
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketRequest(request)
    }

    // Handle SSE connection (check Accept header)
    if (request.headers.get('Accept')?.includes('text/event-stream')) {
      return this.handleSSERequest()
    }

    // Handle broadcast
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcast(request)
    }

    // Handle send to specific client
    if (url.pathname === '/send' && request.method === 'POST') {
      return this.handleSend(request)
    }

    // Handle size query
    if (url.pathname === '/size') {
      return Response.json({
        wsClients: this.core.wsClients.size,
        sseClients: this.core.sseClients.size,
      })
    }

    return new Response('Not Found', { status: 404 })
  }

  private async handleWebSocketRequest(_request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    server.accept()
    const clientId = crypto.randomUUID()

    this.core.wsClients.set(clientId, {
      id: clientId,
      send: (data: unknown) => {
        try {
          server.send(JSON.stringify(data))
        } catch {
          this.core.wsClients.delete(clientId)
        }
      },
      close: () => {
        server.close()
        this.core.wsClients.delete(clientId)
      },
    })

    server.addEventListener('message', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string)
        this.core.handleWSMessage(clientId, data)
      } catch {
        // Ignore invalid JSON messages
      }
    })

    server.addEventListener('close', () => {
      this.core.wsClients.delete(clientId)
    })

    // Send connected event
    this.core.wsClients.get(clientId)?.send({
      type: 'connected',
      payload: { timestamp: Date.now() },
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  private async handleSSERequest(): Promise<Response> {
    const clientId = crypto.randomUUID()
    let keepAliveTimeout: ReturnType<typeof setTimeout> | null = null
    let isActive = true

    console.warn(
      `[SSE-DO] New connection, clientId: ${clientId}, current sseClients: ${this.core.sseClients.size}`
    )

    const scheduleKeepAlive = (controller: ReadableStreamDefaultController) => {
      if (!isActive) return

      keepAliveTimeout = setTimeout(() => {
        if (!isActive) return

        try {
          controller.enqueue(new TextEncoder().encode(':ping\n\n'))
          scheduleKeepAlive(controller)
        } catch {
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

        console.warn(`[SSE-DO] Client added, total sseClients: ${this.core.sseClients.size}`)

        // Send initial connected event
        const connectMsg = `event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
        controller.enqueue(new TextEncoder().encode(connectMsg))

        // Start keep-alive pings
        scheduleKeepAlive(controller)
      },
      cancel: () => {
        console.warn(`[SSE-DO] Connection cancelled, clientId: ${clientId}`)
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

  private async handleBroadcast(request: Request): Promise<Response> {
    console.warn('[RealtimeDO] handleBroadcast called')
    const body = (await request.clone().json()) as {
      event: string
      data: unknown
      exclude?: string[]
    }

    if (!body.event) {
      return Response.json({ success: false, error: 'event is required' }, { status: 400 })
    }

    console.warn(
      `[RealtimeDO] broadcasting event: ${body.event}, data: ${JSON.stringify(body.data)}, sseClients: ${this.core.sseClients.size}`
    )
    this.core.broadcast(body.data, body.exclude || [], body.event)
    return Response.json({
      success: true,
      wsRecipients: this.core.wsClients.size,
      sseRecipients: this.core.sseClients.size,
    })
  }

  private async handleSend(request: Request): Promise<Response> {
    const body = (await request.clone().json()) as { clientId: string; data: unknown }
    const client = this.core.wsClients.get(body.clientId) || this.core.sseClients.get(body.clientId)

    if (client) {
      try {
        client.send(body.data as string)
        return Response.json({ success: true })
      } catch {
        return Response.json({ success: false, error: 'Failed to send' })
      }
    }

    return Response.json({ success: false, error: 'Client not found' })
  }
}

export { RealtimeDurableObject as RealtimeDurableObjectClass }
