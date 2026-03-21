# 管理后台完整体验优化计划

## 目标
打造一个功能完整、权限体验丰富的管理后台，让用户能够直观感受不同角色的权限差异。

## 一、快速账号切换功能

### 1.1 创建账号切换组件
**位置**: `src/admin/components/AccountSwitcher.tsx`

**功能**:
- 显示当前登录用户信息（角色、用户名）
- 下拉菜单展示可切换的测试账号
- 一键切换账号（自动执行退出+登录）
- 切换后刷新页面权限

**测试账号**:
- 超级管理员: `superadmin` / `123456`
- 客服人员: `customerservice` / `123456`
- 普通用户: `user1` / `123456`

### 1.2 集成到 Header
**位置**: `src/admin/layouts/Header.tsx`

**修改**:
- 在 Header 右侧添加账号切换器
- 显示当前角色标签（带颜色区分）
- 点击切换后自动刷新权限和页面

## 二、动态导航菜单

### 2.1 基于权限的菜单配置
**位置**: `src/admin/config/menuConfig.ts`

**菜单结构**:
```typescript
[
  {
    path: '/dashboard',
    label: '仪表盘',
    icon: LayoutDashboard,
    permissions: [], // 所有人可见
  },
  {
    path: '/users',
    label: '用户管理',
    icon: Users,
    permissions: [Permission.USER_VIEW],
  },
  {
    path: '/orders',
    label: '订单管理',
    icon: ShoppingCart,
    permissions: [Permission.ORDER_VIEW],
  },
  {
    path: '/tickets',
    label: '客服中心',
    icon: Headphones,
    permissions: [Permission.TICKET_VIEW],
  },
  {
    path: '/content',
    label: '内容管理',
    icon: FileText,
    permissions: [Permission.CONTENT_VIEW],
  },
  {
    path: '/disputes',
    label: '争议处理',
    icon: AlertTriangle,
    permissions: [Permission.TICKET_VIEW], // 客服专属
  },
  {
    path: '/settings',
    label: '系统设置',
    icon: Settings,
    permissions: [Permission.SYSTEM_SETTINGS],
  },
  {
    path: '/permissions',
    label: '权限管理',
    icon: Shield,
    permissions: [], // 所有人可见，但内容不同
  },
]
```

### 2.2 动态 Sidebar 组件
**位置**: `src/admin/layouts/Sidebar.tsx`

**修改**:
- 使用 `usePermissions` Hook 获取权限
- 过滤菜单项，只显示有权限的菜单
- 高亮当前激活菜单

## 三、新增业务页面

### 3.1 订单管理页面
**位置**: `src/admin/pages/OrdersPage.tsx`

**功能**:
- 订单列表展示
- 根据权限显示操作按钮：
  - 客服：只能查看订单
  - 超级管理员：可以处理订单、取消订单
- 订单状态筛选
- 订单详情查看

**权限控制**:
- `ORDER_VIEW`: 查看订单列表
- `ORDER_PROCESS`: 处理订单按钮

### 3.2 客服中心页面
**位置**: `src/admin/pages/TicketsPage.tsx`

**功能**:
- 工单列表展示
- 根据权限显示操作：
  - 客服：可以回复、关闭工单
  - 普通用户：只能查看
- 工单状态管理
- 工单分类筛选

**权限控制**:
- `TICKET_VIEW`: 查看工单
- `TICKET_REPLY`: 回复工单按钮
- `TICKET_CLOSE`: 关闭工单按钮

### 3.3 争议处理页面（客服专属）
**位置**: `src/admin/pages/DisputesPage.tsx`

**功能**:
- 争议订单列表
- 争议详情查看
- 处理争议操作
- 争议状态流转

**权限控制**:
- 仅客服和超级管理员可见
- 客服：处理争议
- 超级管理员：审批争议处理结果

### 3.4 内容管理页面
**位置**: `src/admin/pages/ContentPage.tsx`

**功能**:
- 内容列表（文章、公告等）
- 内容创建、编辑、删除
- 内容分类管理

**权限控制**:
- `CONTENT_VIEW`: 查看内容
- `CONTENT_CREATE`: 创建内容按钮
- `CONTENT_EDIT`: 编辑内容按钮
- `CONTENT_DELETE`: 删除内容按钮

### 3.5 增强版 Dashboard
**位置**: `src/admin/pages/DashboardPage.tsx`

**修改**:
- 根据角色显示不同的统计卡片
- 超级管理员：系统概览、用户统计、订单统计
- 客服：工单统计、待处理争议
- 普通用户：个人数据概览

## 四、Mock 数据服务

### 4.1 订单 Mock 数据
**位置**: `src/server/module-admin/services/order-service.ts`

**数据**:
- 20+ 条订单数据
- 不同状态：待处理、处理中、已完成、已取消
- 包含争议订单

### 4.2 工单 Mock 数据
**位置**: `src/server/module-admin/services/ticket-service.ts`

**数据**:
- 15+ 条工单数据
- 不同状态：待处理、处理中、已关闭
- 不同优先级

### 4.3 争议 Mock 数据
**位置**: `src/server/module-admin/services/dispute-service.ts`

**数据**:
- 10+ 条争议数据
- 不同类型：退款争议、商品争议、服务争议
- 处理状态

### 4.4 内容 Mock 数据
**位置**: `src/server/module-admin/services/content-service.ts`

**数据**:
- 文章、公告等内容
- 不同分类

## 五、API 路由

