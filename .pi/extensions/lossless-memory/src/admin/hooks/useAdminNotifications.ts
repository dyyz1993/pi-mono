import { useCallback, useEffect, useRef, useState } from 'react'
import { notification } from 'antd'
import { apiClient } from '../services/apiClient'
import type { SSEClient, AppSSEProtocol, AppNotification, UnreadCountEvent } from '@shared/schemas'

type SSEStatus = 'connecting' | 'open' | 'closed'

interface UseAdminNotificationsReturn {
  status: SSEStatus
  notifications: AppNotification[]
  unreadCount: number
  connect: () => Promise<void>
  disconnect: () => void
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  fetchNotifications: () => Promise<void>
}

export function useAdminNotifications(): UseAdminNotificationsReturn {
  const [status, setStatus] = useState<SSEStatus>('closed')
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const clientRef = useRef<SSEClient<AppSSEProtocol> | null>(null)

  const showAntdNotification = useCallback((notif: AppNotification) => {
    if (notif.type === 'error') {
      notification.error({
        message: notif.title,
        description: notif.message,
        placement: 'topRight',
        duration: 0,
      })
    } else if (notif.type === 'warning') {
      notification.warning({
        message: notif.title,
        description: notif.message,
        placement: 'topRight',
        duration: 4.5,
      })
    }
  }, [])

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await apiClient.api.admin.notifications.$get({
        query: { limit: '20' },
      })
      const data = await response.json()
      if (data.success) {
        setNotifications(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    }
  }, [])

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await apiClient.api.admin.notifications['unread-count'].$get()
      const data = await response.json()
      if (data.success) {
        setUnreadCount(data.data.count)
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error)
    }
  }, [])

  const connect = useCallback(async () => {
    if (clientRef.current) return

    setStatus('connecting')

    try {
      const client = apiClient.api.admin.notifications.stream.$sse()
      clientRef.current = client

      client.onStatusChange((newStatus: 'connecting' | 'open' | 'closed') => {
        setStatus(newStatus)
      })

      client.on('connected', () => {
        fetchNotifications()
        fetchUnreadCount()
      })

      client.on('notification', (payload: AppNotification) => {
        setNotifications(prev => [payload, ...prev])
        setUnreadCount(prev => prev + 1)
        showAntdNotification(payload)
      })

      client.on('unread-count', (payload: UnreadCountEvent) => {
        setUnreadCount(payload.count)
      })

      setStatus(client.status)
    } catch (error) {
      console.error('Failed to connect SSE:', error)
      setStatus('closed')
    }
  }, [fetchNotifications, fetchUnreadCount, showAntdNotification])

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.abort()
      clientRef.current = null
      setStatus('closed')
    }
  }, [])

  const markAsRead = useCallback(async (id: string) => {
    try {
      const response = await apiClient.api.admin.notifications[':id'].read.$put({
        param: { id },
      })
      const data = await response.json()
      if (data.success) {
        setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)))
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
    }
  }, [])

  const markAllAsRead = useCallback(async () => {
    try {
      const response = await apiClient.api.admin.notifications['read-all'].$put()
      const data = await response.json()
      if (data.success) {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
        setUnreadCount(0)
      }
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error)
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    status,
    notifications,
    unreadCount,
    connect,
    disconnect,
    markAsRead,
    markAllAsRead,
    fetchNotifications,
  }
}
