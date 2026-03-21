/**
 * @framework-baseline 4437e01c1b0bcabb
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */

type WSStatus = 'connecting' | 'open' | 'closed' | 'reconnecting'

interface WSProtocol {
  rpc: Record<string, { in: unknown; out: unknown }>
  events: Record<string, unknown>
}

interface WSClient<T extends WSProtocol = WSProtocol> {
  readonly status: WSStatus
  getSocket(): WebSocket | null
  call<K extends keyof T['rpc']>(
    method: K,
    params: T['rpc'][K] extends { in: infer I } ? I : never,
    timeout?: number
  ): Promise<T['rpc'][K] extends { out: infer O } ? O : never>
  emit<K extends keyof T['events']>(type: K, payload: T['events'][K]): void
  on<K extends keyof T['events']>(type: K, handler: (payload: T['events'][K]) => void): () => void
  onStatusChange(handler: (status: WSStatus) => void): () => void
  close(): void
}

type PendingRequest = {
  resolve: (val: unknown) => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

interface WSMessageBase {
  id?: string
  method?: string
  type?: string
  payload?: unknown
  result?: unknown
  error?: string
}

export class WSClientImpl<P extends WSProtocol = WSProtocol> extends WebSocket {
  private handlers = new Map<string, ((payload: unknown) => void)[]>()
  private pendingRequests = new Map<string, PendingRequest>()
  private statusHandlers: ((status: WSStatus) => void)[] = []
  private messageBuffer: string[] = []
  private _status: WSStatus = 'closed'

  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    this.attachSocket()
  }

  private attachSocket() {
    if (this.readyState === WebSocket.OPEN) {
      this._status = 'open'
    } else if (this.readyState === WebSocket.CONNECTING) {
      this._status = 'connecting'
    } else {
      this._status = 'closed'
    }
    this.onmessage = msg => this.handleMessage(msg)
    this.onclose = () => {
      if (this._status !== 'closed') {
        this.handleClose()
      }
    }
    this.onerror = () => {
      if (this._status !== 'closed') {
        this.updateStatus('closed')
      }
    }
    this.onopen = () => {
      if (this._status !== 'open') {
        this.handleOpen()
      }
    }
  }

  private handleOpen() {
    this.updateStatus('open')
    while (this.messageBuffer.length > 0) {
      const msg = this.messageBuffer.shift()
      if (msg) this.send(msg)
    }
  }

  private handleClose() {
    this.updateStatus('closed')
  }

  private handleMessage(event: MessageEvent) {
    try {
      const data: WSMessageBase = JSON.parse(event.data)

      if ('id' in data && !('method' in data)) {
        const pending = this.pendingRequests.get(data.id!)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(data.id!)
          if (data.error) pending.reject(new Error(data.error))
          else pending.resolve(data.result)
        }
      } else if ('type' in data) {
        const callbacks = this.handlers.get(data.type!)
        callbacks?.forEach(cb => cb(data.payload))
      }
    } catch (e) {
      console.error('Failed to parse WS message', e)
    }
  }

  private updateStatus(status: WSStatus) {
    this._status = status
    this.statusHandlers.forEach(h => h(status))
  }

  async call<K extends keyof P['rpc']>(
    method: K,
    params: P['rpc'][K] extends { in: infer I } ? I : never,
    timeout = 10000
  ): Promise<P['rpc'][K] extends { out: infer O } ? O : never> {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2)
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC Timeout: ${String(method)}`))
      }, timeout)

      this.pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      })

      this.sendRaw({ id, method, params })
    })
  }

  emit<K extends keyof P['events']>(type: K, payload: P['events'][K]) {
    this.sendRaw({ type, payload })
  }

  on<K extends keyof P['events']>(type: K, handler: (payload: P['events'][K]) => void) {
    const list = this.handlers.get(type as string) || []
    list.push(handler as (payload: unknown) => void)
    this.handlers.set(type as string, list)
    return () => {
      const filtered = (this.handlers.get(type as string) || []).filter(h => h !== handler)
      this.handlers.set(type as string, filtered)
    }
  }

  onStatusChange(handler: (status: WSStatus) => void) {
    this.statusHandlers.push(handler)
    return () => {
      this.statusHandlers = this.statusHandlers.filter(h => h !== handler)
    }
  }

  close() {
    super.close()
  }

  private sendRaw(data: unknown) {
    const msg = JSON.stringify(data)
    if (this.readyState === WebSocket.OPEN) {
      this.send(msg)
    } else {
      this.messageBuffer.push(msg)
    }
  }
}

export function createWSClient<P extends WSProtocol>(url: string | URL): WSClient<P> {
  return new WSClientImpl<P>(url) as unknown as WSClient<P>
}
