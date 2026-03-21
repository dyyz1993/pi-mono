export * from './schemas'

export {
  Role,
  Permission,
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
  getPermissionsByRole,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
} from '@shared/modules/permission'

export type { RoleInfo, PermissionInfo, UserPermissions } from '@shared/modules/permission'
