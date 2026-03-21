import { useEffect, useState } from 'react'
import { apiClient } from '../services/apiClient'
import type { SystemStats } from '@shared/modules/admin'
import type { NotificationType } from '@shared/schemas'
import { Activity, CheckCircle, Clock, TrendingUp, Bell, BellRing } from 'lucide-react'
import { Button, Select, message } from 'antd'

export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [sendingNotification, setSendingNotification] = useState(false)
  const [notificationType, setNotificationType] = useState<NotificationType>('info')

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await apiClient.api.admin.stats.$get()
        const result = await response.json()
        if (result.success) {
          setStats(result.data)
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  const handleSendTestNotification = async () => {
    setSendingNotification(true)
    try {
      const response = await apiClient.api.admin.notifications.test.$post({
        json: { type: notificationType },
      })
      const result = await response.json()
      if (result.success) {
        message.success(`测试通知已发送 (${notificationType})`)
      } else {
        message.error('发送失败')
      }
    } catch (error) {
      console.error('Failed to send test notification:', error)
      message.error('发送失败')
    } finally {
      setSendingNotification(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  const statCards = [
    {
      title: 'Total Todos',
      value: stats?.totalTodos || 0,
      icon: CheckCircle,
      color: 'bg-blue-500',
    },
    {
      title: 'Pending',
      value: stats?.pendingTodos || 0,
      icon: Clock,
      color: 'bg-yellow-500',
    },
    {
      title: 'Completed',
      value: stats?.completedTodos || 0,
      icon: TrendingUp,
      color: 'bg-green-500',
    },
    {
      title: 'Last Updated',
      value: stats?.lastUpdated || '-',
      icon: Activity,
      color: 'bg-purple-500',
    },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((card, index) => {
          const Icon = card.icon
          return (
            <div key={index} className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg ${card.color}`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
              <h3 className="text-sm font-medium text-gray-500">{card.title}</h3>
              <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
            </div>
          )
        })}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <BellRing className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">测试通知功能</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          发送测试通知到所有已连接的客户端。error 和 warning 类型的通知会弹出 antd
          notification，info 和 success 类型只会出现在铃铛列表中。
        </p>
        <div className="flex items-center gap-4">
          <Select
            value={notificationType}
            onChange={setNotificationType}
            style={{ width: 120 }}
            options={[
              { value: 'info', label: 'ℹ️ Info' },
              { value: 'success', label: '✅ Success' },
              { value: 'warning', label: '⚠️ Warning' },
              { value: 'error', label: '❌ Error' },
            ]}
          />
          <Button
            type="primary"
            icon={<Bell className="w-4 h-4" />}
            loading={sendingNotification}
            onClick={handleSendTestNotification}
          >
            发送测试通知
          </Button>
        </div>
      </div>
    </div>
  )
}
