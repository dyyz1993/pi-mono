import { Form, Input, Button, Card, message, Spin } from 'antd'
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { useState } from 'react'
import { apiClient } from '../services/apiClient'

interface RegisterForm {
  username: string
  email: string
  password: string
  confirmPassword: string
}

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (values: RegisterForm) => {
    setLoading(true)
    try {
      const response = await apiClient.api.admin.register.$post({
        json: {
          username: values.username,
          email: values.email,
          password: values.password,
        },
      })
      const result = await response.json()
      if (result.success) {
        message.success('Registration successful! Please login.')
        navigate('/login')
      } else {
        message.error(result.error || 'Registration failed!')
      }
    } catch (error) {
      message.error((error as Error).message || 'Registration failed!')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Card className="w-full max-w-md" title="Admin Registration">
        <Spin spinning={loading}>
          <Form form={form} onFinish={handleSubmit} layout="vertical">
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Please input username!' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
            </Form.Item>
            <Form.Item
              name="email"
              rules={[{ required: true, type: 'email', message: 'Please input valid email!' }]}
            >
              <Input prefix={<MailOutlined />} placeholder="Email" size="large" />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[
                { required: true, min: 6, message: 'Password must be at least 6 characters!' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Please confirm password!' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error('Passwords do not match!'))
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Confirm Password"
                size="large"
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                Register
              </Button>
            </Form.Item>
            <div className="text-center">
              <span className="text-gray-500">Already have an account? </span>
              <Link to="/login" className="text-blue-500 hover:underline">
                Login
              </Link>
            </div>
          </Form>
        </Spin>
      </Card>
    </div>
  )
}
