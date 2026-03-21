import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import { Layout } from './layouts/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { SettingsPage } from './pages/SettingsPage'
import { PermissionsPage } from './pages/PermissionsPage'
import { RolesPage } from './pages/RolesPage'
import { SystemLogsPage } from './pages/SystemLogsPage'
import { UsersPage } from './pages/UsersPage'
import { OrdersPage } from './pages/OrdersPage'
import { TicketsPage } from './pages/TicketsPage'
import { DisputesPage } from './pages/DisputesPage'
import { ContentPage } from './pages/ContentPage'
import { ProtectedRoute, CaptchaModal } from './components'
import { PermissionProvider } from './hooks/usePermissions'

export const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
        },
      }}
    >
      <PermissionProvider>
        <BrowserRouter basename="/admin">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route path="/users" element={<UsersPage />} />
                      <Route path="/orders" element={<OrdersPage />} />
                      <Route path="/tickets" element={<TicketsPage />} />
                      <Route path="/disputes" element={<DisputesPage />} />
                      <Route path="/content" element={<ContentPage />} />
                      <Route path="/system/settings" element={<SettingsPage />} />
                      <Route path="/system/logs" element={<SystemLogsPage />} />
                      <Route path="/system/monitor" element={<div>系统监控页面（待开发）</div>} />
                      <Route path="/system/permissions" element={<PermissionsPage />} />
                      <Route path="/system/roles" element={<RolesPage />} />
                    </Routes>
                  </Layout>
                </ProtectedRoute>
              }
            />
          </Routes>
          <CaptchaModal />
        </BrowserRouter>
      </PermissionProvider>
    </ConfigProvider>
  )
}
