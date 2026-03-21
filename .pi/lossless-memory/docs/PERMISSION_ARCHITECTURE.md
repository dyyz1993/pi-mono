# 权限管理系统架构文档

## 系统概述

本权限管理系统采用 RBAC（基于角色的访问控制）模型，实现了细粒度的权限控制，支持按钮级别的显示/隐藏。

## 核心概念

### 1. 角色 (Role)

系统定义了三种角色：

- **超级管理员 (super_admin)**：拥有所有权限，可以管理用户、系统设置等
- **客服人员 (customer_service)**：拥有订单处理、工单管理等客服相关权限
- **普通用户 (user)**：只能查看基本内容

### 2. 权限 (Permission)

权限按照功能模块分类：

- **用户管理**：user:view, user:create, user:edit, user:delete
- **内容管理**：content:view, content:create, content:edit, content:delete
- **系统管理**：system:settings, system:logs, system:monitor
- **数据管理**：data:export, data:import
- **订单管理**：order:view, order:process
- **工单管理**：ticket:view, ticket:reply, ticket:close

### 3. 权限检查模式

- **单个权限检查**：检查用户是否拥有某个特定权限
- **多权限检查（全部）**：用户必须拥有所有指定权限
- **多权限检查（任一）**：用户只需拥有其中一个权限

## 架构设计

### 后端架构

```
┌─────────────────────────────────────────────────────────┐
│                    API Routes                           │
│  /api/admin/permissions/roles                          │
│  /api/admin/permissions                                │
│  /api/admin/permissions/me                             │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Permission Service                         │
│  - getAllRoles()                                        │
│  - getAllPermissions()                                  │
│  - getUserPermissions()                                 │
│  - validatePermissions()                                │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│           Auth Middleware                               │
│  - authMiddleware()                                     │
│  - requireSuperAdminMiddleware()                        │
│  - requirePermissionsMiddleware()                       │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│          Shared Permission Definitions                  │
│  - Role enum                                            │
│  - Permission enum                                      │
│  - ROLE_PERMISSIONS mapping                             │
│  - Permission helper functions                          │
└─────────────────────────────────────────────────────────┘
```

### 前端架构

```
┌─────────────────────────────────────────────────────────┐
│              PermissionProvider                         │
│  - 提供权限上下文                                        │
│  - 自动获取用户权限                                      │
│  - 管理权限状态                                          │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              usePermissions Hook                        │
│  - hasPermission()                                      │
│  - hasAnyPermission()                                   │
│  - hasAllPermissions()                                  │
│  - refreshPermissions()                                 │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│          Permission Components                          │
│  - PermissionGuard：基础权限控制组件                     │
│  - Can：声明式权限组件                                   │
│  - Cannot：反向权限组件                                  │
│  - PermissionButton：权限按钮组件                        │
└─────────────────────────────────────────────────────────┘
```

## 数据流

### 1. 用户登录流程

```
用户登录
   ↓
验证用户名密码
   ↓
获取用户角色
   ↓
根据角色获取权限列表
   ↓
生成 JWT Token（包含用户ID和角色）
   ↓
返回用户信息和权限
```

### 2. 权限检查流程

```
前端组件渲染
   ↓
调用 usePermissions Hook
   ↓
从 PermissionProvider 获取权限
   ↓
PermissionGuard 组件检查权限
   ↓
显示或隐藏组件
```

### 3. API 请求流程

```
前端发起请求
   ↓
携带 Token 到后端
   ↓
Auth Middleware 验证 Token
   ↓
提取用户信息和权限
   ↓
检查路由权限要求
   ↓
允许或拒绝访问
```

## 文件结构

```
template/
├── src/
│   ├── shared/
│   │   └── modules/
│   │       └── admin/
│   │           ├── permissions.ts          # 权限定义和工具函数
│   │           ├── schemas.ts              # 权限相关 Schema
│   │           └── index.ts                # 导出
│   ├── server/
│   │   ├── middleware/
│   │   │   └── auth.ts                     # 认证和权限中间件
│   │   ├── module-admin/
│   │   │   ├── routes/
│   │   │   │   └── admin-routes.ts         # 权限 API 路由
│   │   │   └── services/
│   │   │       └── permission-service.ts   # 权限服务
│   │   └── utils/
│   │       └── auth.ts                     # 认证工具函数
│   └── admin/
│       ├── hooks/
│       │   └── usePermissions.tsx          # 权限 Hook
│       ├── components/
│       │   └── PermissionGuard.tsx         # 权限组件
│       ├── pages/
│       │   └── PermissionsPage.tsx         # 权限管理页面
│       └── config/
│           └── permissions.ts              # 权限配置
└── docs/
    ├── PERMISSION_SYSTEM.md                # 使用文档
    └── PERMISSION_EXAMPLES.md              # 示例文档
```

## 安全考虑

### 1. 前后端双重验证

- **前端**：控制UI显示，提升用户体验
- **后端**：实际权限验证，确保安全

### 2. 权限缓存

- 前端缓存用户权限，减少API调用
- 用户角色变更时自动刷新权限

### 3. Token 安全

- Token 包含用户ID和角色信息
- Token 过期时间合理设置
- 敏感操作需要重新验证

## 扩展性

### 1. 添加新权限

1. 在 `permissions.ts` 中添加新权限枚举
2. 在 `PERMISSION_LABELS` 中添加权限说明
3. 在 `PERMISSION_CATEGORIES` 中归类权限
4. 在 `ROLE_PERMISSIONS` 中为角色分配权限

### 2. 添加新角色

1. 在 `Role` 枚举中添加新角色
2. 在 `ROLE_LABELS` 中添加角色说明
3. 在 `ROLE_PERMISSIONS` 中定义角色权限

### 3. 自定义权限检查

```typescript
// 自定义权限检查逻辑
function customPermissionCheck(user: User, resource: string): boolean {
  // 实现自定义逻辑
  return true
}
```

## 性能优化

### 1. 前端优化

- 使用 Context API 避免重复请求
- 权限数据缓存在本地存储
- 按需加载权限配置

### 2. 后端优化

- 权限数据缓存在内存中
- 使用索引优化权限查询
- 批量权限检查减少数据库查询

## 测试策略

### 1. 单元测试

- 测试权限工具函数
- 测试权限中间件
- 测试权限组件

### 2. 集成测试

- 测试完整的权限检查流程
- 测试不同角色的访问控制

### 3. E2E 测试

- 测试用户登录和权限获取
- 测试权限控制的UI显示

## 最佳实践

1. **最小权限原则**：只授予必要的权限
2. **双重验证**：前后端都要进行权限检查
3. **明确提示**：无权限时提供友好的提示
4. **定期审计**：定期检查和清理不必要的权限
5. **文档维护**：及时更新权限文档

## 监控和日志

- 记录权限检查失败的操作
- 监控权限相关的异常
- 分析权限使用情况

## 未来规划

1. **动态权限**：支持运行时动态分配权限
2. **权限组**：支持权限组管理
3. **数据权限**：支持数据级别的权限控制
4. **权限继承**：支持角色权限继承