### 5.1 订单 API
**位置**: `src/server/module-admin/routes/admin-routes.ts`

**新增路由**:
- `GET /api/admin/orders` - 获取订单列表
- `GET /api/admin/orders/:id` - 获取订单详情
- `PUT /api/admin/orders/:id/process` - 处理订单
- `PUT /api/admin/orders/:id/cancel` - 取消订单

### 5.2 工单 API
**新增路由**:
- `GET /api/admin/tickets` - 获取工单列表
- `GET /api/admin/tickets/:id` - 获取工单详情
- `POST /api/admin/tickets/:id/reply` - 回复工单
- `PUT /api/admin/tickets/:id/close` - 关闭工单

### 5.3 争议 API
**新增路由**:
- `GET /api/admin/disputes` - 获取争议列表
- `GET /api/admin/disputes/:id` - 获取争议详情
- `PUT /api/admin/disputes/:id/resolve` - 解决争议

### 5.4 内容 API
**新增路由**:
- `GET /api/admin/content` - 获取内容列表
- `POST /api/admin/content` - 创建内容
- `PUT /api/admin/content/:id` - 更新内容
- `DELETE /api/admin/content/:id` - 删除内容

## 六、前端组件

### 6.1 订单列表组件
**位置**: `src/admin/components/OrderTable.tsx`

**功能**:
- 订单表格展示
- 状态标签
- 操作按钮（权限控制）

### 6.2 工单列表组件
**位置**: `src/admin/components/TicketTable.tsx`

**功能**:
- 工单表格展示
- 优先级标签
- 操作按钮（权限控制）

### 6.3 争议列表组件
**位置**: `src/admin/components/DisputeTable.tsx`

**功能**:
- 争议表格展示
- 争议类型标签
- 处理操作

### 6.4 内容列表组件
**位置**: `src/admin/components/ContentTable.tsx`

**功能**:
- 内容表格展示
- 分类标签
- 编辑、删除操作

## 七、实施步骤

### Step 1: 账号快速切换（优先级：高）
1. 创建 `AccountSwitcher.tsx` 组件
2. 修改 `Header.tsx` 集成切换器
3. 实现自动登录逻辑
4. 测试切换功能

### Step 2: 动态导航菜单（优先级：高）
1. 创建 `menuConfig.ts` 配置文件
2. 修改 `Sidebar.tsx` 实现动态过滤
3. 测试不同角色的菜单显示

### Step 3: Mock 数据服务（优先级：中）
1. 创建订单、工单、争议、内容的 Mock 数据
2. 创建对应的 Service 文件
3. 测试数据获取

### Step 4: API 路由（优先级：中）
1. 在 `admin-routes.ts` 添加新路由
2. 添加权限中间件
3. 测试 API 访问

### Step 5: 业务页面（优先级：中）
1. 创建订单管理页面
2. 创建客服中心页面
3. 创建争议处理页面
4. 创建内容管理页面
5. 增强 Dashboard 页面

### Step 6: 前端组件（优先级：低）
1. 创建订单表格组件
2. 创建工单表格组件
3. 创建争议表格组件
4. 创建内容表格组件

### Step 7: 测试和优化（优先级：高）
1. 测试不同角色的页面访问
2. 测试权限控制
3. 测试账号切换
4. 优化用户体验

## 八、预期效果

### 超级管理员体验
- 看到所有菜单项
- 可以访问所有页面
- 可以执行所有操作
- Dashboard 显示全局统计

### 客服人员体验
- 看到部分菜单：仪表盘、订单管理、客服中心、争议处理、权限管理
- 可以查看和处理订单
- 可以回复和关闭工单
- 可以处理争议
- Dashboard 显示工单和争议统计

### 普通用户体验
- 看到最少菜单：仪表盘、内容管理、权限管理
- 只能查看内容
- Dashboard 显示个人数据

## 九、技术要点

1. **权限粒度**: 按钮级别的权限控制
2. **动态菜单**: 根据权限动态生成导航
3. **角色切换**: 无缝切换不同身份
4. **数据隔离**: 不同角色看到不同数据
5. **用户体验**: 清晰的权限提示和引导

## 十、文件清单

### 新增文件
- `src/admin/components/AccountSwitcher.tsx`
- `src/admin/components/OrderTable.tsx`
- `src/admin/components/TicketTable.tsx`
- `src/admin/components/DisputeTable.tsx`
- `src/admin/components/ContentTable.tsx`
- `src/admin/pages/OrdersPage.tsx`
- `src/admin/pages/TicketsPage.tsx`
- `src/admin/pages/DisputesPage.tsx`
- `src/admin/pages/ContentPage.tsx`
- `src/admin/config/menuConfig.ts`
- `src/server/module-admin/services/order-service.ts`
- `src/server/module-admin/services/ticket-service.ts`
- `src/server/module-admin/services/dispute-service.ts`
- `src/server/module-admin/services/content-service.ts`

### 修改文件
- `src/admin/layouts/Header.tsx`
- `src/admin/layouts/Sidebar.tsx`
- `src/admin/pages/DashboardPage.tsx`
- `src/admin/App.tsx`
- `src/server/module-admin/routes/admin-routes.ts`

## 十一、注意事项

1. 所有 API 都需要添加权限中间件
2. 前端组件需要使用 `PermissionGuard` 包裹敏感操作
3. Mock 数据要真实可信，便于演示
4. 账号切换要刷新权限和页面状态
5. 保持代码风格一致，遵循现有架构
