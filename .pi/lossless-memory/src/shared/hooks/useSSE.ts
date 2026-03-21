import { useCallback, useEffect, useRef, useState } from 'react'
import type { SSEClient, SSEProtocol } from '@shared/schemas'

type SSEStatus = 'connecting' | 'open' | 'closed'

interface UseSSEReturn<T extends SSEProtocol> {
  status: SSEStatus
  connect: () => Promise<void>
  disconnect: () => void
  client: SSEClient<T> | null
}

export function useSSE<T extends SSEProtocol>(route: () => Promise<SSEClient<T>>): UseSSEReturn<T> {
  const [status, setStatus] = useState<SSEStatus>('closed')
  const clientRef = useRef<SSEClient<T> | null>(null)

  const connect = useCallback(async () => {
    if (clientRef.current) return

    setStatus('connecting')

    try {
      const client = await route()
      clientRef.current = client

      client.onStatusChange((newStatus: 'connecting' | 'open' | 'closed') => {
        setStatus(newStatus)
      })

      setStatus(client.status)
    } catch (error) {
      console.error('Failed to connect SSE:', error)
      setStatus('closed')
    }
  }, [route])

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.abort()
      clientRef.current = null
      setStatus('closed')
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    status,
    connect,
    disconnect,
    client: clientRef.current,
  }
}
