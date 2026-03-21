---
paths: src/client/App.tsx
---

# App 入口规范

## 🎯 核心原则

`App.tsx` 是应用的**路由入口**，应该保持**极简**，只负责路由配置。

## 📁 文件职责

### App.tsx 的职责

- ✅ 配置路由（BrowserRouter, Routes, Route）
- ✅ 引用 Layout 组件
- ✅ 定义路由映射

### App.tsx 不应该做的事

- ❌ 定义布局组件（Navigation, Footer 等）
- ❌ 定义业务逻辑
- ❌ 包含复杂的 JSX 结构
- ❌ 定义样式

## 🏗️ 推荐结构

### 标准结构

```
src/client/
├── App.tsx              # 路由入口（极简）
├── Layout.tsx           # 布局组件
├── components/          # 共享组件
│   ├── Navigation.tsx
│   └── Footer.tsx
└── pages/               # 页面组件
    ├── TodoPage.tsx
    └── NotificationPage.tsx
```

### App.tsx 示例

```typescript
// ✅ 正确 - 极简的路由入口
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './Layout'
import { TodoPage } from './pages/TodoPage'
import { NotificationPage } from './pages/NotificationPage'
import { WebSocketPage } from './pages/WebSocketPage'

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/todos" replace />} />
          <Route path="/todos" element={<TodoPage />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/websocket" element={<WebSocketPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
```

## 📦 Layout 组件规范

### Layout.tsx 示例

```typescript
// src/client/Layout.tsx
import { ReactNode } from 'react'
import { Navigation } from './components/Navigation'
import { Footer } from './components/Footer'

interface LayoutProps {
  children: ReactNode
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-gray-50" data-testid="app-container">
      <Navigation />
      <main className="py-8" data-testid="app-main">
        {children}
      </main>
      <Footer />
    </div>
  )
}
```

## 🚫 Anti-Patterns

```typescript
// ❌ 错误 - App.tsx 包含布局逻辑
export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white border-b">
          {/* 导航逻辑 */}
        </nav>
        <main className="py-8">
          <Routes>
            {/* 路由配置 */}
          </Routes>
        </main>
        <footer className="py-8">
          {/* 页脚逻辑 */}
        </footer>
      </div>
    </BrowserRouter>
  )
}

// ✅ 正确 - App.tsx 只负责路由
export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/todos" replace />} />
          <Route path="/todos" element={<TodoPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

// ❌ 错误 - App.tsx 定义组件
const Navigation: React.FC = () => {
  return <nav>...</nav>
}

const Footer: React.FC = () => {
  return <footer>...</footer>
}

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Navigation />
      <Routes>...</Routes>
      <Footer />
    </BrowserRouter>
  )
}

// ✅ 正确 - 组件放在独立文件中
// src/client/components/Navigation.tsx
export const Navigation: React.FC = () => {
  return <nav>...</nav>
}

// src/client/components/Footer.tsx
export const Footer: React.FC = () => {
  return <footer>...</footer>
}

// src/client/Layout.tsx
import { Navigation } from './components/Navigation'
import { Footer } from './components/Footer'

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div>
      <Navigation />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
```

## 📝 路由配置规范

### 路由映射

```typescript
// ✅ 正确 - 使用路由映射
type RouteKey = 'todos' | 'notifications' | 'websocket'

const routes: Record<RouteKey, { path: string; element: React.ReactNode }> = {
  todos: { path: '/todos', element: <TodoPage /> },
  notifications: { path: '/notifications', element: <NotificationPage /> },
  websocket: { path: '/websocket', element: <WebSocketPage /> },
}

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/todos" replace />} />
          {Object.values(routes).map(route => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
```

### 默认路由

```typescript
// ✅ 正确 - 使用 Navigate 重定向
<Route path="/" element={<Navigate to="/todos" replace />} />

// ❌ 错误 - 使用组件作为默认路由
<Route path="/" element={<TodoPage />} />
```

## 🎨 布局灵活性

### 可调整的布局

Layout 组件应该支持灵活调整：

```typescript
// src/client/Layout.tsx
interface LayoutProps {
  children: ReactNode
  className?: string
  showNavigation?: boolean
  showFooter?: boolean
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  className = '',
  showNavigation = true,
  showFooter = true,
}) => {
  return (
    <div className={`min-h-screen bg-gray-50 ${className}`}>
      {showNavigation && <Navigation />}
      <main className="py-8">{children}</main>
      {showFooter && <Footer />}
    </div>
  )
}
```

### 使用示例

```typescript
// 默认布局
<Layout>
  <Routes>...</Routes>
</Layout>

// 自定义布局
<Layout className="bg-white" showFooter={false}>
  <Routes>...</Routes>
</Layout>
```

## 📤 导出规范

```typescript
// ✅ 正确 - 命名导出
export const App: React.FC = () => { ... }

// ❌ 错误 - 默认导出
export default function App() { ... }
```

## 📚 相关文档

- [Client 组件规范](./30-client-components.md) - 组件开发规范
- [Client 服务规范](./31-client-services.md) - API 客户端使用规范
