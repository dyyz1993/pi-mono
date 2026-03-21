# 权限系统使用示例

## 示例1：在页面中控制按钮显示

```tsx
import { PermissionGuard } from '@/admin/components/PermissionGuard'
import { Permission } from '@shared/modules/admin'

export const UserListPage = () => {
  return (
    <div>
      <h1>用户列表</h1>

      {/* 只有有创建用户权限的用户才能看到这个按钮 */}
      <PermissionGuard permission={Permission.USER_CREATE}>
        <button onClick={handleCreateUser}>创建用户</button>
      </PermissionGuard>

      <table>
        <tbody>
          {users.map(user => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>
                {/* 只有有编辑权限的用户才能看到编辑按钮 */}
                <PermissionGuard permission={Permission.USER_EDIT}>
                  <button onClick={() => handleEdit(user)}>编辑</button>
                </PermissionGuard>

                {/* 只有有删除权限的用户才能看到删除按钮 */}
                <PermissionGuard permission={Permission.USER_DELETE}>
                  <button onClick={() => handleDelete(user)}>删除</button>
                </PermissionGuard>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

## 示例2：使用 Can 组件（声明式）

```tsx
import { Can, Cannot } from '@/admin/components/PermissionGuard'
import { Permission } from '@shared/modules/admin'

export const OrderDetailPage = () => {
  return (
    <div>
      <h1>订单详情</h1>

      {/* 有处理订单权限的用户可以看到操作按钮 */}
      <Can I={Permission.ORDER_PROCESS}>
        <button onClick={handleProcess}>处理订单</button>
      </Can>

      {/* 没有权限的用户看到提示 */}
      <Cannot I={Permission.ORDER_PROCESS}>
        <span className="text-gray-500">您没有处理订单的权限</span>
      </Cannot>
    </div>
  )
}
```

## 示例3：使用 Hooks 进行权限检查

```tsx
import { usePermissions, useHasPermission } from '@/admin/hooks/usePermissions'
import { Permission } from '@shared/modules/admin'

export const TicketPage = () => {
  const { hasPermission, hasAnyPermission, role } = usePermissions()
  const canReply = useHasPermission(Permission.TICKET_REPLY)
  const canClose = useHasPermission(Permission.TICKET_CLOSE)

  return (
    <div>
      <h1>工单详情</h1>

      {/* 使用 hook 检查权限 */}
      {canReply && <button onClick={handleReply}>回复工单</button>}

      {canClose && <button onClick={handleClose}>关闭工单</button>}

      {/* 显示当前用户角色 */}
      <div className="text-sm text-gray-500">当前角色：{role}</div>
    </div>
  )
}
```

## 示例4：多个权限检查

```tsx
import { PermissionGuard } from '@/admin/components/PermissionGuard'
import { Permission } from '@shared/modules/admin'

export const DataManagementPage = () => {
  return (
    <div>
      <h1>数据管理</h1>

      {/* 需要同时拥有导入和导出权限 */}
      <PermissionGuard permissions={[Permission.DATA_IMPORT, Permission.DATA_EXPORT]} mode="all">
        <div className="data-actions">
          <button onClick={handleImport}>导入数据</button>
          <button onClick={handleExport}>导出数据</button>
        </div>
      </PermissionGuard>

      {/* 只要有任一权限就可以看到 */}
      <PermissionGuard permissions={[Permission.DATA_IMPORT, Permission.DATA_EXPORT]} mode="any">
        <div className="partial-actions">
          {/* 根据具体权限显示不同按钮 */}
          <PermissionGuard permission={Permission.DATA_IMPORT}>
            <button onClick={handleImport}>导入</button>
          </PermissionGuard>
          <PermissionGuard permission={Permission.DATA_EXPORT}>
            <button onClick={handleExport}>导出</button>
          </PermissionGuard>
        </div>
      </PermissionGuard>
    </div>
  )
}
```

## 示例5：后端路由权限保护

```typescript
import {
  authMiddleware,
  requireSuperAdminMiddleware,
  requirePermissionsMiddleware,
} from '../middleware/auth'
import { Permission } from '@shared/modules/admin'

// 只有超级管理员可以访问
app.get('/api/admin/users', requireSuperAdminMiddleware(), async c => {
  const users = await getUsers()
  return c.json({ success: true, data: users })
})

// 需要特定权限
app.post('/api/admin/users', requirePermissionsMiddleware(Permission.USER_CREATE), async c => {
  const userData = await c.req.json()
  const user = await createUser(userData)
  return c.json({ success: true, data: user })
})

// 需要登录但不需要特定权限
app.get('/api/admin/profile', authMiddleware(), async c => {
  const user = getAuthUser(c)
  return c.json({ success: true, data: user })
})
```

## 示例6：根据角色显示不同内容

```tsx
import { usePermissions } from '@/admin/hooks/usePermissions'
import { Role } from '@shared/modules/admin'

export const DashboardPage = () => {
  const { role, permissions } = usePermissions()

  return (
    <div>
      <h1>仪表盘</h1>

      {/* 根据角色显示不同内容 */}
      {role === Role.SUPER_ADMIN && (
        <div className="admin-panel">
          <h2>管理员面板</h2>
          {/* 管理员专属功能 */}
        </div>
      )}

      {role === Role.CUSTOMER_SERVICE && (
        <div className="customer-service-panel">
          <h2>客服面板</h2>
          {/* 客服专属功能 */}
        </div>
      )}

      {role === Role.USER && (
        <div className="user-panel">
          <h2>用户面板</h2>
          {/* 普通用户功能 */}
        </div>
      )}
    </div>
  )
}
```

## 示例7：权限检查工具函数

```typescript
import { hasPermission, hasAllPermissions } from '@shared/modules/admin'
import { Permission } from '@shared/modules/admin'

// 在组件外部使用
function canUserPerformAction(userPermissions: Permission[], action: string): boolean {
  const permissionMap: Record<string, Permission[]> = {
    'create-user': [Permission.USER_CREATE],
    'delete-user': [Permission.USER_DELETE],
    'manage-orders': [Permission.ORDER_VIEW, Permission.ORDER_PROCESS],
  }

  const requiredPermissions = permissionMap[action]
  if (!requiredPermissions) return false

  return hasAllPermissions(userPermissions, requiredPermissions)
}
```

## 测试账号

为了测试权限系统，可以使用以下测试账号：

- **超级管理员**：用户名 `superadmin`，密码 `123456`
- **客服人员**：用户名 `customerservice`，密码 `123456`
- **普通用户**：用户名 `user1`，密码 `123456`

登录后访问 `/admin/permissions` 页面可以查看当前用户的权限信息。
