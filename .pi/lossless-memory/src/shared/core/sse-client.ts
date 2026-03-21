/**
 * @framework-baseline 0a1efed4372dadaa
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 *
 * @framework-modify
 * @reason 使用 fetch API 替代 EventSource，支持自定义 headers（认证）
 * @impact SSE 客户端现在支持 Authorization header
 */

interface SSEProtocol {
  events: Record<string, unknown>
}

interface SSEClient<P extends SSEProtocol = SSEProtocol> {
  readonly status: 'connecting' | 'open' | 'closed'
  on<K extends keyof P['events']>(type: K, handler: (payload: P['events'][K]) => void): () => void
  onStatusChange(handler: (status: 'connecting' | 'open' | 'closed') => void): () => void
  onError(handler: (error: Error) => void): () => void
  abort(): void
}

export class SSEClientImpl<P extends SSEProtocol = SSEProtocol> implements SSEClient<P> {
  private abortController: AbortController | null = null
  private handlers = new Map<string, ((payload: unknown) => void)[]>()
  private statusHandlers: ((status: 'connecting' | 'open' | 'closed') => void)[] = []
  private errorHandlers: ((error: Error) => void)[] = []
  private _status: 'connecting' | 'open' | 'closed' = 'connecting'
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private url: string | URL
  private headers: Record<string, string>

  constructor(url: string | URL, headers: Record<string, string> = {}) {
    this.url = url
    this.headers = headers
    this.connect()
  }

  get status() {
    return this._status
  }

  private async connect() {
    this._status = 'connecting'
    this.abortController = new AbortController()

    try {
      const response = await fetch(this.url.toString(), {
        headers: {
          Accept: 'text/event-stream',
          ...this.headers,
        },
        signal: this.abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      this._status = 'open'
      this.reconnectAttempts = 0
      this.statusHandlers.forEach(h => h('open'))

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = 'message'
      let dataBuffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete messages (separated by \n\n)
        const messages = buffer.split('\n\n')
        // Keep the last incomplete message in buffer
        buffer = messages.pop() || ''

        for (const message of messages) {
          const lines = message.split('\n')
          eventType = 'message'
          dataBuffer = ''

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              dataBuffer = line.slice(5).trim()
            }
          }

          if (dataBuffer) {
            this.handleMessage(eventType, dataBuffer)
          }
        }
      }

      this._status = 'closed'
      this.statusHandlers.forEach(h => h('closed'))
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this._status = 'closed'
        this.statusHandlers.forEach(h => h('closed'))
        return
      }

      this.errorHandlers.forEach(h => h(error as Error))
      this.attemptReconnect()
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      setTimeout(() => {
        this.connect()
      }, this.reconnectDelay * this.reconnectAttempts)
    } else {
      this._status = 'closed'
      this.statusHandlers.forEach(h => h('closed'))
    }
  }

  private handleMessage(eventType: string, data: string) {
    try {
      const parsed = JSON.parse(data)
      const handlers = this.handlers.get(eventType)
      handlers?.forEach(h => h(parsed))
    } catch {
      const handlers = this.handlers.get(eventType)
      handlers?.forEach(h => h(data))
    }
  }

  on<K extends keyof P['events']>(type: K, handler: (payload: P['events'][K]) => void): () => void {
    const eventName = type as string
    const list = this.handlers.get(eventName) || []
    list.push(handler as (payload: unknown) => void)
    this.handlers.set(eventName, list)

    return () => {
      const filtered = (this.handlers.get(eventName) || []).filter(h => h !== handler)
      this.handlers.set(eventName, filtered)
    }
  }

  onStatusChange(handler: (status: 'connecting' | 'open' | 'closed') => void): () => void {
    this.statusHandlers.push(handler)
    handler(this._status)
    return () => {
      this.statusHandlers = this.statusHandlers.filter(h => h !== handler)
    }
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.push(handler)
    return () => {
      this.errorHandlers = this.errorHandlers.filter(h => h !== handler)
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this._status = 'closed'
    this.statusHandlers.forEach(h => h('closed'))
  }
}

export function createSSEClient<P extends SSEProtocol>(
  url: string | URL,
  headers: Record<string, string> = {}
): SSEClient<P> {
  return new SSEClientImpl<P>(url, headers) as unknown as SSEClient<P>
}
