export enum Role {
  SUPER_ADMIN = 'super_admin',
  CUSTOMER_SERVICE = 'customer_service',
  USER = 'user',
}

export enum Permission {
  USER_VIEW = 'user:view',
  USER_CREATE = 'user:create',
  USER_EDIT = 'user:edit',
  USER_DELETE = 'user:delete',

  CONTENT_VIEW = 'content:view',
  CONTENT_CREATE = 'content:create',
  CONTENT_EDIT = 'content:edit',
  CONTENT_DELETE = 'content:delete',

  SYSTEM_SETTINGS = 'system:settings',
  SYSTEM_LOGS = 'system:logs',
  SYSTEM_MONITOR = 'system:monitor',

  DATA_EXPORT = 'data:export',
  DATA_IMPORT = 'data:import',

  ORDER_VIEW = 'order:view',
  ORDER_PROCESS = 'order:process',

  TICKET_VIEW = 'ticket:view',
  TICKET_REPLY = 'ticket:reply',
  TICKET_CLOSE = 'ticket:close',

  DISPUTE_VIEW = 'dispute:view',
  DISPUTE_CREATE = 'dispute:create',
  DISPUTE_EDIT = 'dispute:edit',
  DISPUTE_DELETE = 'dispute:delete',
  DISPUTE_RESOLVE = 'dispute:resolve',

  NOTIFICATION_VIEW = 'notification:view',
  NOTIFICATION_CREATE = 'notification:create',
  NOTIFICATION_EDIT = 'notification:edit',
  NOTIFICATION_DELETE = 'notification:delete',

  TODO_VIEW = 'todo:view',
  TODO_CREATE = 'todo:create',
  TODO_EDIT = 'todo:edit',
  TODO_DELETE = 'todo:delete',
  TODO_FILE_UPLOAD = 'todo:file_upload',
  TODO_FILE_DELETE = 'todo:file_delete',

  CHAT_VIEW = 'chat:view',
  CHAT_SEND = 'chat:send',

  ROLE_VIEW = 'role:view',
  ROLE_CREATE = 'role:create',
  ROLE_EDIT = 'role:edit',
  ROLE_DELETE = 'role:delete',
}

export interface RolePermissions {
  [Role.SUPER_ADMIN]: Permission[]
  [Role.CUSTOMER_SERVICE]: Permission[]
  [Role.USER]: Permission[]
}

export const ROLE_PERMISSIONS: RolePermissions = {
  [Role.SUPER_ADMIN]: Object.values(Permission),

  [Role.CUSTOMER_SERVICE]: [
    Permission.USER_VIEW,
    Permission.CONTENT_VIEW,
    Permission.ORDER_VIEW,
    Permission.ORDER_PROCESS,
    Permission.TICKET_VIEW,
    Permission.TICKET_REPLY,
    Permission.TICKET_CLOSE,
    Permission.DATA_EXPORT,
    Permission.SYSTEM_LOGS,
  ],

  [Role.USER]: [Permission.CONTENT_VIEW, Permission.ORDER_VIEW],
}

