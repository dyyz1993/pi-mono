export const PERMISSION_DEPENDENCIES: Record<string, string[]> = {
  'user:create': ['user:view'],
  'user:edit': ['user:view'],
  'user:delete': ['user:view'],
  'content:create': ['content:view'],
  'content:edit': ['content:view'],
  'content:delete': ['content:view'],
  'order:process': ['order:view'],
  'order:cancel': ['order:view'],
  'order:complete': ['order:view'],
  'ticket:reply': ['ticket:view'],
  'ticket:close': ['ticket:view'],
  'data:export': ['user:view'],
  'system:settings': ['system:logs'],
}

export function validatePermissionDependencies(permissions: string[]): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  for (const permission of permissions) {
    const dependencies = PERMISSION_DEPENDENCIES[permission]
    if (dependencies) {
      const missingDeps = dependencies.filter(dep => !permissions.includes(dep))
      if (missingDeps.length > 0) {
        errors.push(`权限 "${permission}" 需要以下权限: ${missingDeps.join(', ')}`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function getRequiredPermissions(permission: string): string[] {
  const dependencies = PERMISSION_DEPENDENCIES[permission]
  if (!dependencies) return []

  const allRequired = [...dependencies]
  for (const dep of dependencies) {
    const subDeps = getRequiredPermissions(dep)
    allRequired.push(...subDeps)
  }

  return [...new Set(allRequired)]
}
