import { getDb } from './driver'
import { permissions, roles, rolePermissions } from './schema'
import { logger } from '../utils/logger'

const log = logger.db()

const initialPermissions = [
  {
    id: 'perm_user_view',
    code: 'user:view',
    name: '查看用户',
    label: '查看用户',
    category: 'user',
    sortOrder: 1,
  },
  {
    id: 'perm_user_create',
    code: 'user:create',
    name: '创建用户',
    label: '创建用户',
    category: 'user',
    sortOrder: 2,
  },
  {
    id: 'perm_user_edit',
    code: 'user:edit',
    name: '编辑用户',
    label: '编辑用户',
    category: 'user',
    sortOrder: 3,
  },
  {
    id: 'perm_user_delete',
    code: 'user:delete',
    name: '删除用户',
    label: '删除用户',
    category: 'user',
    sortOrder: 4,
  },
  {
    id: 'perm_content_view',
    code: 'content:view',
    name: '查看内容',
    label: '查看内容',
    category: 'content',
    sortOrder: 1,
  },
  {
    id: 'perm_content_create',
    code: 'content:create',
    name: '创建内容',
    label: '创建内容',
    category: 'content',
    sortOrder: 2,
  },
  {
    id: 'perm_content_edit',
    code: 'content:edit',
    name: '编辑内容',
    label: '编辑内容',
    category: 'content',
    sortOrder: 3,
  },
  {
    id: 'perm_content_delete',
    code: 'content:delete',
    name: '删除内容',
    label: '删除内容',
    category: 'content',
    sortOrder: 4,
  },
  {
    id: 'perm_system_settings',
    code: 'system:settings',
    name: '系统设置',
    label: '系统设置',
    category: 'system',
    sortOrder: 1,
  },
  {
    id: 'perm_system_logs',
    code: 'system:logs',
    name: '系统日志',
    label: '系统日志',
    category: 'system',
    sortOrder: 2,
  },
  {
    id: 'perm_system_monitor',
    code: 'system:monitor',
    name: '系统监控',
    label: '系统监控',
    category: 'system',
    sortOrder: 3,
  },
  {
    id: 'perm_data_export',
    code: 'data:export',
    name: '数据导出',
    label: '数据导出',
    category: 'data',
    sortOrder: 1,
  },
  {
    id: 'perm_data_import',
    code: 'data:import',
    name: '数据导入',
    label: '数据导入',
    category: 'data',
    sortOrder: 2,
  },
  {
    id: 'perm_order_view',
    code: 'order:view',
    name: '查看订单',
    label: '查看订单',
    category: 'order',
    sortOrder: 1,
  },
  {
    id: 'perm_order_process',
    code: 'order:process',
    name: '处理订单',
    label: '处理订单',
    category: 'order',
    sortOrder: 2,
  },
  {
    id: 'perm_ticket_view',
    code: 'ticket:view',
    name: '查看工单',
    label: '查看工单',
    category: 'ticket',
    sortOrder: 1,
  },
  {
    id: 'perm_ticket_reply',
    code: 'ticket:reply',
    name: '回复工单',
    label: '回复工单',
    category: 'ticket',
    sortOrder: 2,
  },
  {
    id: 'perm_ticket_close',
    code: 'ticket:close',
    name: '关闭工单',
    label: '关闭工单',
    category: 'ticket',
    sortOrder: 3,
  },
  {
    id: 'perm_role_view',
    code: 'role:view',
    name: '查看角色',
    label: '查看角色',
    category: 'role',
    sortOrder: 1,
  },
  {
    id: 'perm_role_create',
    code: 'role:create',
    name: '创建角色',
    label: '创建角色',
    category: 'role',
    sortOrder: 2,
  },
  {
    id: 'perm_role_edit',
    code: 'role:edit',
    name: '编辑角色',
    label: '编辑角色',
    category: 'role',
    sortOrder: 3,
  },
  {
    id: 'perm_role_delete',
    code: 'role:delete',
    name: '删除角色',
    label: '删除角色',
    category: 'role',
    sortOrder: 4,
  },
]

