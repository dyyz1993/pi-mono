import { getDb, getRawClient } from '../../db'
import { todos } from '../../db/schema'
import { desc } from 'drizzle-orm'
import { toISOString } from '../../utils/date'
import { getMockUsers } from '../../utils/auth'
import { Role, getPermissionsByRole } from '@shared/modules/admin'
import type {
  SystemStats,
  HealthCheck,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  User,
  UpdateUserRequest,
  CreateUserRequest,
} from '@shared/modules/admin'
import type {
  AppNotification,
  NotificationType,
  CreateNotificationInput,
} from '@shared/modules/notifications'
import { generateUUID } from '../../utils/uuid'
import { realtime } from '@server/core'

const notifications: AppNotification[] = []

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

  if (notifications.length > 100) {
    notifications.pop()
  }

  return notification
}

export async function createNotificationAndBroadcast(
  input: CreateNotificationInput
): Promise<AppNotification> {
  const notification = createNotification(input)
  try {
    await realtime.broadcast('notification', notification)

    const unreadCount = notifications.filter(n => !n.read).length
    await realtime.broadcast('unread-count', { count: unreadCount })
  } catch {
    // Ignore broadcast errors in test environment
  }

  return notification
}

export function getNotifications(options?: {
  unreadOnly?: boolean
  limit?: number
}): AppNotification[] {
  let result = [...notifications]

  if (options?.unreadOnly) {
    result = result.filter(n => !n.read)
  }

  const limit = options?.limit || 20
  return result.slice(0, limit)
}

export function getUnreadCount(): number {
  return notifications.filter(n => !n.read).length
}

export async function markNotificationRead(id: string): Promise<boolean> {
  const notification = notifications.find(n => n.id === id)
  if (notification) {
    notification.read = true
    const unreadCount = getUnreadCount()
    try {
      await realtime.broadcast('unread-count', { count: unreadCount })
    } catch {
      // Ignore broadcast errors in test environment
    }
    return true
  }
  return false
}

export async function markAllNotificationsRead(): Promise<number> {
  let count = 0
  for (const notification of notifications) {
    if (!notification.read) {
      notification.read = true
      count++
    }
  }
  try {
    await realtime.broadcast('unread-count', { count: 0 })
  } catch {
    // Ignore broadcast errors in test environment
  }
  return count
}

export async function sendTestNotification(
  type: NotificationType = 'info'
): Promise<AppNotification> {
  const titles: Record<NotificationType, string> = {
    info: '系统通知',
    warning: '警告通知',
    error: '错误通知',
    success: '成功通知',
  }

  const messages: Record<NotificationType, string> = {
    info: '这是一条普通信息通知',
    warning: '这是一条警告通知，请注意！',
    error: '这是一条错误通知，请立即处理！',
    success: '操作成功完成！',
  }

  return createNotificationAndBroadcast({
    type,
    title: titles[type],
    message: messages[type],
  })
}

export async function getSystemStats(): Promise<SystemStats> {
  const rawClient = await getRawClient()

  if (rawClient && 'execute' in rawClient) {
    const totalResult = await rawClient.execute('SELECT COUNT(*) as count FROM todos')
    const pendingResult = await rawClient.execute(
      "SELECT COUNT(*) as count FROM todos WHERE status = 'pending'"
    )
    const completedResult = await rawClient.execute(
      "SELECT COUNT(*) as count FROM todos WHERE status = 'completed'"
    )

    const getCount = (rows: unknown[]) => {
      const row = rows[0] as Record<string, unknown> | undefined
      return typeof row?.count === 'number' ? row.count : 0
    }

    return {
      totalTodos: getCount(totalResult.rows),
      pendingTodos: getCount(pendingResult.rows),
      completedTodos: getCount(completedResult.rows),
      lastUpdated: new Date().toISOString(),
    }
  }

  const db = await getDb()
  const allTodos = await db.select().from(todos)

  return {
    totalTodos: allTodos.length,
    pendingTodos: allTodos.filter(t => t.status === 'pending').length,
    completedTodos: allTodos.filter(t => t.status === 'completed').length,
    lastUpdated: new Date().toISOString(),
  }
}

export async function checkDatabaseHealth(): Promise<HealthCheck> {
  try {
    const db = await getDb()
    await db.select().from(todos).limit(1)
    return {
      database: 'connected',
      timestamp: new Date().toISOString(),
    }
  } catch {
    return {
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    }
  }
}

export async function clearAllTodos(): Promise<{ deletedCount: number }> {
  const db = await getDb()
  const result = await db.delete(todos).returning()
  return { deletedCount: result.length }
}

export async function getRecentActivity(limit: number = 10): Promise<
  Array<{
    id: number
    title: string
    status: string
    updatedAt: string
  }>
