import {
  Role,
  Permission,
  ROLE_LABELS,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
  getPermissionsByRole,
} from '@shared/modules/permission'
import type { RoleInfo, PermissionInfo, UserPermissions } from '@shared/modules/permission'

export interface MenuItem {
  path: string
  label: string
  icon: string
  permissions: Permission[]
  children?: MenuItem[]
}

export interface PageAction {
  key: string
  label: string
  permissions: Permission[]
  mode: 'all' | 'any'
}

export interface PagePermissionConfig {
  path: string
  label: string
  requiredPermissions: Permission[]
  actions: PageAction[]
}

const MENU_CONFIG: MenuItem[] = [
  {
    path: '/dashboard',
    label: '仪表盘',
    icon: 'LayoutDashboard',
    permissions: [],
  },
  {
    path: '/users',
    label: '用户管理',
    icon: 'Users',
    permissions: [Permission.USER_VIEW],
  },
  {
    path: '/orders',
    label: '订单管理',
    icon: 'ShoppingCart',
    permissions: [Permission.ORDER_VIEW],
  },
  {
    path: '/tickets',
    label: '客服中心',
    icon: 'Headphones',
    permissions: [Permission.TICKET_VIEW],
  },
  {
    path: '/disputes',
    label: '争议处理',
    icon: 'AlertTriangle',
    permissions: [Permission.TICKET_VIEW],
  },
  {
    path: '/content',
    label: '内容管理',
    icon: 'FileText',
    permissions: [Permission.CONTENT_VIEW],
  },
  {
    path: '/system',
    label: '系统管理',
    icon: 'Settings',
    permissions: [],
    children: [
      {
        path: '/system/settings',
        label: '系统设置',
        icon: 'Settings',
        permissions: [Permission.SYSTEM_SETTINGS],
      },
      {
        path: '/system/logs',
        label: '系统日志',
        icon: 'FileText',
        permissions: [Permission.SYSTEM_LOGS],
      },
      {
        path: '/system/monitor',
        label: '系统监控',
        icon: 'Activity',
        permissions: [Permission.SYSTEM_MONITOR],
      },
      {
        path: '/system/permissions',
        label: '权限管理',
        icon: 'Shield',
        permissions: [Permission.ROLE_VIEW],
      },
      {
        path: '/system/roles',
        label: '角色管理',
        icon: 'UserCog',
        permissions: [Permission.ROLE_VIEW],
      },
    ],
  },
]

const PAGE_PERMISSIONS: PagePermissionConfig[] = [
  {
    path: '/users',
    label: '用户管理',
    requiredPermissions: [Permission.USER_VIEW],
    actions: [
      {
        key: 'create',
        label: '创建用户',
        permissions: [Permission.USER_CREATE],
        mode: 'all',
      },
      {
        key: 'edit',
        label: '编辑用户',
        permissions: [Permission.USER_EDIT],
        mode: 'all',
      },
      {
        key: 'delete',
        label: '删除用户',
        permissions: [Permission.USER_DELETE],
        mode: 'all',
      },
    ],
  },
  {
    path: '/content',
    label: '内容管理',
    requiredPermissions: [Permission.CONTENT_VIEW],
    actions: [
      {
        key: 'create',
        label: '创建内容',
        permissions: [Permission.CONTENT_CREATE],
        mode: 'all',
      },
      {
        key: 'edit',
        label: '编辑内容',
        permissions: [Permission.CONTENT_EDIT],
        mode: 'all',
      },
      {
        key: 'delete',
        label: '删除内容',
        permissions: [Permission.CONTENT_DELETE],
        mode: 'all',
      },
    ],
  },
  {
    path: '/orders',
    label: '订单管理',
    requiredPermissions: [Permission.ORDER_VIEW],
    actions: [
      {
        key: 'process',
        label: '处理订单',
        permissions: [Permission.ORDER_PROCESS],
        mode: 'all',
      },
    ],
  },
  {
    path: '/tickets',
    label: '工单管理',
    requiredPermissions: [Permission.TICKET_VIEW],
    actions: [
      {
        key: 'reply',
        label: '回复工单',
        permissions: [Permission.TICKET_REPLY],
        mode: 'all',
      },
      {
        key: 'close',
        label: '关闭工单',
        permissions: [Permission.TICKET_CLOSE],
        mode: 'all',
      },
    ],
  },
  {
    path: '/settings',
    label: '系统设置',
    requiredPermissions: [Permission.SYSTEM_SETTINGS],
    actions: [],
  },
]

export function getAllRoles(): RoleInfo[] {
  return Object.values(Role).map(role => ({
    role,
    label: ROLE_LABELS[role],
    permissions: getPermissionsByRole(role),
  }))
}

export function getAllPermissions(): PermissionInfo[] {
  return Object.values(Permission).map(permission => {
    let category = 'other'
    for (const [key, value] of Object.entries(PERMISSION_CATEGORIES)) {
      if (value.permissions.includes(permission)) {
        category = key
        break
      }
    }

    return {
      permission,
      label: PERMISSION_LABELS[permission],
      category,
    }
  })
}

export function getUserPermissions(userId: string, role: Role): UserPermissions {
  return {
    userId,
    role,
    permissions: getPermissionsByRole(role),
  }
}

export function getMenuConfig(): MenuItem[] {
  return MENU_CONFIG
}

export function getPagePermissions(): PagePermissionConfig[] {
  return PAGE_PERMISSIONS
}

export function getPermissionCategories(): Record<
  string,
  { label: string; permissions: Permission[] }
> {
  return PERMISSION_CATEGORIES
}

export function getRoleLabels(): Record<Role, string> {
  return ROLE_LABELS
}

export function getPermissionLabels(): Record<Permission, string> {
  return PERMISSION_LABELS
}
