/**
 * WebSocket Page
 * Demonstrates WebSocket with type inference using useChatWSStore
 */

import { useState } from 'react'
import {
  Plug,
  Wifi,
  WifiOff,
  Send,
  Trash2,
  MessageSquare,
  Radio,
  Bell,
  Activity,
} from 'lucide-react'
import { useChatWsStore } from '@client/stores/chatWSStore'
import { LoadingSpinner, EmptyState, MessageCard } from '@client/components'
import type { WSStatus } from '@shared/schemas'

export const WebSocketPage: React.FC = () => {
  const {
    status,
    messages,
    connect,
    disconnect,
    echo,
    ping,
    broadcast,
    notification,
    clearMessages,
  } = useChatWsStore()
  const [inputMessage, setInputMessage] = useState('')
  const [messageType, setMessageType] = useState<'echo' | 'notification' | 'broadcast' | 'ping'>(
    'echo'
  )

  const handleSend = async () => {
    if (!inputMessage.trim() && messageType !== 'ping') return

    switch (messageType) {
      case 'echo':
        await echo({ message: inputMessage })
        break
      case 'ping':
        await ping()
        break
      case 'broadcast':
        broadcast({ message: inputMessage, timestamp: Date.now() })
        break
      case 'notification':
        notification({ title: 'User Notification', body: inputMessage, timestamp: Date.now() })
        break
    }
    setInputMessage('')
  }

  const typeConfig: Record<
    string,
    {
      colorScheme: 'cyan' | 'purple' | 'orange' | 'green' | 'blue'
      icon: React.FC<{ className?: string }>
      borderColor: string
    }
  > = {
    ping: { colorScheme: 'cyan', icon: Activity, borderColor: '#06b6d4' },
    pong: { colorScheme: 'cyan', icon: Activity, borderColor: '#06b6d4' },
    echo_request: { colorScheme: 'purple', icon: Send, borderColor: '#a78bfa' },
    echo_response: { colorScheme: 'purple', icon: MessageSquare, borderColor: '#9333ea' },
    broadcast: { colorScheme: 'orange', icon: Radio, borderColor: '#f97316' },
    notification: { colorScheme: 'green', icon: Bell, borderColor: '#22c55e' },
    connected: { colorScheme: 'blue', icon: Wifi, borderColor: '#3b82f6' },
  }

  const statusColors: Record<WSStatus, string> = {
    connecting: 'text-yellow-500',
    open: 'text-green-600',
    closed: 'text-red-500',
    reconnecting: 'text-orange-500',
  }

  const currentStatus = status as WSStatus
  const isLoading = currentStatus === 'connecting' || currentStatus === 'reconnecting'

  return (
    <div className="max-w-3xl mx-auto p-6" data-testid="websocket-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Plug className="w-8 h-8 text-indigo-500" />
          WebSocket Demo
        </h1>
        <p className="text-gray-500 mt-2">
          Demonstrates WebSocket with type inference using useWSStore
        </p>
      </div>

      <div className="mb-6 p-4 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700">Status:</span>
          <span
            className={`flex items-center gap-1 ${statusColors[currentStatus]}`}
            data-testid={`ws-status-${status}`}
          >
            {isLoading ? (
              <LoadingSpinner size="sm" color={statusColors[currentStatus]} />
            ) : status === 'open' ? (
              <Wifi className="w-4 h-4" />
            ) : (
              <WifiOff className="w-4 h-4" />
            )}
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={connect}
            disabled={status === 'open' || isLoading}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              status === 'open' || isLoading
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
            data-testid="connect-ws-button"
          >
            <Wifi className="w-4 h-4" />
            Connect
          </button>
          <button
            onClick={disconnect}
            disabled={status === 'closed'}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              status === 'closed'
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}
            data-testid="disconnect-ws-button"
          >
            <WifiOff className="w-4 h-4" />
            Disconnect
          </button>
        </div>
      </div>

      <div className="mb-6 p-6 bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="flex gap-4">
          <select
            value={messageType}
            onChange={e => setMessageType(e.target.value as typeof messageType)}
            className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            data-testid="ws-message-type-select"
          >
            <option value="echo">Echo (RPC)</option>
            <option value="ping">Ping (RPC)</option>
            <option value="broadcast">Broadcast (Event)</option>
            <option value="notification">Notification (Event)</option>
          </select>
          <input
            type="text"
            value={inputMessage}
            onChange={e => setInputMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={
              messageType === 'ping' ? 'No message needed for ping' : 'Type a message...'
            }
            disabled={status !== 'open' || messageType === 'ping'}
            className="flex-1 px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
            data-testid="ws-message-input"
          />
          <button
            onClick={handleSend}
            disabled={status !== 'open' || (messageType !== 'ping' && !inputMessage.trim())}
            className={`flex items-center gap-2 px-6 py-3 text-base font-medium rounded-lg transition-colors ${
              status !== 'open' || (messageType !== 'ping' && !inputMessage.trim())
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-indigo-500 text-white hover:bg-indigo-600'
            }`}
            data-testid="send-message-button"
          >
            <Send className="w-5 h-5" />
            Send
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900" data-testid="message-count">
          Messages ({messages.length})
        </h3>
        <button
          onClick={clearMessages}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          data-testid="clear-messages-button"
        >
          <Trash2 className="w-4 h-4" />
          Clear
        </button>
      </div>

      <div className="border border-gray-200 rounded-xl bg-gray-50 h-[400px] overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No messages yet. Connect and send a message!" />
        ) : (
          messages.map(
            (msg: { type: string; payload: unknown; timestamp?: number }, index: number) => {
              const config = typeConfig[msg.type] || {
                colorScheme: 'gray' as const,
                icon: MessageSquare,
                borderColor: '#6b7280',
              }
              return (
                <MessageCard
                  key={index}
                  type={msg.type}
                  payload={msg.payload}
                  timestamp={msg.timestamp}
                  icon={config.icon}
                  colorScheme={config.colorScheme}
                  borderColor={config.borderColor}
                  data-testid="message-item"
                />
              )
            }
          )
        )}
      </div>
    </div>
  )
}
