import { OpenAPIHono } from '@hono/zod-openapi'
import type { AuthUser } from '../../middleware/auth'
import { authRoutes } from './auth-routes'
import { userManagementRoutes } from './user-management-routes'
import { adminNotificationRoutes } from './admin-notification-routes'
import { mediaRoutes } from './media-routes'
import { exportRoutes } from './export-routes'
import { systemRoutes } from './system-routes'

const adminBase1 = new OpenAPIHono<{ Variables: { authUser: AuthUser } }>()
  .route('/', authRoutes)
  .route('/', userManagementRoutes)

const adminBase2 = adminBase1.route('/', adminNotificationRoutes).route('/', mediaRoutes)

const adminBase3 = adminBase2.route('/', exportRoutes).route('/', systemRoutes)

export const adminRoutes = adminBase3

export default adminRoutes
