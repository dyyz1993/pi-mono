import type { Context } from 'hono'
import type { AuthUser } from '../middleware/auth'
import type { User } from '@shared/modules/admin'
import { Role } from '@shared/modules/admin'

const mockUsers: User[] = [
  {
    id: '1',
    username: 'superadmin',
    email: 'superadmin@example.com',
    role: Role.SUPER_ADMIN,
    status: 'active',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=superadmin',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: '2',
    username: 'customerservice',
    email: 'customerservice@example.com',
    role: Role.CUSTOMER_SERVICE,
    status: 'active',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=customerservice',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
  {
    id: '3',
    username: 'user1',
    email: 'user1@example.com',
    role: Role.USER,
    status: 'active',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user1',
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-03T00:00:00Z',
  },
]

const mockTokens: Map<string, string> = new Map([
  ['super-admin-token', '1'],
  ['customer-service-token', '2'],
  ['user-token', '3'],
])

export function getAuthUser(c: Context): AuthUser {
  return c.get('authUser')
}

export function verifyToken(token: string): User | null {
  const userId = mockTokens.get(token)

  if (!userId) {
    return null
  }

  return mockUsers.find(u => u.id === userId) || null
}

export function getMockUsers(): User[] {
  return mockUsers
}

export function getMockTokens(): Map<string, string> {
  return mockTokens
}
