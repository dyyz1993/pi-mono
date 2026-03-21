import { useState } from 'react'
import { Dropdown, Button, Tag, Space, message } from 'antd'
import { User, RefreshCw } from 'lucide-react'
import { useAdminStore } from '../stores/adminStore'
import { usePermissions } from '../hooks/usePermissions'
import { Role } from '@shared/modules/admin'

interface TestAccount {
  username: string
  password: string
  role: Role
  label: string
  color: string
}

const TEST_ACCOUNTS: TestAccount[] = [
  {
    username: 'superadmin',
    password: '123456',
    role: Role.SUPER_ADMIN,
    label: '超级管理员',
    color: 'red',
  },
  {
    username: 'customerservice',
    password: '123456',
    role: Role.CUSTOMER_SERVICE,
    label: '客服人员',
    color: 'blue',
  },
  {
    username: 'user1',
    password: '123456',
    role: Role.USER,
    label: '普通用户',
    color: 'green',
  },
]

export const AccountSwitcher: React.FC = () => {
  const [switching, setSwitching] = useState(false)
  const { user, login, logout } = useAdminStore()
  const { refreshPermissions } = usePermissions()

  const handleSwitchAccount = async (account: TestAccount) => {
    if (user?.username === account.username) {
      message.info('已经是当前账号')
      return
    }

    setSwitching(true)
    try {
      await logout()
      await login(account.username, account.password)
      await refreshPermissions()
      message.success(`已切换到 ${account.label}`)
      window.location.reload()
    } catch (error) {
      message.error('切换账号失败')
      console.error('Switch account error:', error)
    } finally {
      setSwitching(false)
    }
  }

  const currentRole = user?.role
  const currentAccount = TEST_ACCOUNTS.find(acc => acc.role === currentRole)

  return (
    <Dropdown
      menu={{
        items: TEST_ACCOUNTS.map(account => ({
          key: account.username,
          label: (
            <div className="flex items-center justify-between w-full">
              <span>{account.label}</span>
              {user?.username === account.username && (
                <Tag color="success" className="ml-2">
                  当前
                </Tag>
              )}
            </div>
          ),
          icon: <User className="w-4 h-4" />,
          onClick: () => handleSwitchAccount(account),
        })),
      }}
      trigger={['click']}
    >
      <Button
        type="text"
        className="flex items-center gap-2 text-white hover:bg-gray-700"
        loading={switching}
      >
        <User className="w-4 h-4" />
        <Space>
          <span>{user?.username}</span>
          <Tag color={currentAccount?.color}>{currentAccount?.label || user?.role}</Tag>
        </Space>
        <RefreshCw className="w-3 h-3" />
      </Button>
    </Dropdown>
  )
}
