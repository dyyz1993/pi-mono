import { getRawClient } from './index'

export async function setupTestDatabase(): Promise<void> {
  const client = await getRawClient()

  if (!client || !('execute' in client)) {
    throw new Error('Test database client not available')
  }

  const migrationSQL = `
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      created_at INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS todo_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      todo_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      uploaded_by TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
      FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER DEFAULT false NOT NULL,
      created_at INTEGER DEFAULT (unixepoch() * 1000) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT true,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      is_system INTEGER DEFAULT false,
      is_active INTEGER DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      created_at INTEGER,
      PRIMARY KEY(role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      assigned_by TEXT,
      assigned_at INTEGER,
      expires_at INTEGER,
      is_active INTEGER DEFAULT true,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL,
      method TEXT NOT NULL,
      name TEXT,
      description TEXT,
      module TEXT,
      is_public INTEGER DEFAULT false,
      is_active INTEGER DEFAULT true,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS permission_routes (
      permission_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      created_at INTEGER,
      PRIMARY KEY(permission_id, route_id),
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS permission_audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER
    );
  `

  const statements = migrationSQL.split(';').filter(s => s.trim())

  for (const statement of statements) {
    if (statement.trim()) {
      try {
        await client.execute(statement)
      } catch {
        // Ignore errors for existing tables/indexes
      }
    }
  }

  // Insert default roles and permissions
  await seedTestData(client)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedTestData(client: any): Promise<void> {
  // Insert default roles - names must match test expectations
  const roles = [
    {
      id: 'role_super_admin',
      code: 'super_admin',
      name: '超级管理员',
      label: '超级管理员',
      is_system: 1,
      sort_order: 1,
    },
    {
      id: 'role_admin',
      code: 'admin',
      name: '管理员',
      label: '管理员',
      is_system: 1,
      sort_order: 2,
    },
    {
      id: 'role_user',
      code: 'user',
      name: '普通用户',
      label: '普通用户',
      is_system: 0,
      sort_order: 3,
    },
    {
      id: 'role_customer_service',
      code: 'customer_service',
      name: '客服人员',
      label: '客服',
      is_system: 0,
      sort_order: 4,
    },
  ]

  for (const role of roles) {
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO roles (id, code, name, label, is_system, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          role.id,
          role.code,
          role.name,
          role.label,
          role.is_system,
          1,
          role.sort_order,
          Date.now(),
          Date.now(),
        ],
      })
    } catch {
      // Ignore duplicate errors
    }
  }

  // Insert default permissions - user category (4 permissions)
  const userPermissions = [
    {
      id: 'perm_user_view',
      code: 'user:view',
      name: '查看用户',
      label: '查看用户',
      category: 'user',
    },
    {
      id: 'perm_user_create',
      code: 'user:create',
      name: '创建用户',
      label: '创建用户',
      category: 'user',
    },
    {
      id: 'perm_user_update',
      code: 'user:update',
      name: '更新用户',
      label: '更新用户',
      category: 'user',
    },
    {
      id: 'perm_user_delete',
      code: 'user:delete',
      name: '删除用户',
      label: '删除用户',
      category: 'user',
    },
  ]

  // content category (4 permissions)
  const contentPermissions = [
    {
      id: 'perm_content_view',
      code: 'content:view',
      name: '查看内容',
      label: '查看内容',
      category: 'content',
    },
    {
      id: 'perm_content_create',
      code: 'content:create',
      name: '创建内容',
      label: '创建内容',
      category: 'content',
    },
    {
      id: 'perm_content_update',
      code: 'content:update',
      name: '更新内容',
      label: '更新内容',
      category: 'content',
    },
    {
      id: 'perm_content_delete',
      code: 'content:delete',
      name: '删除内容',
      label: '删除内容',
      category: 'content',
    },
  ]

  // system category (3 permissions)
  const systemPermissions = [
    {
      id: 'perm_system_settings',
      code: 'system:settings',
      name: '系统设置',
      label: '系统设置',
      category: 'system',
    },
    {
      id: 'perm_system_logs',
      code: 'system:logs',
      name: '查看日志',
      label: '查看日志',
      category: 'system',
    },
    {
      id: 'perm_system_backup',
      code: 'system:backup',
      name: '系统备份',
      label: '系统备份',
      category: 'system',
    },
  ]

  // order category (2 permissions)
  const orderPermissions = [
    {
      id: 'perm_order_view',
      code: 'order:view',
      name: '查看订单',
      label: '查看订单',
      category: 'order',
    },
    {
      id: 'perm_order_process',
      code: 'order:process',
      name: '处理订单',
      label: '处理订单',
      category: 'order',
    },
  ]

  // ticket category (3 permissions)
  const ticketPermissions = [
    {
      id: 'perm_ticket_view',
      code: 'ticket:view',
      name: '查看工单',
      label: '查看工单',
      category: 'ticket',
    },
    {
      id: 'perm_ticket_reply',
      code: 'ticket:reply',
      name: '回复工单',
      label: '回复工单',
      category: 'ticket',
    },
    {
      id: 'perm_ticket_close',
      code: 'ticket:close',
      name: '关闭工单',
      label: '关闭工单',
      category: 'ticket',
    },
  ]

  // data category (2 permissions)
  const dataPermissions = [
    {
      id: 'perm_data_export',
      code: 'data:export',
      name: '导出数据',
      label: '导出数据',
      category: 'data',
    },
    {
      id: 'perm_data_import',
      code: 'data:import',
      name: '导入数据',
      label: '导入数据',
      category: 'data',
    },
  ]

  // Combine all permissions
  const allPermissions = [
    ...userPermissions,
    ...contentPermissions,
    ...systemPermissions,
    ...orderPermissions,
    ...ticketPermissions,
    ...dataPermissions,
  ]

  for (const perm of allPermissions) {
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO permissions (id, code, name, label, category, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          perm.id,
          perm.code,
          perm.name,
          perm.label,
          perm.category,
          1,
          0,
          Date.now(),
          Date.now(),
        ],
      })
    } catch {
      // Ignore duplicate errors
    }
  }

  // Assign permissions to roles
  // Super admin gets all permissions
  for (const perm of allPermissions) {
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, ?)`,
        args: ['role_super_admin', perm.id, Date.now()],
      })
    } catch {
      // Ignore duplicate errors
    }
  }

  // Admin gets most permissions except system settings
  for (const perm of allPermissions) {
    if (perm.code !== 'system:settings') {
      try {
        await client.execute({
          sql: `INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, ?)`,
          args: ['role_admin', perm.id, Date.now()],
        })
      } catch {
        // Ignore duplicate errors
      }
    }
  }

  // Customer service gets view permissions for user, content, order, ticket + reply and close for ticket
  const customerServicePermissions = [
    'perm_user_view',
    'perm_content_view',
    'perm_order_view',
    'perm_order_process',
    'perm_ticket_view',
    'perm_ticket_reply',
    'perm_ticket_close',
  ]
  for (const permId of customerServicePermissions) {
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, ?)`,
        args: ['role_customer_service', permId, Date.now()],
      })
    } catch {
      // Ignore duplicate errors
    }
  }

  // User gets limited permissions - view content and order
  const userPermissionsList = ['perm_content_view', 'perm_order_view']
  for (const permId of userPermissionsList) {
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, ?)`,
        args: ['role_user', permId, Date.now()],
      })
    } catch {
      // Ignore duplicate errors
    }
  }
}

export async function cleanupTestDatabase(): Promise<void> {
  const client = await getRawClient()

  if (client && 'execute' in client) {
    await client.execute('DELETE FROM todo_attachments')
    await client.execute('DELETE FROM todos')
    await client.execute('DELETE FROM notifications')
    await client.execute('DELETE FROM permission_routes')
    await client.execute('DELETE FROM permission_audit_logs')
    await client.execute('DELETE FROM role_permissions')
    await client.execute('DELETE FROM user_roles')
    await client.execute('DELETE FROM permissions')
    await client.execute('DELETE FROM roles')
    await client.execute('DELETE FROM routes')
  }
}
