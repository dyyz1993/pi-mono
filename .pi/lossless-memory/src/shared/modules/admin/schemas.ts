import { z } from '@hono/zod-openapi'
import { RoleEnum, PermissionEnum } from '@shared/modules/permission'

export const SystemStatsSchema = z.object({
  totalTodos: z.number(),
  pendingTodos: z.number(),
  completedTodos: z.number(),
  lastUpdated: z.string(),
})

export const HealthCheckSchema = z.object({
  database: z.enum(['connected', 'disconnected']),
  timestamp: z.string(),
})

export const RecentActivityItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: z.string(),
  updatedAt: z.string(),
})

export const RecentActivitySchema = z.array(RecentActivityItemSchema)

export const AuthUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  role: RoleEnum,
  avatar: z.string().optional(),
  permissions: z.array(PermissionEnum),
})

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
})

export const LoginResponseSchema = z.object({
  user: AuthUserSchema,
  token: z.string(),
})

export const RegisterRequestSchema = z.object({
  username: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
})

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  role: RoleEnum,
  status: z.enum(['active', 'inactive', 'locked']),
  avatar: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const UserListSchema = z.array(UserSchema)

export const UpdateUserRequestSchema = z.object({
  username: z.string().optional(),
  email: z.string().email().optional(),
  role: RoleEnum.optional(),
  status: z.enum(['active', 'inactive', 'locked']).optional(),
})

export const CreateUserRequestSchema = z.object({
  username: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: RoleEnum,
  status: z.enum(['active', 'inactive', 'locked']).optional().default('active'),
})

export const ClearTodosResultSchema = z.object({
  deletedCount: z.number(),
})

export const SuccessSchema = z.object({})

export const DownloadTokenSchema = z.object({
  token: z.string(),
  downloadUrl: z.string(),
  expiresIn: z.number(),
})

export type SystemStats = z.infer<typeof SystemStatsSchema>
export type HealthCheck = z.infer<typeof HealthCheckSchema>
export type RecentActivityItem = z.infer<typeof RecentActivityItemSchema>
export type AuthUserResponse = z.infer<typeof AuthUserSchema>
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>
export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type LoginResponse = z.infer<typeof LoginResponseSchema>
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>
export type User = z.infer<typeof UserSchema>
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>
export type ClearTodosResult = z.infer<typeof ClearTodosResultSchema>
