import { Table, Button, Space, Tag, Avatar } from 'antd'
import { EditOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

interface User {
  id: string
  username: string
  email: string
  role: string
  status: 'active' | 'inactive'
  createdAt: string
}

interface UserTableProps {
  data: User[]
  loading?: boolean
  onEdit?: (user: User) => void
  onDelete?: (userId: string) => void
}

export const UserTable: React.FC<UserTableProps> = ({ data, loading, onEdit, onDelete }) => {
  const columns: ColumnsType<User> = [
    {
      title: 'User',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => (
        <Space>
          <Avatar icon={<UserOutlined />} />
          <span>{text}</span>
        </Space>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => <Tag color="blue">{role}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: 'active' | 'inactive') => (
        <Tag color={status === 'active' ? 'green' : 'red'}>{status}</Tag>
      ),
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => onEdit?.(record)}>
            Edit
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onDelete?.(record.id)}
          >
            Delete
          </Button>
        </Space>
      ),
    },
  ]

  return <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
}
