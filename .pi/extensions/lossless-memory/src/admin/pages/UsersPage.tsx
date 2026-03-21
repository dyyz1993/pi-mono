import { useState, useEffect } from 'react'
import { Table, Card, Button, Modal, Form, Input, Select, Tag, Space, message, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, LockOutlined, UnlockOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { apiClient } from '../services/apiClient'
import { useRoleLabels } from '../hooks/useConfig'
import { Permission, Role } from '@shared/modules/permission'
import { PermissionGuard } from '../components/PermissionGuard'

interface User {
  id: string
  username: string
  email: string
  role: Role
  status: 'active' | 'inactive' | 'locked'
  createdAt: string
  updatedAt: string
  avatar?: string
}

interface UserFormData {
  username: string
  email: string
  password?: string
  role: Role
  status: 'active' | 'inactive' | 'locked'
}

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form] = Form.useForm()
  const { roleLabels } = useRoleLabels()

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const response = await apiClient.api.admin.users.$get()
      const result = await response.json()
      if (result.success) {
        setUsers(result.data as User[])
      }
    } catch {
      message.error('获取用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleCreate = () => {
    setEditingUser(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (user: User) => {
    setEditingUser(user)
    form.setFieldsValue({
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
    })
    setModalVisible(true)
  }

  const handleSubmit = async (values: UserFormData) => {
    try {
      if (editingUser) {
        const response = await apiClient.api.admin.users[':id'].$put({
          param: { id: editingUser.id },
          json: values,
        })
        const result = await response.json()
        if (result.success) {
          message.success('用户更新成功')
          setModalVisible(false)
          fetchUsers()
        }
      } else {
        const response = await apiClient.api.admin.users.$post({
          json: {
            username: values.username,
            email: values.email,
            password: values.password!,
            role: values.role,
            status: values.status,
          },
        })
        const result = await response.json()
        if (result.success) {
          message.success('用户创建成功')
          setModalVisible(false)
          fetchUsers()
        }
      }
    } catch {
      message.error(editingUser ? '更新用户失败' : '创建用户失败')
    }
  }

  const handleToggleLock = async (user: User) => {
    try {
      const newStatus = user.status === 'locked' ? 'active' : 'locked'
      const response = await apiClient.api.admin.users[':id'].$put({
        param: { id: user.id },
        json: { status: newStatus },
      })
      const result = await response.json()
      if (result.success) {
        message.success(newStatus === 'locked' ? '用户已锁定' : '用户已解锁')
        fetchUsers()
      }
    } catch {
      message.error('操作失败')
    }
  }

  const handleDelete = async (userId: string) => {
    try {
      const response = await apiClient.api.admin.users[':id'].$delete({
        param: { id: userId },
      })
      const result = await response.json()
      if (result.success) {
        message.success('用户已删除')
        fetchUsers()
      }
    } catch {
      message.error('删除用户失败')
    }
  }

  const getStatusTag = (status: string) => {
    const statusConfig = {
      active: { color: 'green', text: '正常' },
      inactive: { color: 'orange', text: '未激活' },
      locked: { color: 'red', text: '已锁定' },
    }
    const config = statusConfig[status as keyof typeof statusConfig]
    return <Tag color={config.color}>{config.text}</Tag>
  }

  const columns: ColumnsType<User> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: Role) => <Tag color="blue">{roleLabels[role] || role}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => getStatusTag(status),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: User) => (
        <Space>
          <PermissionGuard permission={Permission.USER_EDIT}>
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            >
              编辑
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={Permission.USER_EDIT}>
            <Button
              type="link"
              icon={record.status === 'locked' ? <UnlockOutlined /> : <LockOutlined />}
              onClick={() => handleToggleLock(record)}
              danger={record.status !== 'locked'}
            >
              {record.status === 'locked' ? '解锁' : '锁定'}
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={Permission.USER_DELETE}>
            <Popconfirm
              title="确定要删除此用户吗？"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="link"
                icon={<DeleteOutlined />}
                danger
              >
                删除
              </Button>
            </Popconfirm>
          </PermissionGuard>
        </Space>
      ),
    },
  ]

  return (
    <div className="p-6">
      <Card
        title="用户管理"
        extra={
          <PermissionGuard permission={Permission.USER_CREATE}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreate}
            >
              创建用户
            </Button>
          </PermissionGuard>
        }
      >
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
        />
      </Card>

      <Modal
        title={editingUser ? '编辑用户' : '创建用户'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          {!editingUser && (
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password placeholder="请输入密码" />
            </Form.Item>
          )}
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="请选择角色">
              <Select.Option value={Role.SUPER_ADMIN}>超级管理员</Select.Option>
              <Select.Option value={Role.CUSTOMER_SERVICE}>客服人员</Select.Option>
              <Select.Option value={Role.USER}>普通用户</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select placeholder="请选择状态">
              <Select.Option value="active">正常</Select.Option>
              <Select.Option value="inactive">未激活</Select.Option>
              <Select.Option value="locked">已锁定</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
