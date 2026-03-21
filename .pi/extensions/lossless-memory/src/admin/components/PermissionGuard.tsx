import React from 'react'
import { usePermissions } from '../hooks/usePermissions'
import { Permission } from '@shared/modules/admin'

interface PermissionGuardProps {
  permissions?: Permission[]
  permission?: Permission
  mode?: 'any' | 'all'
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function PermissionGuard({
  permissions: permissionsList,
  permission,
  mode = 'all',
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions()

  if (permission) {
    if (!hasPermission(permission)) {
      return <>{fallback}</>
    }
    return <>{children}</>
  }

  if (permissionsList && permissionsList.length > 0) {
    const hasAccess =
      mode === 'any' ? hasAnyPermission(permissionsList) : hasAllPermissions(permissionsList)

    if (!hasAccess) {
      return <>{fallback}</>
    }
  }

  return <>{children}</>
}

interface PermissionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  permissions?: Permission[]
  permission?: Permission
  mode?: 'any' | 'all'
  fallback?: React.ReactNode
}

export function PermissionButton({
  permissions: permissionsList,
  permission,
  mode = 'all',
  children,
  fallback = null,
  ...buttonProps
}: PermissionButtonProps) {
  return (
    <PermissionGuard
      permissions={permissionsList}
      permission={permission}
      mode={mode}
      fallback={fallback}
    >
      <button {...buttonProps}>{children}</button>
    </PermissionGuard>
  )
}

interface CanProps {
  I: Permission | Permission[]
  children: React.ReactNode
  fallback?: React.ReactNode
  mode?: 'any' | 'all'
}

export function Can({ I, children, fallback, mode = 'all' }: CanProps) {
  const permissions = Array.isArray(I) ? I : [I]

  return (
    <PermissionGuard permissions={permissions} mode={mode} fallback={fallback}>
      {children}
    </PermissionGuard>
  )
}

interface CannotProps {
  I: Permission | Permission[]
  children: React.ReactNode
  fallback?: React.ReactNode
  mode?: 'any' | 'all'
}

export function Cannot({ I, children, fallback = null, mode = 'all' }: CannotProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions()
  const permissions = Array.isArray(I) ? I : [I]

  const hasAccess =
    permissions.length === 1
      ? hasPermission(permissions[0])
      : mode === 'any'
        ? hasAnyPermission(permissions)
        : hasAllPermissions(permissions)

  if (hasAccess) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
