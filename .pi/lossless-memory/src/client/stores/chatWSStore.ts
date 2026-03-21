import { create } from 'zustand'
import { apiClient } from '@client/services/apiClient'
import type { WSClient, WSStatus, ChatProtocol } from '@shared/schemas'

interface WSMessage {
  type: string
  payload: unknown
  timestamp?: number
}

interface WSState {
  status: WSStatus
  messages: WSMessage[]

  connect: () => void
  disconnect: () => void
  echo: (params: { message: string }) => Promise<void>
  ping: () => Promise<void>
  broadcast: (params: { message: string; timestamp: number }) => void
  notification: (params: { title: string; body: string; timestamp: number }) => void
  clearMessages: () => void
}

let wsClient: WSClient<ChatProtocol> | null = null

export const useChatWsStore = create<WSState>((set, get) => ({
  status: 'closed',
  messages: [],

  connect: () => {
    if (wsClient) return

    wsClient = apiClient.api.chat.ws.$ws()

    if (!wsClient) return

    wsClient.onStatusChange((newStatus: WSStatus) => {
      set({ status: newStatus })
    })

    wsClient.on('notification', payload => {
      const p = payload
      set(state => ({
        messages: [...state.messages, { type: 'notification', payload: p, timestamp: p.timestamp }],
      }))
    })

    wsClient.on('broadcast', payload => {
      const p = payload
      set(state => ({
        messages: [...state.messages, { type: 'broadcast', payload: p, timestamp: p.timestamp }],
      }))
    })

    wsClient.on('connected', payload => {
      const p = payload
      set(state => ({
        messages: [...state.messages, { type: 'connected', payload: p, timestamp: p.timestamp }],
      }))
    })
  },

  disconnect: () => {
    if (wsClient) {
      wsClient.close()
      wsClient = null
      set({ status: 'closed' })
    }
  },

  echo: async params => {
    if (!wsClient || get().status !== 'open') return
    set(state => ({
      messages: [
        ...state.messages,
        { type: 'echo_request', payload: params, timestamp: Date.now() },
      ],
    }))
    try {
      const result = await wsClient.call('echo', params)
      const typedResult = result as { message: string; timestamp: number }
      set(state => ({
        messages: [
          ...state.messages,
          { type: 'echo_response', payload: result, timestamp: typedResult.timestamp },
        ],
      }))
    } catch (error) {
      console.error('Echo failed:', error)
    }
  },

  ping: async () => {
    if (!wsClient || get().status !== 'open') return
    try {
      const result = await wsClient.call('ping', {})
      const typedResult = result as { pong: boolean; timestamp: number }
      set(state => ({
        messages: [
          ...state.messages,
          { type: 'pong', payload: result, timestamp: typedResult.timestamp },
        ],
      }))
    } catch (error) {
      console.error('Ping failed:', error)
    }
  },

  broadcast: params => {
    if (!wsClient || get().status !== 'open') return
    wsClient.emit('broadcast', params)
  },

  notification: params => {
    if (!wsClient || get().status !== 'open') return
    wsClient.emit('notification', params)
  },

  clearMessages: () => {
    set({ messages: [] })
  },
}))
