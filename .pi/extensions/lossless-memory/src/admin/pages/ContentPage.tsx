import { useState, useEffect } from 'react'
import { Table, Card, Tag, Button, Space, Modal, Form, Input, Select, message } from 'antd'
import { Plus, Edit, Delete } from 'lucide-react'
import { PermissionGuard } from '../components/PermissionGuard'
import { Permission } from '@shared/modules/admin'
import { apiClient } from '../services/apiClient'

interface Content {
  id: string
  title: string
  content: string
  category: 'article' | 'announcement' | 'tutorial' | 'news' | 'policy'
  status: 'draft' | 'published' | 'archived'
  author: string
  tags: string[]
  viewCount: number
  likeCount: number
  createdAt: string
}

const CATEGORY_LABELS = {
  article: '文章',
  announcement: '公告',
  tutorial: '教程',
  news: '新闻',
  policy: '政策',
}

const STATUS_COLORS = {
  draft: 'default',
  published: 'success',
  archived: 'warning',
}

const STATUS_LABELS = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

export const ContentPage: React.FC = () => {
  const [contents, setContents] = useState<Content[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingContent, setEditingContent] = useState<Content | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    fetchContents()
  }, [])

  const fetchContents = async () => {
    setLoading(true)
    try {
      const response = await apiClient.api.contents.$get()
      const result = await response.json()
      if (result.success) {
        setContents(result.data)
      }
    } catch {
      message.error('获取内容列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingContent(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (content: Content) => {
    setEditingContent(content)
    form.setFieldsValue(content)
    setModalVisible(true)
  }

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个内容吗？',
      onOk: async () => {
        try {
          const response = await apiClient.api.contents[':id'].$delete({
            param: { id },
          })
          const result = await response.json()
          if (result.success) {
            message.success('内容已删除')
            fetchContents()
          }
        } catch {
          message.error('删除失败')
        }
      },
    })
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (editingContent) {
        const response = await apiClient.api.contents[':id'].$put({
          param: { id: editingContent.id },
          json: values,
        })
        const result = await response.json()
        if (result.success) {
          message.success('内容已更新')
          setModalVisible(false)
          fetchContents()
        }
      } else {
        const response = await apiClient.api.contents.$post({
          json: values,
        })
        const result = await response.json()
        if (result.success) {
          message.success('内容已创建')
          setModalVisible(false)
          fetchContents()
        }
      }
    } catch {
      message.error('操作失败')
    }
  }

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      render: (category: keyof typeof CATEGORY_LABELS) => <Tag>{CATEGORY_LABELS[category]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: keyof typeof STATUS_COLORS) => (
        <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>
      ),
    },
    {
      title: '作者',
      dataIndex: 'author',
      key: 'author',
    },
    {
      title: '浏览/点赞',
      key: 'stats',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (_: any, record: Content) => (
        <span>
          {record.viewCount} / {record.likeCount}
        </span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleDateString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (_: any, record: Content) => (
        <Space>
          <PermissionGuard permission={Permission.CONTENT_EDIT}>
            <Button
              type="link"
              size="small"
              icon={<Edit className="w-4 h-4" />}
              onClick={() => handleEdit(record)}
            >
              编辑
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={Permission.CONTENT_DELETE}>
            <Button
              type="link"
              size="small"
              danger
              icon={<Delete className="w-4 h-4" />}
              onClick={() => handleDelete(record.id)}
            >
              删除
            </Button>
          </PermissionGuard>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">内容管理</h1>
          <p className="text-gray-600 mt-1">管理文章、公告和教程</p>
        </div>
        <PermissionGuard permission={Permission.CONTENT_CREATE}>
          <Button type="primary" icon={<Plus className="w-4 h-4" />} onClick={handleCreate}>
            创建内容
          </Button>
        </PermissionGuard>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={contents}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editingContent ? '编辑内容' : '创建内容'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="请输入标题" />
          </Form.Item>
          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select placeholder="请选择分类">
              <Select.Option value="article">文章</Select.Option>
              <Select.Option value="announcement">公告</Select.Option>
              <Select.Option value="tutorial">教程</Select.Option>
              <Select.Option value="news">新闻</Select.Option>
              <Select.Option value="policy">政策</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="content"
            label="内容"
            rules={[{ required: true, message: '请输入内容' }]}
          >
            <Input.TextArea rows={6} placeholder="请输入内容" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="输入标签后按回车" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
