import { Bell, CheckCheck, Info, AlertTriangle, XCircle, CheckCircle } from 'lucide-react'
import { Badge, Button, Drawer, Empty, Spin, Tabs } from 'antd'
import type { AppNotification, NotificationType } from '@shared/schemas'

interface NotificationDrawerProps {
  open: boolean
  onClose: () => void
  notifications: AppNotification[]
  unreadCount: number
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
  loading?: boolean
}

const typeConfig: Record<
  NotificationType,
  { color: string; bgColor: string; icon: React.ReactNode }
> = {
  info: {
    color: '#1890ff',
    bgColor: '#e6f7ff',
    icon: <Info className="w-4 h-4" />,
  },
  warning: {
    color: '#faad14',
    bgColor: '#fffbe6',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  error: {
    color: '#ff4d4f',
    bgColor: '#fff2f0',
    icon: <XCircle className="w-4 h-4" />,
  },
  success: {
    color: '#52c41a',
    bgColor: '#f6ffed',
    icon: <CheckCircle className="w-4 h-4" />,
  },
}

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return date.toLocaleDateString('zh-CN')
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  open,
  onClose,
  notifications,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  loading,
}) => {
  const renderNotificationItem = (notif: AppNotification) => {
    const config = typeConfig[notif.type]

    return (
      <div
        key={notif.id}
        className={`p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
          !notif.read ? 'bg-blue-50/50' : ''
        }`}
        onClick={() => !notif.read && onMarkAsRead(notif.id)}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: config.bgColor, color: config.color }}
          >
            {config.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 truncate">{notif.title}</span>
              {!notif.read && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
            </div>
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">{notif.message}</p>
            <span className="text-xs text-gray-400 mt-1 block">{formatTime(notif.createdAt)}</span>
          </div>
        </div>
      </div>
    )
  }

  const unreadNotifications = notifications.filter(n => !n.read)
  const readNotifications = notifications.filter(n => n.read)

  const tabItems = [
    {
      key: 'all',
      label: `全部 (${notifications.length})`,
      children: (
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spin />
            </div>
          ) : notifications.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" className="py-12" />
          ) : (
            notifications.map(renderNotificationItem)
          )}
        </div>
      ),
    },
    {
      key: 'unread',
      label: `未读 (${unreadNotifications.length})`,
      children: (
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {unreadNotifications.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无未读通知"
              className="py-12"
            />
          ) : (
            unreadNotifications.map(renderNotificationItem)
          )}
        </div>
      ),
    },
    {
      key: 'read',
      label: `已读 (${readNotifications.length})`,
      children: (
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {readNotifications.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无已读通知"
              className="py-12"
            />
          ) : (
            readNotifications.map(renderNotificationItem)
          )}
        </div>
      ),
    },
  ]

  return (
    <Drawer
      title={
        <div className="flex items-center justify-between">
          <span>通知中心</span>
          {unreadCount > 0 && (
            <Button
              type="link"
              size="small"
              icon={<CheckCheck className="w-4 h-4" />}
              onClick={onMarkAllAsRead}
              className="text-xs"
            >
              全部已读
            </Button>
          )}
        </div>
      }
      placement="right"
      onClose={onClose}
      open={open}
      width={400}
      styles={{
        header: { borderBottom: '1px solid #f0f0f0' },
        body: { padding: 0 },
      }}
    >
      <Tabs defaultActiveKey="all" items={tabItems} className="px-4" />
    </Drawer>
  )
}

export const NotificationBell: React.FC<{
  unreadCount: number
  onClick: () => void
}> = ({ unreadCount, onClick }) => {
  return (
    <button
      className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative"
      onClick={onClick}
    >
      <Bell className="w-5 h-5 text-gray-600" />
      {unreadCount > 0 && (
        <Badge
          count={unreadCount > 99 ? '99+' : unreadCount}
          size="small"
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 18,
            height: 18,
            fontSize: 10,
            lineHeight: '18px',
          }}
        />
      )}
    </button>
  )
}
