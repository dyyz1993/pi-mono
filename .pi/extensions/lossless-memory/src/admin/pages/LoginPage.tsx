import { Form, Input, Button, Card, message, Spin, Divider } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { useAdminStore } from '../stores/adminStore'
import { Role } from '@shared/modules/permission'

interface LoginForm {
  username: string
  password: string
}

interface QuickLoginAccount {
  username: string
  password: string
  role: Role
  label: string
  color: string
}

const QUICK_LOGIN_ACCOUNTS: QuickLoginAccount[] = [
  { username: 'superadmin', password: '123456', role: Role.SUPER_ADMIN, label: '超级管理员', color: 'red' },
  { username: 'customerservice', password: '123456', role: Role.CUSTOMER_SERVICE, label: '客服人员', color: 'blue' },
  { username: 'user1', password: '123456', role: Role.USER, label: '普通用户', color: 'green' },
]

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const { login, loading } = useAdminStore()

  const handleSubmit = async (values: LoginForm) => {
    try {
      await login(values.username, values.password)
      message.success('登录成功！')
      navigate('/dashboard')
    } catch (error) {
      message.error((error as Error).message || '登录失败！')
    }
  }

  const handleQuickLogin = async (account: QuickLoginAccount) => {
    try {
      await login(account.username, account.password)
      message.success(`已以${account.label}身份登录！`)
      navigate('/dashboard')
    } catch (error) {
      message.error((error as Error).message || '登录失败！')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Card className="w-full max-w-md" title="管理后台登录">
        <Spin spinning={loading}>
          <Form form={form} onFinish={handleSubmit} layout="vertical">
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名！' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码！' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                登录
              </Button>
            </Form.Item>
            <div className="text-center">
              <span className="text-gray-500">还没有账号？ </span>
              <Link to="/register" className="text-blue-500 hover:underline">
                注册
              </Link>
            </div>
          </Form>
        </Spin>

        <Divider>快速登录</Divider>

        <div className="space-y-2">
          {QUICK_LOGIN_ACCOUNTS.map(account => (
            <Button
              key={account.username}
              block
              size="large"
              onClick={() => handleQuickLogin(account)}
              loading={loading}
              className="flex items-center justify-between"
            >
              <span>{account.label}</span>
              <span className="text-gray-400 text-sm">{account.username}</span>
            </Button>
          ))}
        </div>
      </Card>
    </div>
  )
}
