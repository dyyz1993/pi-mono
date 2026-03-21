import { useState, useEffect } from 'react'
import { Table, Card, Tag, Button, Space, Modal, message, Descriptions } from 'antd'
import { Eye, MessageCircle, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { PermissionGuard } from '../components/PermissionGuard'
import { Permission } from '@shared/modules/admin'
import { apiClient } from '../services/apiClient'

interface TicketReply {
  id: string
  ticketId: string
  content: string
  author: string
  isCustomer: boolean
  createdAt: string
}

interface Ticket {
  id: string
  ticketNo: string
  customerName: string
  customerEmail: string
  subject: string
  description: string
  status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  category: 'technical' | 'billing' | 'feature_request' | 'bug_report' | 'general'
  assignedTo?: string
  createdAt: string
  updatedAt: string
  replies: TicketReply[]
}

const PRIORITY_COLORS = {
  low: 'default',
  medium: 'blue',
  high: 'orange',
  urgent: 'red',
}

const STATUS_COLORS = {
  open: 'blue',
  in_progress: 'processing',
  waiting_customer: 'orange',
  resolved: 'success',
  closed: 'default',
}

const PRIORITY_LABELS = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

const STATUS_LABELS = {
  open: '待处理',
  in_progress: '处理中',
  waiting_customer: '等待客户',
  resolved: '已解决',
  closed: '已关闭',
}

export const TicketsPage: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)

  useEffect(() => {
    fetchTickets()
  }, [])

  const fetchTickets = async () => {
    setLoading(true)
    try {
      const response = await apiClient.api.tickets.$get()
      const result = await response.json()
      if (result.success) {
        setTickets(result.data)
      }
    } catch {
      message.error('获取工单列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = async (ticketId: string) => {
    Modal.confirm({
      title: '确认关闭',
      content: '确定要关闭这个工单吗？',
      onOk: async () => {
        try {
          const response = await apiClient.api.tickets[':id'].close.$put({
            param: { id: ticketId },
          })
          const result = await response.json()
          if (result.success) {
            message.success('工单已关闭')
            fetchTickets()
          }
        } catch {
          message.error('关闭工单失败')
        }
      },
    })
  }

  const showDetail = (ticket: Ticket) => {
    setSelectedTicket(ticket)
    setDetailVisible(true)
  }

  const columns = [
    {
      title: '工单号',
      dataIndex: 'ticketNo',
      key: 'ticketNo',
      render: (text: string) => <code className="text-sm">{text}</code>,
    },
    {
      title: '主题',
      dataIndex: 'subject',
      key: 'subject',
    },
    {
      title: '客户',
      key: 'customer',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (_: any, record: Ticket) => (
        <div>
          <div className="font-medium">{record.customerName}</div>
          <div className="text-sm text-gray-500">{record.customerEmail}</div>
        </div>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      render: (priority: keyof typeof PRIORITY_COLORS) => (
        <Tag color={PRIORITY_COLORS[priority]}>{PRIORITY_LABELS[priority]}</Tag>
      ),
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
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (_: any, record: Ticket) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<Eye className="w-4 h-4" />}
            onClick={() => showDetail(record)}
          >
            查看
          </Button>
          <PermissionGuard permission={Permission.TICKET_CLOSE}>
            {record.status !== 'closed' && (
              <Button
                type="link"
                size="small"
                icon={<CheckCircle className="w-4 h-4" />}
                onClick={() => handleClose(record.id)}
              >
                关闭
              </Button>
            )}
          </PermissionGuard>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">客服中心</h1>
          <p className="text-gray-600 mt-1">处理客户工单和咨询</p>
        </div>
        <Button onClick={fetchTickets}>刷新</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">总工单</div>
              <div className="text-2xl font-bold">{tickets.length}</div>
            </div>
            <MessageCircle className="w-8 h-8 text-blue-500" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">待处理</div>
              <div className="text-2xl font-bold text-blue-500">
                {tickets.filter(t => t.status === 'open').length}
              </div>
            </div>
            <Clock className="w-8 h-8 text-blue-500" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">紧急</div>
              <div className="text-2xl font-bold text-red-500">
                {tickets.filter(t => t.priority === 'urgent').length}
              </div>
            </div>
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">已解决</div>
              <div className="text-2xl font-bold text-green-500">
                {tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length}
              </div>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
        </Card>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={tickets}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showTotal: total => `共 ${total} 条`,
          }}
        />
      </Card>

      <Modal
        title="工单详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
      >
        {selectedTicket && (
          <div>
            <Descriptions column={2} bordered className="mb-4">
              <Descriptions.Item label="工单号">
                <code>{selectedTicket.ticketNo}</code>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_COLORS[selectedTicket.status]}>
                  {STATUS_LABELS[selectedTicket.status]}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="客户姓名">{selectedTicket.customerName}</Descriptions.Item>
              <Descriptions.Item label="客户邮箱">{selectedTicket.customerEmail}</Descriptions.Item>
              <Descriptions.Item label="优先级">
                <Tag color={PRIORITY_COLORS[selectedTicket.priority]}>
                  {PRIORITY_LABELS[selectedTicket.priority]}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="负责人">
                {selectedTicket.assignedTo || '未分配'}
              </Descriptions.Item>
              <Descriptions.Item label="主题" span={2}>
                {selectedTicket.subject}
              </Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>
                {selectedTicket.description}
              </Descriptions.Item>
            </Descriptions>

            {selectedTicket.replies.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold mb-2">回复记录</h4>
                {selectedTicket.replies.map(reply => (
                  <div
                    key={reply.id}
                    className={`p-3 mb-2 rounded ${reply.isCustomer ? 'bg-gray-50' : 'bg-blue-50'}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium">{reply.author}</span>
                      <span className="text-sm text-gray-500">
                        {new Date(reply.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div className="text-gray-700">{reply.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
