/**
 * Notification Page
 * Demonstrates SSE (Server-Sent Events) with Hono RPC
 */

import { useState, useEffect } from 'react'
import {
  Bell,
  Wifi,
  WifiOff,
  CheckCheck,
  Trash2,
  Send,
  Info,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { useNotificationStore } from '../stores/notificationStore'
import { LoadingSpinner, EmptyState, StatusBadge } from '@client/components'
import type { NotificationType } from '@shared/schemas'

export const NotificationPage: React.FC = () => {
  const notifications = useNotificationStore(state => state.notifications)
  const unreadCount = useNotificationStore(state => state.unreadCount)
  const sseConnected = useNotificationStore(state => state.sseConnected)
  const loading = useNotificationStore(state => state.loading)
  const error = useNotificationStore(state => state.error)
  const {
    fetchNotifications,
    createNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    connectSSE,
    disconnectSSE,
  } = useNotificationStore()

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [type, setType] = useState<NotificationType>('info')

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !message.trim()) return

    await createNotification({ type, title, message })
    setTitle('')
    setMessage('')
  }

  const typeConfig = {
    info: {
      icon: Info,
      colorScheme: 'blue' as const,
      border: 'border-blue-400',
      lightBg: 'bg-blue-50',
    },
    warning: {
      icon: AlertTriangle,
      colorScheme: 'yellow' as const,
      border: 'border-yellow-400',
      lightBg: 'bg-yellow-50',
    },
    success: {
      icon: CheckCircle,
      colorScheme: 'green' as const,
      border: 'border-green-400',
      lightBg: 'bg-green-50',
    },
    error: {
      icon: XCircle,
      colorScheme: 'red' as const,
      border: 'border-red-400',
      lightBg: 'bg-red-50',
    },
  }

  return (
    <div className="max-w-3xl mx-auto p-6" data-testid="notification-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Bell className="w-8 h-8 text-purple-500" />
          Notifications
        </h1>
        <p className="text-gray-500 mt-2">
          Demonstrates SSE (Server-Sent Events) with Hono RPC type inference
        </p>
      </div>

      <div className="mb-6 p-4 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700">SSE Status:</span>
            {sseConnected ? (
              <span
                className="flex items-center gap-1 text-green-600"
                data-testid="sse-status-connected"
              >
                <Wifi className="w-4 h-4" />
                Connected
              </span>
            ) : (
              <span
                className="flex items-center gap-1 text-red-500"
                data-testid="sse-status-disconnected"
              >
                <WifiOff className="w-4 h-4" />
                Disconnected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700">Unread:</span>
            <span
              className="px-2.5 py-0.5 bg-blue-500 text-white text-sm font-medium rounded-full"
              data-testid="unread-count"
            >
              {unreadCount}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={connectSSE}
            disabled={sseConnected}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sseConnected
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
            data-testid="connect-sse-button"
          >
            <Wifi className="w-4 h-4" />
            Connect
          </button>
          <button
            onClick={disconnectSSE}
            disabled={!sseConnected}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !sseConnected
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}
            data-testid="disconnect-sse-button"
          >
            <WifiOff className="w-4 h-4" />
            Disconnect
          </button>
          <button
            onClick={markAllAsRead}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-500 text-white rounded-lg text-sm font-medium hover:bg-gray-600 transition-colors"
            data-testid="mark-all-read-button"
          >
            <CheckCheck className="w-4 h-4" />
            Mark All Read
          </button>
        </div>
      </div>

      <form
        onSubmit={handleCreate}
        className="mb-8 p-6 bg-white rounded-xl shadow-sm border border-gray-200"
      >
        <div className="flex gap-4 mb-4">
          <select
            value={type}
            onChange={e => setType(e.target.value as NotificationType)}
            className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
            data-testid="notification-type-select"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title..."
            className="flex-1 px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            data-testid="notification-title-input"
          />
        </div>
        <div className="mb-4">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Message..."
            className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none min-h-[100px]"
            data-testid="notification-message-input"
          />
        </div>
        <button
          type="submit"
          disabled={!title.trim() || !message.trim() || loading}
          className="flex items-center gap-2 px-6 py-3 text-base font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          data-testid="create-notification-button"
        >
          {loading ? <LoadingSpinner size="sm" color="text-white" /> : <Send className="w-5 h-5" />}
          Create Notification
        </button>
      </form>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {notifications.map(notification => {
          const config = typeConfig[notification.type] ?? typeConfig.info
          const TypeIcon = config.icon
          return (
            <div
              key={notification.id}
              className={`p-5 rounded-xl border-l-4 transition-all ${
                notification.read
                  ? 'bg-gray-50 border-gray-200'
                  : 'bg-white border-gray-200 shadow-sm'
              } ${config.border}`}
              data-testid={
                notification.read ? 'notification-item-read' : 'notification-item-unread'
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge
                      label={notification.type.toUpperCase()}
                      icon={TypeIcon}
                      colorScheme={config.colorScheme}
                    />
                    <span className="font-medium text-gray-900" data-testid="notification-title">
                      {notification.title}
                    </span>
                  </div>
                  <p className="text-gray-600 text-sm" data-testid="notification-message">
                    {notification.message}
                  </p>
                  <span className="text-xs text-gray-400 mt-2 block">
                    {new Date(notification.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!notification.read && (
                    <button
                      onClick={() => markAsRead(notification.id)}
                      className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Mark as read"
                      data-testid="mark-as-read-button"
                    >
                      <CheckCheck className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteNotification(notification.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    data-testid="delete-notification-button"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {!loading && notifications.length === 0 && (
        <EmptyState icon={Bell} title="No notifications yet. Create one above!" className="py-12" />
      )}
    </div>
  )
}
