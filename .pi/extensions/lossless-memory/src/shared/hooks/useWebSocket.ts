import { useCallback, useEffect, useRef, useState } from 'react'
import type { WSClient, WSProtocol, WSStatus } from '@shared/schemas'

interface UseWebSocketReturn<T extends WSProtocol> {
  status: WSStatus
  connect: () => void
  disconnect: () => void
  call: WSClient<T>['call']
  emit: WSClient<T>['emit']
  on: WSClient<T>['on']
  client: WSClient<T> | null
}

export function useWebSocket<T extends WSProtocol>(route: {
  $ws: () => WSClient<T>
}): UseWebSocketReturn<T> {
  const [status, setStatus] = useState<WSStatus>('closed')
  const clientRef = useRef<WSClient<T> | null>(null)

  const connect = useCallback(() => {
    if (clientRef.current) return

    const client = route.$ws()
    clientRef.current = client

    client.onStatusChange(setStatus)
  }, [route])

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.close()
      clientRef.current = null
      setStatus('closed')
    }
  }, [])

  const call = useCallback(async (method: keyof T['rpc'], params: unknown) => {
    if (!clientRef.current) throw new Error('WebSocket not connected')
    return clientRef.current.call(method as never, params as never)
  }, []) as WSClient<T>['call']

  const emit = useCallback((type: keyof T['events'], payload: unknown) => {
    clientRef.current?.emit(type as never, payload as never)
  }, []) as WSClient<T>['emit']

  const on = useCallback((type: keyof T['events'], handler: (payload: unknown) => void) => {
    if (!clientRef.current) return () => {}
    return clientRef.current.on(type as never, handler as never)
  }, []) as WSClient<T>['on']

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    status,
    connect,
    disconnect,
    call,
    emit,
    on,
    client: clientRef.current,
  }
}
