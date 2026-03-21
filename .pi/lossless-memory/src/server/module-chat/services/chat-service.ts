// @framework-import 用于创建类型安全的 WebSocket runtime
import { createTypedRuntime } from '@server/core/typed-runtime'
import type { ChatProtocol } from '@shared/modules/chat'

const chatRuntime = createTypedRuntime<ChatProtocol>('/chat/ws')

// @framework-allow-modification 注册 Chat RPC 处理器
chatRuntime.registerRPC('echo', params => {
  return { message: params.message, timestamp: Date.now() }
})

// @framework-allow-modification 注册 Ping RPC 处理器
chatRuntime.registerRPC('ping', () => {
  return { pong: true, timestamp: Date.now() }
})

// @framework-allow-modification 注册广播事件处理器
chatRuntime.registerEvent('broadcast', (payload, clientId) => {
  chatRuntime.broadcast('broadcast', payload, [clientId])
})

export { chatRuntime }

export function getConnectedClientsCount(): number {
  return chatRuntime.adapter.getWSConnections().size
}

export function broadcastChatMessage(message: {
  id: string
  content: string
  sender: string
  timestamp: number
}): void {
  chatRuntime.broadcast('broadcast', {
    message: message.content,
    timestamp: message.timestamp,
  })
}
