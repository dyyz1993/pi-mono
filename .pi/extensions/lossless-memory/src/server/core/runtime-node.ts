/**
 * @framework-baseline 5493efed839d774d
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */

import type { WebSocket } from 'ws'
import { createRealtimeCore, type RealtimeCore } from './realtime-core'
import type { RuntimeAdapter, RuntimePlatform, WSConnection, SSEConnection } from './runtime'
import { generateUUID } from '../utils/uuid'

// Node.js 18+ has ReadableStream in global scope
// For older versions, we would need to import from 'stream/web'

class NodeWSConnection implements WSConnection {
  readonly id: string
  private ws: WebSocket

  constructor(ws: WebSocket) {
    this.id = generateUUID()
    this.ws = ws
  }

  send(data: unknown): void {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(data))
    }
  }

  close(): void {
    this.ws.close()
  }
}

export class NodeRuntimeAdapter implements RuntimeAdapter {
  readonly platform: RuntimePlatform = {
    name: 'node',
    isCloudflare: false,
    isNode: true,
  }

  private core: RealtimeCore
  private wsPaths = new Set<string>()
  private ssePaths = new Set<string>()
  private _connections = new Map<string, NodeWSConnection>()

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
    return this._connections as unknown as Map<string, WSConnection>
  }

  getSSEConnections(): Map<string, SSEConnection> {
    return this.core.sseClients as unknown as Map<string, SSEConnection>
  }

  broadcast(event: string, data: unknown, exclude: string[] = []): void {
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

  handleConnection(ws: WebSocket): NodeWSConnection {
    const connection = new NodeWSConnection(ws)

    ws.on('message', data => {
      try {
        const parsed = JSON.parse(data.toString())
        this.core.handleWSMessage(connection.id, parsed)
      } catch {
        // Ignore invalid messages
      }
    })

    ws.on('close', () => {
      this._connections.delete(connection.id)
      this.core.wsClients.delete(connection.id)
    })

    this._connections.set(connection.id, connection)
    this.core.wsClients.set(connection.id, connection)

    connection.send({
      type: 'connected',
      payload: { timestamp: Date.now() },
    })

    return connection
  }

  get connections(): Map<string, NodeWSConnection> {
    return this._connections
  }

  get size(): number {
    return this._connections.size
  }

  handleSSERequest(): Response {
    const clientId = generateUUID()

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

        const connectMsg = `event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
        controller.enqueue(new TextEncoder().encode(connectMsg))
      },
      cancel: () => {
        this.core.sseClients.delete(clientId)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }
}

let _instance: NodeRuntimeAdapter | null = null

export function getNodeRuntimeAdapter(): NodeRuntimeAdapter {
  if (!_instance) {
    _instance = new NodeRuntimeAdapter()
  }
  return _instance
}
