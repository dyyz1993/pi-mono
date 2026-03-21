import type { AppNotification, CreateNotificationInput } from '@shared/schemas'
import { generateUUID } from '../../utils/uuid'
import { realtime } from '@server/core'

const notifications: AppNotification[] = []

export function listNotifications(options: {
  unreadOnly?: boolean
  limit?: number
  cursor?: string
}): { data: AppNotification[]; nextCursor?: string } {
  let filtered = [...notifications]

  if (options.unreadOnly) {
    filtered = filtered.filter(n => !n.read)
  }

  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const limit = options.limit ?? 20
  let startIndex = 0

  if (options.cursor) {
    const cursorIndex = filtered.findIndex(n => n.id === options.cursor)
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1
    }
  }

  const data = filtered.slice(startIndex, startIndex + limit)
  const nextCursor = data.length === limit ? data[data.length - 1]?.id : undefined

  return { data, nextCursor }
}

export function getNotification(id: string): AppNotification | undefined {
  return notifications.find(n => n.id === id)
}

export function createNotification(input: CreateNotificationInput): AppNotification {
  const notification: AppNotification = {
    id: generateUUID(),
    type: input.type,
    title: input.title,
    message: input.message,
    read: false,
    createdAt: new Date().toISOString(),
  }

  notifications.unshift(notification)

  return notification
}

export async function createNotificationAndBroadcast(
  input: CreateNotificationInput
): Promise<AppNotification> {
  const notification = createNotification(input)

  try {
    await realtime.broadcast('notification', notification)
  } catch {
    // Ignore broadcast errors in test environment
  }

  return notification
}

export function markAsRead(id: string): AppNotification | undefined {
  const notification = notifications.find(n => n.id === id)
  if (notification) {
    notification.read = true
  }
  return notification
}

export function markAllAsRead(): number {
  let count = 0
  notifications.forEach(n => {
    if (!n.read) {
      n.read = true
      count++
    }
  })
  return count
}

export function deleteNotification(id: string): boolean {
  const index = notifications.findIndex(n => n.id === id)
  if (index !== -1) {
    notifications.splice(index, 1)
    return true
  }
  return false
}

export function getUnreadCount(): number {
  return notifications.filter(n => !n.read).length
}

export function clearAllNotifications(): void {
  notifications.length = 0
}
