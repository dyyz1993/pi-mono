---
paths: src/admin/**/*.tsx, src/admin/**/*.ts
---

# Admin 模块开发规范

## 🎯 核心原则

Admin 模块是一个**独立的管理后台**，与主应用完全分离，有自己的入口、布局和路由。

**重要**: Admin 模块位于 `src/admin/`，与 `src/client/`（用户前台）平级，实现用户端与管理端的完全隔离。

**技术栈**: Admin 模块使用 **Ant Design** 作为 UI 组件库。

## 📁 目录结构

```
src/admin/
├── components/                 # 业务组件
│   ├── UserTable.tsx           # 用户表格
│   ├── StatsCard.tsx           # 统计卡片
│   ├── PageHeader.tsx          # 页面头部
│   ├── UserFormModal.tsx       # 用户表单弹窗
│   └── index.ts                # 统一导出
│
├── layouts/                    # 布局组件
│   ├── Layout.tsx              # 主布局
│   ├── Sidebar.tsx             # 侧边栏
│   └── Header.tsx              # 顶部导航
│
├── pages/                      # 页面组件
│   ├── DashboardPage.tsx       # 仪表盘（首页）
│   ├── LoginPage.tsx           # 登录页
│   ├── RegisterPage.tsx        # 注册页
│   ├── SettingsPage.tsx        # 系统设置
│   └── UsersPage.tsx           # 用户管理
│
├── stores/                     # 状态管理
│   └── adminStore.ts           # Admin 状态
│
├── App.tsx                     # 入口（路由配置）
└── main.tsx                    # 启动文件
```

## 🏗️ 多入口架构

### 入口文件

项目支持**两个独立入口**：

| 入口     | 文件                  | HTML         | 访问路径   | 用途     |
| -------- | --------------------- | ------------ | ---------- | -------- |
| 用户前台 | `src/client/main.tsx` | `index.html` | `/`        | 用户前台 |
| 管理后台 | `src/admin/main.tsx`  | `admin.html` | `/admin/*` | 管理后台 |

### Vite 配置

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
      '@server': path.resolve(__dirname, 'src/server'),
      '@admin': path.resolve(__dirname, 'src/admin'),
    },
  },
})
```

## 🎨 UI 组件库

### Ant Design

Admin 模块使用 **Ant Design** 作为 UI 组件库。

**依赖**: `"antd": "^5.24.0"`

### 全局配置

```typescript
// src/admin/App.tsx
import { ConfigProvider } from 'antd'

export const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
        },
      }}
    >
      {/* ... */}
    </ConfigProvider>
  )
}
```

### 常用组件

| 组件      | 用途     |
| --------- | -------- |
| `Layout`  | 页面布局 |
| `Menu`    | 导航菜单 |
| `Form`    | 表单     |
| `Table`   | 数据表格 |
| `Card`    | 卡片容器 |
| `Button`  | 按钮     |
| `Input`   | 输入框   |
| `Modal`   | 弹窗     |
| `message` | 全局提示 |

## 🔧 Admin 入口配置

### App.tsx

```typescript
// src/admin/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import { Layout } from './layouts/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { SettingsPage } from './pages/SettingsPage'

