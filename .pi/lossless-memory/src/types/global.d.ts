declare global {
  export type WSStatus = 'connecting' | 'open' | 'closed' | 'reconnecting'

  export interface WSProtocol {
    rpc: Record<string, { in: unknown; out: unknown }>
    events: Record<string, unknown>
  }

  export interface SSEProtocol {
    events: Record<string, unknown>
  }

  export interface WSClient<T extends WSProtocol = WSProtocol> {
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

  export interface SSEClient<T extends SSEProtocol = SSEProtocol> {
    readonly status: 'connecting' | 'open' | 'closed'

    on<K extends keyof T['events']>(type: K, handler: (payload: T['events'][K]) => void): () => void

    onStatusChange(handler: (status: 'connecting' | 'open' | 'closed') => void): () => void
    onError(handler: (error: Error) => void): () => void

    abort(): void
  }
}

export {}