const initialRoles = [
  {
    id: 'role_super_admin',
    code: 'super_admin',
    name: '超级管理员',
    label: '超级管理员',
    isSystem: true,
    sortOrder: 1,
  },
  {
    id: 'role_customer_service',
    code: 'customer_service',
    name: '客服人员',
    label: '客服人员',
    isSystem: true,
    sortOrder: 2,
  },
  {
    id: 'role_user',
    code: 'user',
    name: '普通用户',
    label: '普通用户',
    isSystem: true,
    sortOrder: 3,
  },
]

const initialRolePermissions = [
  { roleId: 'role_super_admin', permissionId: 'perm_user_view' },
  { roleId: 'role_super_admin', permissionId: 'perm_user_create' },
  { roleId: 'role_super_admin', permissionId: 'perm_user_edit' },
  { roleId: 'role_super_admin', permissionId: 'perm_user_delete' },
  { roleId: 'role_super_admin', permissionId: 'perm_content_view' },
  { roleId: 'role_super_admin', permissionId: 'perm_content_create' },
  { roleId: 'role_super_admin', permissionId: 'perm_content_edit' },
  { roleId: 'role_super_admin', permissionId: 'perm_content_delete' },
  { roleId: 'role_super_admin', permissionId: 'perm_system_settings' },
  { roleId: 'role_super_admin', permissionId: 'perm_system_logs' },
  { roleId: 'role_super_admin', permissionId: 'perm_system_monitor' },
  { roleId: 'role_super_admin', permissionId: 'perm_data_export' },
  { roleId: 'role_super_admin', permissionId: 'perm_data_import' },
  { roleId: 'role_super_admin', permissionId: 'perm_order_view' },
  { roleId: 'role_super_admin', permissionId: 'perm_order_process' },
  { roleId: 'role_super_admin', permissionId: 'perm_ticket_view' },
  { roleId: 'role_super_admin', permissionId: 'perm_ticket_reply' },
  { roleId: 'role_super_admin', permissionId: 'perm_ticket_close' },
  { roleId: 'role_customer_service', permissionId: 'perm_content_view' },
  { roleId: 'role_customer_service', permissionId: 'perm_order_view' },
  { roleId: 'role_customer_service', permissionId: 'perm_order_process' },
  { roleId: 'role_customer_service', permissionId: 'perm_ticket_view' },
  { roleId: 'role_customer_service', permissionId: 'perm_ticket_reply' },
  { roleId: 'role_customer_service', permissionId: 'perm_ticket_close' },
  { roleId: 'role_customer_service', permissionId: 'perm_data_export' },
  { roleId: 'role_customer_service', permissionId: 'perm_system_logs' },
  { roleId: 'role_user', permissionId: 'perm_content_view' },
  { roleId: 'role_user', permissionId: 'perm_order_view' },
]

export async function initializeDatabase() {
  const db = await getDb()

  log.info({}, 'Initializing database...')

  const existingPermissions = await db.select().from(permissions)
  if (existingPermissions.length === 0) {
    log.info({}, 'Inserting initial permissions...')
    await db.insert(permissions).values(
      initialPermissions.map(p => ({
        ...p,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
  }

  const existingRoles = await db.select().from(roles)
  if (existingRoles.length === 0) {
    log.info({}, 'Inserting initial roles...')
    await db.insert(roles).values(
      initialRoles.map(r => ({
        ...r,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
  }

  const existingRolePermissions = await db.select().from(rolePermissions)
  if (existingRolePermissions.length === 0) {
    log.info({}, 'Inserting initial role permissions...')
    await db.insert(rolePermissions).values(
      initialRolePermissions.map(rp => ({
        ...rp,
        createdAt: new Date(),
      }))
    )
  }

  log.info({}, 'Database initialization complete!')
}
