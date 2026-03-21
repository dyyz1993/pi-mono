# 权限管理系统使用指南

## 概述

本系统实现了完整的RBAC（基于角色的访问控制）权限管理，支持三种角色：超级管理员、客服人员和普通用户。

## 角色定义

### 1. 超级管理员 (super_admin)

- 拥有所有权限
- 可以管理用户、内容、系统设置等
- 可以查看系统日志和监控

### 2. 客服人员 (customer_service)

- 查看用户信息
- 查看和处理订单
- 查看和回复工单
- 导出数据
- 查看系统日志

### 3. 普通用户 (user)

- 查看基本内容
- 查看自己的订单

## 权限分类

### 用户管理权限

- `user:view` - 查看用户
- `user:create` - 创建用户
- `user:edit` - 编辑用户
- `user:delete` - 删除用户

### 内容管理权限

- `content:view` - 查看内容
- `content:create` - 创建内容
- `content:edit` - 编辑内容
- `content:delete` - 删除内容

### 系统管理权限

- `system:settings` - 系统设置
- `system:logs` - 查看日志
- `system:monitor` - 系统监控

### 数据管理权限

- `data:export` - 数据导出
- `data:import` - 数据导入

### 订单管理权限

- `order:view` - 查看订单
- `order:process` - 处理订单

### 工单管理权限

- `ticket:view` - 查看工单
- `ticket:reply` - 回复工单
- `ticket:close` - 关闭工单

## 前端使用方法

### 1. 使用 PermissionGuard 组件

```tsx
import { PermissionGuard } from '@/admin/components/PermissionGuard'
import { Permission } from '@shared/modules/admin'

// 单个权限检查
<PermissionGuard permission={Permission.USER_CREATE}>
  <button>创建用户</button>
</PermissionGuard>

// 多个权限检查（需要全部权限）
<PermissionGuard permissions={[Permission.USER_EDIT, Permission.USER_DELETE]}>
  <div>
    <button>编辑</button>
    <button>删除</button>
  </div>
</PermissionGuard>

// 多个权限检查（满足任一权限）
<PermissionGuard
  permissions={[Permission.USER_EDIT, Permission.USER_DELETE]}
  mode="any"
>
  <div>操作区域</div>
</PermissionGuard>

// 设置无权限时的回退内容
<PermissionGuard
  permission={Permission.USER_DELETE}
  fallback={<span>无权限</span>}
>
  <button>删除用户</button>
</PermissionGuard>
```

### 2.使用 Can 组件（声明式）

```tsx
import { Can, Cannot } from '@/admin/components/PermissionGuard'
import { Permission } from '@shared/modules/admin'

// 有权限时显示
<Can I={Permission.USER_CREATE}>
  <button>创建用户</button>
</Can>

// 无权限时显示
<Cannot I={Permission.USER_DELETE}>
  <span>您没有删除权限</span>
</Cannot>

// 多个权限
<Can I={[Permission.USER_EDIT, Permission.USER_DELETE]} mode="all">
  <div>操作区域</div>
</Can>
```

### 3. 使用 Hooks

```tsx
import { usePermissions, useHasPermission } from '@/admin/hooks/usePermissions'
import { Permission } from '@shared/modules/admin'

function MyComponent() {
  const {
    permissions, // 当前用户所有权限
    role, // 当前用户角色
    hasPermission, // 检查单个权限
    hasAnyPermission, // 检查任一权限
    hasAllPermissions, // 检查全部权限
  } = usePermissions()

  // 方式1：直接使用函数
  if (hasPermission(Permission.USER_CREATE)) {
    // 有权限
  }

  // 方式2：使用 hook
  const canCreate = useHasPermission(Permission.USER_CREATE)

  return <div>{canCreate && <button>创建用户</button>}</div>
}
```

### 4. 在页面中使用

```tsx
import { PermissionGuard } from '@/admin/components/PermissionGuard'
import { Permission } from '@shared/modules/admin'

export const UsersPage: React.FC = () => {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1>用户管理</h1>
        <PermissionGuard permission={Permission.USER_CREATE}>
          <button>添加用户</button>
        </PermissionGuard>
      </div>

      <table>
        <tbody>
          {users.map(user => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>
                <PermissionGuard permission={Permission.USER_EDIT}>
                  <button>编辑</button>
                </PermissionGuard>
                <PermissionGuard permission={Permission.USER_DELETE}>
                  <button>删除</button>
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

## 后端使用方法

### 1. 在路由中使用权限中间件

```typescript
import {
  authMiddleware,
  requireSuperAdminMiddleware,
  requirePermissionsMiddleware,
} from '../middleware/auth'
import { Permission } from '@shared/modules/admin'

// 要求超级管理员权限
app.get('/admin/users', requireSuperAdminMiddleware(), async c => {
  // 只有超级管理员可以访问
})

// 要求特定权限
app.post('/admin/users', requirePermissionsMiddleware(Permission.USER_CREATE), async c => {
  // 只有有 user:create 权限的用户可以访问
})

// 要求多个权限（全部）
app.delete('/admin/users/:id', requirePermissionsMiddleware(Permission.USER_DELETE), async c => {
  // 只有有 user:delete 权限的用户可以访问
})
```

### 2. 获取当前用户权限

```typescript
import { getAuthUser } from '../utils/auth'

app.get('/admin/some-route', authMiddleware(), async c => {
  const user = getAuthUser(c)
  // user.permissions 包含用户所有权限
  // user.role 是用户角色

  if (user.permissions.includes(Permission.USER_DELETE)) {
    // 有删除权限
  }
})
```

## API 接口

### 获取所有角色

```
GET /api/admin/permissions/roles
```

### 获取所有权限

```
GET /api/admin/permissions
```

### 获取当前用户权限

```
GET /api/admin/permissions/me
```

## 测试账号

- 超级管理员：用户名 `superadmin`，密码 `123456`
- 客服人员：用户名 `customerservice`，密码 `123456`
- 普通用户：用户名 `user1`，密码 `123456`

## 权限配置文件

权限配置位于 `src/admin/config/permissions.ts`，可以配置每个页面和操作所需的权限。

```typescript
export const PAGE_PERMISSIONS: PagePermissionConfig[] = [
  {
    path: '/admin/users',
    label: '用户管理',
    requiredPermissions: [Permission.USER_VIEW],
    actions: [
      {
        key: 'create',
        label: '创建用户',
        permissions: [Permission.USER_CREATE],
        mode: 'all',
      },
      // ...
    ],
  },
  // ...
]
```

## 最佳实践

1. **最小权限原则**：只授予用户完成工作所需的最小权限
2. **权限检查**：在前端和后端都要进行权限检查
3. **用户体验**：无权限时提供友好的提示信息
4. **权限分组**：按功能模块组织权限
5. **定期审计**：定期检查和清理不必要的权限

## 扩展权限

如果需要添加新的权限：

1. 在 `src/shared/modules/admin/permissions.ts` 中添加新的权限枚举
2. 在 `PERMISSION_LABELS` 中添加权限说明
3. 在 `PERMISSION_CATEGORIES` 中将权限归类
4. 在 `ROLE_PERMISSIONS` 中为各角色分配权限
5. 更新相关页面和路由的权限检查