export const ROLE_LABELS: Record<Role, string> = {
  [Role.SUPER_ADMIN]: '超级管理员',
  [Role.CUSTOMER_SERVICE]: '客服人员',
  [Role.USER]: '普通用户',
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.USER_VIEW]: '查看用户',
  [Permission.USER_CREATE]: '创建用户',
  [Permission.USER_EDIT]: '编辑用户',
  [Permission.USER_DELETE]: '删除用户',

  [Permission.CONTENT_VIEW]: '查看内容',
  [Permission.CONTENT_CREATE]: '创建内容',
  [Permission.CONTENT_EDIT]: '编辑内容',
  [Permission.CONTENT_DELETE]: '删除内容',

  [Permission.SYSTEM_SETTINGS]: '系统设置',
  [Permission.SYSTEM_LOGS]: '查看日志',
  [Permission.SYSTEM_MONITOR]: '系统监控',

  [Permission.DATA_EXPORT]: '数据导出',
  [Permission.DATA_IMPORT]: '数据导入',

  [Permission.ORDER_VIEW]: '查看订单',
  [Permission.ORDER_PROCESS]: '处理订单',

  [Permission.TICKET_VIEW]: '查看工单',
  [Permission.TICKET_REPLY]: '回复工单',
  [Permission.TICKET_CLOSE]: '关闭工单',

  [Permission.DISPUTE_VIEW]: '查看争议',
  [Permission.DISPUTE_CREATE]: '创建争议',
  [Permission.DISPUTE_EDIT]: '编辑争议',
  [Permission.DISPUTE_DELETE]: '删除争议',
  [Permission.DISPUTE_RESOLVE]: '解决争议',

  [Permission.NOTIFICATION_VIEW]: '查看通知',
  [Permission.NOTIFICATION_CREATE]: '创建通知',
  [Permission.NOTIFICATION_EDIT]: '编辑通知',
  [Permission.NOTIFICATION_DELETE]: '删除通知',

  [Permission.TODO_VIEW]: '查看待办',
  [Permission.TODO_CREATE]: '创建待办',
  [Permission.TODO_EDIT]: '编辑待办',
  [Permission.TODO_DELETE]: '删除待办',
  [Permission.TODO_FILE_UPLOAD]: '上传文件',
  [Permission.TODO_FILE_DELETE]: '删除文件',

  [Permission.CHAT_VIEW]: '查看聊天',
  [Permission.CHAT_SEND]: '发送消息',

  [Permission.ROLE_VIEW]: '查看角色',
  [Permission.ROLE_CREATE]: '创建角色',
  [Permission.ROLE_EDIT]: '编辑角色',
  [Permission.ROLE_DELETE]: '删除角色',
}

export const PERMISSION_CATEGORIES = {
  user: {
    label: '用户管理',
    permissions: [
      Permission.USER_VIEW,
      Permission.USER_CREATE,
      Permission.USER_EDIT,
      Permission.USER_DELETE,
    ],
  },
  content: {
    label: '内容管理',
    permissions: [
      Permission.CONTENT_VIEW,
      Permission.CONTENT_CREATE,
      Permission.CONTENT_EDIT,
      Permission.CONTENT_DELETE,
    ],
  },
  system: {
    label: '系统管理',
    permissions: [Permission.SYSTEM_SETTINGS, Permission.SYSTEM_LOGS, Permission.SYSTEM_MONITOR],
  },
  role: {
    label: '角色管理',
    permissions: [
      Permission.ROLE_VIEW,
      Permission.ROLE_CREATE,
      Permission.ROLE_EDIT,
      Permission.ROLE_DELETE,
    ],
  },
  data: {
    label: '数据管理',
    permissions: [Permission.DATA_EXPORT, Permission.DATA_IMPORT],
  },
  order: {
    label: '订单管理',
    permissions: [Permission.ORDER_VIEW, Permission.ORDER_PROCESS],
  },
  ticket: {
    label: '工单管理',
    permissions: [Permission.TICKET_VIEW, Permission.TICKET_REPLY, Permission.TICKET_CLOSE],
  },
  dispute: {
    label: '争议管理',
    permissions: [
      Permission.DISPUTE_VIEW,
      Permission.DISPUTE_CREATE,
      Permission.DISPUTE_EDIT,
      Permission.DISPUTE_DELETE,
      Permission.DISPUTE_RESOLVE,
    ],
  },
  notification: {
    label: '通知管理',
    permissions: [
      Permission.NOTIFICATION_VIEW,
      Permission.NOTIFICATION_CREATE,
      Permission.NOTIFICATION_EDIT,
      Permission.NOTIFICATION_DELETE,
    ],
  },
  todo: {
    label: '待办事项',
    permissions: [
      Permission.TODO_VIEW,
      Permission.TODO_CREATE,
      Permission.TODO_EDIT,
      Permission.TODO_DELETE,
      Permission.TODO_FILE_UPLOAD,
      Permission.TODO_FILE_DELETE,
    ],
  },
  chat: {
    label: '聊天管理',
    permissions: [Permission.CHAT_VIEW, Permission.CHAT_SEND],
  },
}

export function getPermissionsByRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || []
}

export function hasPermission(
  userPermissions: Permission[],
  requiredPermission: Permission
): boolean {
  return userPermissions.includes(requiredPermission)
}

export function hasAnyPermission(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): boolean {
  return requiredPermissions.some(permission => userPermissions.includes(permission))
}

export function hasAllPermissions(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): boolean {
  return requiredPermissions.every(permission => userPermissions.includes(permission))
}