export const App: React.FC = () => {
  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1890ff' } }}>
      <BrowserRouter basename="/admin">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/*"
            element={
              <Layout>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </Layout>
            }
          />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}
```

### main.tsx

```typescript
// src/admin/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import '../client/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

## 📦 布局组件规范

### 目录结构

```
layouts/
├── Layout.tsx     # 主布局（包含侧边栏和顶部导航）
├── Sidebar.tsx    # 侧边栏组件
└── Header.tsx     # 顶部导航组件
```

**注意**: 由于 Admin 模块已经是独立目录，布局组件不需要 `Admin` 前缀。

### Layout.tsx

```typescript
// src/admin/layouts/Layout.tsx
import { ReactNode, useState } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

interface LayoutProps {
  children: ReactNode
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar isOpen={sidebarOpen} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
```

## 📄 页面规范

### 页面类型

| 页面 | 路径         | 文件                | 说明       |
| ---- | ------------ | ------------------- | ---------- |
| 登录 | `/login`     | `LoginPage.tsx`     | 管理员登录 |
| 注册 | `/register`  | `RegisterPage.tsx`  | 管理员注册 |
| 首页 | `/dashboard` | `DashboardPage.tsx` | 仪表盘     |
| 设置 | `/settings`  | `SettingsPage.tsx`  | 系统设置   |

### 登录页面示例

```typescript
// src/admin/pages/LoginPage.tsx
import { Form, Input, Button, Card, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const [form] = Form.useForm()

  const handleSubmit = async (values: any) => {
    try {
      console.log('Login:', values)
      message.success('Login successful!')
      navigate('/dashboard')
    } catch (error) {
      message.error('Login failed!')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Card className="w-full max-w-md" title="Admin Login">
        <Form form={form} onFinish={handleSubmit} layout="vertical">
          <Form.Item name="username" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" size="large" block>
              Login
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
```

## 🎯 业务组件规范

### 业务组件示例

Admin 模块包含以下业务组件：

| 组件            | 文件                | 说明             |
| --------------- | ------------------- | ---------------- |
| `UserTable`     | `UserTable.tsx`     | 用户表格组件     |
| `StatsCard`     | `StatsCard.tsx`     | 统计卡片组件     |
| `PageHeader`    | `PageHeader.tsx`    | 页面头部组件     |
| `UserFormModal` | `UserFormModal.tsx` | 用户表单弹窗组件 |

### 使用业务组件

```typescript
import { UserTable, StatsCard, PageHeader } from '@admin/components'

// 使用 UserTable
<UserTable
  data={users}
  loading={loading}
  onEdit={(user) => console.log('Edit:', user)}
  onDelete={(userId) => console.log('Delete:', userId)}
/>

// 使用 StatsCard
<StatsCard
  title="Total Users"
  value={1234}
  trend={{ value: 12.5, isUp: true }}
/>

// 使用 PageHeader
<PageHeader
  title="User Management"
  subtitle="Manage all users in the system"
  breadcrumbs={[
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Users' },
  ]}
/>
```

## 🔐 权限控制

### 路由守卫

```typescript
// src/admin/components/AuthGuard.tsx
import { Navigate } from 'react-router-dom'
import { useAdminStore } from '../stores/adminStore'

interface AuthGuardProps {
  children: React.ReactNode
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, user } = useAdminStore()

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/admin/unauthorized" replace />
  }

  return <>{children}</>
}
```

### 使用守卫

```typescript
// src/admin/App.tsx
export const App: React.FC = () => {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <AuthGuard>
              <Layout>
                <Routes>...</Routes>
              </Layout>
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
```

## 📊 API 调用

### 使用 admin API

```typescript
// src/admin/stores/adminStore.ts
import { create } from 'zustand'
import { apiClient } from '@client/services/apiClient'
import type { SystemStats } from '@shared/schemas'

interface AdminState {
  stats: SystemStats | null
  fetchStats: () => Promise<void>
}

export const useAdminStore = create<AdminState>(set => ({
  stats: null,

  fetchStats: async () => {
    const response = await apiClient.api.admin.stats.$get()
    const result = await response.json()
    if (result.success) {
      set({ stats: result.data })
    }
  },
}))
```

## 🚫 禁止事项

### 1. 禁止混用用户前台组件

```typescript
// ❌ 错误 - Admin 使用用户前台组件
import { Navigation } from '@client/components/Navigation'

// ✅ 正确 - Admin 使用自己的组件
import { Sidebar } from './layouts/Sidebar'
```

### 2. 禁止共享状态

```typescript
// ❌ 错误 - Admin 使用用户前台 Store
import { useTodoStore } from '@client/stores/todoStore'

// ✅ 正确 - Admin 使用自己的 Store
import { useAdminStore } from './stores/adminStore'
```

### 3. 禁止在 App 中定义布局

```typescript
// ❌ 错误 - App 包含布局逻辑
export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <div className="flex h-screen">
        <Sidebar />
        <main>
          <Routes>...</Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

// ✅ 正确 - App 只负责路由
export const App: React.FC = () => {
  return (
    <BrowserRouter basename="/admin">
      <Layout>
        <Routes>...</Routes>
      </Layout>
    </BrowserRouter>
  )
}
```

## 📝 HTML 入口文件

### admin.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Admin Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/admin/main.tsx"></script>
  </body>
</html>
```

## 🎨 样式规范

Admin 模块可以共享用户前台的样式：

```typescript
// src/admin/main.tsx
import '../client/index.css' // 共享样式
```

也可以使用独立的样式：

```typescript
// src/admin/styles/admin.css
.admin-sidebar {
  width: 250px;
  background: #1f2937;
}
```

## 📚 相关文档

- [App 入口规范](./33-client-app-entry.md) - 用户前台入口规范
- [Client 组件规范](./30-client-components.md) - 用户前台组件规范
- [Server Admin API](./20-server-api.md) - 服务端 Admin API
