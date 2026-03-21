/**
 * @framework-baseline 146e0af8fec88923
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */

import type { WSConnection, SSEConnection } from './runtime'

export type RPCHandler = (params: unknown, clientId: string) => unknown

export type EventHandler = (
  payload: unknown,
  clientId: string,
  broadcast: (data: unknown, exclude: string[], event: string) => void
) => void

export type RealtimeBroadcastFn = (data: unknown, exclude: string[], event: string) => void

export interface RealtimeCore {
  wsClients: Map<string, WSConnection>
  sseClients: Map<string, SSEConnection>
  broadcast: RealtimeBroadcastFn
  handleWSMessage: (clientId: string, data: unknown) => void
  registerRPCHandler: (method: string, handler: RPCHandler) => void
  registerEventHandler: (type: string, handler: EventHandler) => void
}

export function createRealtimeCore(): RealtimeCore {
  const wsClients = new Map<string, WSConnection>()
  const sseClients = new Map<string, SSEConnection>()
  const rpcHandlers = new Map<string, RPCHandler>()
  const eventHandlers = new Map<string, EventHandler>()

  const broadcast: RealtimeBroadcastFn = (
    data: unknown,
    exclude: string[] = [],
    event: string = 'notification'
  ) => {
    const message = JSON.stringify(data)
    const sseMessage = `event: ${event}\ndata: ${message}\n\n`

    for (const [id, client] of wsClients) {
      if (!exclude.includes(id)) {
        try {
          client.send({ type: event, payload: data })
        } catch {
          wsClients.delete(id)
        }
      }
    }

    for (const [id, client] of sseClients) {
      if (!exclude.includes(id)) {
        try {
          client.send(sseMessage)
        } catch {
          sseClients.delete(id)
        }
      }
    }
  }

  const handleWSMessage = (clientId: string, data: unknown): void => {
    const client = wsClients.get(clientId)
    if (!client) return

    if (typeof data === 'object' && data !== null && 'method' in data && 'id' in data) {
      const rpc = data as { id: string; method: string; params: unknown }
      const handler = rpcHandlers.get(rpc.method)

      if (handler) {
        try {
          const result = handler(rpc.params, clientId)
          client.send({ id: rpc.id, result })
        } catch (error) {
          client.send({
            id: rpc.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      } else {
        client.send({ id: rpc.id, error: `Unknown method: ${rpc.method}` })
      }
      return
    }

    if (typeof data === 'object' && data !== null && 'type' in data) {
      const msg = data as { type: string; payload?: unknown }
      const handler = eventHandlers.get(msg.type)

      if (handler) {
        handler(msg.payload, clientId, broadcast)
      }
    }
  }

  const registerRPCHandler = (method: string, handler: RPCHandler): void => {
    rpcHandlers.set(method, handler)
  }

  const registerEventHandler = (type: string, handler: EventHandler): void => {
    eventHandlers.set(type, handler)
  }

  return {
    wsClients,
    sseClients,
    broadcast,
    handleWSMessage,
    registerRPCHandler,
    registerEventHandler,
  }
}

export function createWSMessageHandler(
  broadcastFn: (data: unknown, exclude: string[], event: string) => void
) {
  return {
    handleMessage(clientId: string, data: unknown, send: (response: unknown) => void): void {
      if (typeof data === 'object' && data !== null && 'method' in data && 'id' in data) {
        const rpc = data as { id: string; method: string; params: unknown }
        const response = this.handleRpc(rpc)
        send(response)
        return
      }

      if (typeof data === 'object' && data !== null && 'type' in data) {
        const msg = data as { type: string; payload?: unknown }
        this.handleEvent(clientId, msg)
      }
    },

    handleRpc(rpc: { id: string; method: string; params: unknown }): unknown {
      return {
        id: rpc.id,
        error: `Unknown method: ${rpc.method}`,
      }
    },

    handleEvent(clientId: string, msg: { type: string; payload?: unknown }): void {
      switch (msg.type) {
        case 'broadcast':
          broadcastFn(msg.payload, [clientId], 'broadcast')
          break
      }
    },
  }
}
