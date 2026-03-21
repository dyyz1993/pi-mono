import { Menu, User, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Dropdown, Avatar } from 'antd'
import type { MenuProps } from 'antd'
import { useAdminStore } from '../stores/adminStore'
import { useAdminNotifications } from '../hooks/useAdminNotifications'
import { NotificationDrawer, NotificationBell } from '../components/NotificationDrawer'
import { AccountSwitcher } from '../components/AccountSwitcher'
import { useEffect, useState } from 'react'

interface HeaderProps {
  onToggleSidebar: () => void
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const navigate = useNavigate()
  const { user, logout } = useAdminStore()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { status, notifications, unreadCount, connect, markAsRead, markAllAsRead } =
    useAdminNotifications()

  useEffect(() => {
    if (status === 'closed') {
      connect()
    }
  }, [status, connect])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'profile',
      label: 'Profile',
      icon: <User className="w-4 h-4" />,
    },
    {
      key: 'settings',
      label: 'Settings',
      onClick: () => navigate('/settings'),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      label: 'Logout',
      icon: <LogOut className="w-4 h-4" />,
      danger: true,
      onClick: handleLogout,
    },
  ]

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          data-testid="toggle-sidebar-button"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>

        <div className="flex items-center gap-4">
          <NotificationBell unreadCount={unreadCount} onClick={() => setDrawerOpen(true)} />
          <AccountSwitcher />
          <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
            <button className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
              <Avatar
                size="small"
                src={user?.avatar}
                icon={!user?.avatar && <User className="w-4 h-4" />}
              />
            </button>
          </Dropdown>
        </div>
      </header>

      <NotificationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAsRead={markAsRead}
        onMarkAllAsRead={markAllAsRead}
        loading={status === 'connecting'}
      />
    </>
  )
}
