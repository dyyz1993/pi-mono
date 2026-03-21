import { Permission } from '@shared/modules/admin'

export function validatePermissions(permissions: Permission[]): boolean {
  const allPermissions = Object.values(Permission)
  return permissions.every(p => allPermissions.includes(p))
}
