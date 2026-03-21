/**
 * @framework-baseline af295398dc31b57a
 */

export interface RuntimePlatform {
  name: 'node' | 'cloudflare'
  isCloudflare: boolean
  isNode: boolean
}

export interface WSConnection {
  id: string
  send(data: unknown): void
  close(): void
}

export interface SSEConnection {
  id: string
  send: (data: string) => void
}

export interface RuntimeAdapter {
  platform: RuntimePlatform

  handleWS(path: string): void
  hasWSPath(pathname: string): boolean
  getWSConnections(): Map<string, WSConnection>
  broadcast(event: string, data: unknown, exclude?: string[]): void

  handleSSE(path: string): void
  hasSSEPath(pathname: string): boolean
  getSSEConnections(): Map<string, SSEConnection>

  registerRPC(method: string, handler: (params: unknown, clientId: string) => unknown): void
  registerEvent(type: string, handler: (payload: unknown, clientId: string) => void): void

  onUpgrade?(req: Request, socket: unknown, head: unknown): boolean
}

declare global {
  var __runtimeAdapter: RuntimeAdapter | undefined
}

let _adapter: RuntimeAdapter | null = null

type PendingRegistration =
  | { type: 'rpc'; method: string; handler: (params: unknown, clientId: string) => unknown }
  | { type: 'event'; eventType: string; handler: (payload: unknown, clientId: string) => void }

const _pendingRegistrations: PendingRegistration[] = []

export function setRuntimeAdapter(adapter: RuntimeAdapter): void {
  if (globalThis.__runtimeAdapter) {
    _adapter = globalThis.__runtimeAdapter
    return
  }

  if (_adapter) {
    return
  }

  _adapter = adapter
  globalThis.__runtimeAdapter = adapter

  for (const pending of _pendingRegistrations) {
    if (pending.type === 'rpc') {
      adapter.registerRPC(pending.method, pending.handler)
    } else {
      adapter.registerEvent(pending.eventType, pending.handler)
    }
  }
  _pendingRegistrations.length = 0
}

export function getRuntimeAdapter(): RuntimeAdapter {
  if (globalThis.__runtimeAdapter) {
    _adapter = globalThis.__runtimeAdapter
  }

  if (!_adapter) {
    throw new Error('Runtime adapter not initialized. Call setRuntimeAdapter() first.')
  }
  return _adapter
}

export const runtime = {
  get adapter(): RuntimeAdapter {
    return getRuntimeAdapter()
  },

  handleWS(path: string): void {
    this.adapter.handleWS(path)
  },

  handleSSE(path: string): void {
    this.adapter.handleSSE(path)
  },

  broadcast(event: string, data: unknown, exclude?: string[]): void {
    this.adapter.broadcast(event, data, exclude || [])
  },

  registerRPC(method: string, handler: (params: unknown, clientId: string) => unknown): void {
    if (_adapter) {
      _adapter.registerRPC(method, handler)
    } else {
      _pendingRegistrations.push({ type: 'rpc', method, handler })
    }
  },

  registerEvent(type: string, handler: (payload: unknown, clientId: string) => void): void {
    if (_adapter) {
      _adapter.registerEvent(type, handler)
    } else {
      _pendingRegistrations.push({ type: 'event', eventType: type, handler })
    }
  },

  get platform(): RuntimePlatform {
    return this.adapter.platform
  },
}