> {
  const db = await getDb()
  const results = await db.select().from(todos).orderBy(desc(todos.updatedAt)).limit(limit)

  return results.map(r => ({
    id: r.id,
    title: r.title,
    status: r.status,
    updatedAt: toISOString(r.updatedAt),
  }))
}

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const mockUsers = getMockUsers()
  const user = mockUsers.find(u => u.username === data.username)

  if (!user) {
    throw new Error('User not found')
  }

  if (data.password !== '123456') {
    throw new Error('Invalid password')
  }

  let token: string
  if (user.role === Role.SUPER_ADMIN) {
    token = `test-super-admin-${user.id}`
  } else if (user.role === Role.CUSTOMER_SERVICE) {
    token = `test-customer-service-${user.id}`
  } else {
    token = `test-user-${user.id}`
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      permissions: getPermissionsByRole(user.role as Role),
    },
    token,
  }
}

export async function register(data: RegisterRequest): Promise<User> {
  const mockUsers = getMockUsers()
  const existingUser = mockUsers.find(u => u.username === data.username || u.email === data.email)

  if (existingUser) {
    throw new Error('User already exists')
  }

  const newUser: User = {
    id: String(mockUsers.length + 1),
    username: data.username,
    email: data.email,
    role: Role.USER,
    status: 'active',
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  mockUsers.push(newUser)

  return newUser
}

export async function getUsers(): Promise<User[]> {
  return getMockUsers()
}

export async function getUserById(id: string): Promise<User | null> {
  const mockUsers = getMockUsers()
  return mockUsers.find(u => u.id === id) || null
}

export async function updateUser(id: string, data: UpdateUserRequest): Promise<User> {
  const mockUsers = getMockUsers()
  const userIndex = mockUsers.findIndex(u => u.id === id)

  if (userIndex === -1) {
    throw new Error('User not found')
  }

  const updatedUser: User = {
    ...mockUsers[userIndex],
    ...data,
    updatedAt: new Date().toISOString(),
  }

  mockUsers[userIndex] = updatedUser

  return updatedUser
}

export async function deleteUser(id: string): Promise<void> {
  const mockUsers = getMockUsers()
  const userIndex = mockUsers.findIndex(u => u.id === id)

  if (userIndex === -1) {
    throw new Error('User not found')
  }

  mockUsers.splice(userIndex, 1)
}

export async function createUser(data: CreateUserRequest): Promise<User> {
  const mockUsers = getMockUsers()

  const existingUser = mockUsers.find(u => u.username === data.username || u.email === data.email)
  if (existingUser) {
    throw new Error('User with this username or email already exists')
  }

  const newUser: User = {
    id: `user-${Date.now()}`,
    username: data.username,
    email: data.email,
    role: data.role,
    status: data.status || 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  mockUsers.push(newUser)
  return newUser
}

export async function getAllTodos(): Promise<
  Array<{
    id: number
    title: string
    completed: boolean
    createdAt: string
  }>
> {
  const db = await getDb()
  const results = await db.select().from(todos).orderBy(desc(todos.createdAt))

  return results.map(r => ({
    id: r.id,
    title: r.title,
    completed: r.status === 'completed',
    createdAt: toISOString(r.createdAt),
  }))
}

const avatarCache = new Map<string, { data: Blob; contentType: string }>()
const iconCache = new Map<string, string>()

export async function getAvatar(id: string): Promise<{ data: Blob; contentType: string } | null> {
  if (avatarCache.has(id)) {
    return avatarCache.get(id)!
  }
  const response = await fetch(`https://api.dicebear.com/7.x/avataaars/png?seed=${id}`)
  if (!response.ok) {
    return null
  }
  const data = await response.blob()
  const result = { data, contentType: 'image/png' }
  avatarCache.set(id, result)
  return result
}

export async function getIcon(name: string): Promise<string | null> {
  if (iconCache.has(name)) {
    return iconCache.get(name)!
  }
  const icons: Record<string, string> = {
    home: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-6 6 6 6-6 9 9 6-6-9-9z"></path><path d="M9 21l6-6 6 6-6 9 9 6-6 9-9z"></path></svg>`,
    settings: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 3 3 3 3 3 0 0 6.3 6.3A1.65 1.65 0 0 3 3 3 3 3 0 0 6.3 6.3a1.65 1.65 0 0 3 3 3 3 3 0 0 6.3 6.3z"></path></svg>`,
    user: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0 1-3 1H4a4 4 0 0 0 1 3v2"></path><circle cx="12" cy="7" r="4"></circle><path d="M16 11.37A4 4 0 1 1.8 2.44L8 2.44A4 4 0 1 1.8 2z"></path></svg>`,
    bell: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 6c0 1.1.9 2.1 2.1-2 2.1-.9.9-.9 2.1-2 2.1A6 6 0 0 0 6-6 7-9l1-1.1c.7-.7 1.9-2 2.1-.9-.9-.9-2.1-2-2.1A6 6 0 0 0-6 6-7 9l-1 1.1c-.7.7-1.9 2-2.1.9.9.9 2.1 2 2.1z"></path><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path><line x1="15" y1="12"></line><line x1="15" y1="9"></line></svg>`,
  }
  const svg = icons[name]
  if (!svg) {
    return null
  }
  iconCache.set(name, svg)
  return svg
}
