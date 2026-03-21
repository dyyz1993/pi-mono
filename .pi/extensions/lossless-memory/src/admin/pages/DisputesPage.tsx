import { useState, useEffect } from 'react'
import { Table, Card, Tag, Button, Space, Modal, message, Descriptions } from 'antd'
import { Eye, AlertTriangle, CheckCircle } from 'lucide-react'
import { PermissionGuard } from '../components/PermissionGuard'
import { Permission } from '@shared/modules/admin'
import { apiClient } from '../services/apiClient'

interface Dispute {
  id: string
  disputeNo: string
  orderNo: string
  customerName: string
  customerEmail: string
  type: 'refund' | 'product_quality' | 'service_quality' | 'delivery' | 'other'
  status: 'pending' | 'investigating' | 'resolved' | 'rejected'
  description: string
  resolution?: string
  amount: number
  createdAt: string
  updatedAt: string
}

const TYPE_LABELS = {
  refund: '退款争议',
  product_quality: '商品质量',
  service_quality: '服务质量',
  delivery: '配送问题',
  other: '其他',
}

const STATUS_COLORS = {
  pending: 'orange',
  investigating: 'blue',
  resolved: 'green',
  rejected: 'red',
}

const STATUS_LABELS = {
  pending: '待处理',
  investigating: '调查中',
  resolved: '已解决',
  rejected: '已驳回',
}

export const DisputesPage: React.FC = () => {
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)

  useEffect(() => {
    fetchDisputes()
  }, [])

  const fetchDisputes = async () => {
    setLoading(true)
    try {
      const response = await apiClient.api.disputes.$get()
      const result = await response.json()
      if (result.success) {
        setDisputes(result.data as unknown as Dispute[])
      }
    } catch {
      message.error('获取争议列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleResolve = (dispute: Dispute) => {
    Modal.confirm({
      title: '解决争议',
      content: (
        <div>
          <p>确定要解决这个争议吗？</p>
          <p>金额：¥{dispute.amount.toFixed(2)}</p>
        </div>
      ),
      onOk: async () => {
        try {
          const response = await apiClient.api.disputes[':id'].resolve.$put({
            param: { id: dispute.id },
            json: {
              resolution: '已同意退款，3-5个工作日内到账',
              resolvedBy: '客服人员',
            },
          })
          const result = await response.json()
          if (result.success) {
            message.success('争议已解决')
            fetchDisputes()
          }
        } catch {
          message.error('解决争议失败')
        }
      },
    })
  }

  const showDetail = (dispute: Dispute) => {
    setSelectedDispute(dispute)
    setDetailVisible(true)
  }

  const columns = [
    {
      title: '争议编号',
      dataIndex: 'disputeNo',
      key: 'disputeNo',
      render: (text: string) => <code className="text-sm">{text}</code>,
    },
    {
      title: '订单号',
      dataIndex: 'orderNo',
      key: 'orderNo',
    },
    {
      title: '客户',
      key: 'customer',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (_: any, record: Dispute) => (
        <div>
          <div className="font-medium">{record.customerName}</div>
          <div className="text-sm text-gray-500">{record.customerEmail}</div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: keyof typeof TYPE_LABELS) => TYPE_LABELS[type],
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number) => (
        <span className="font-medium text-red-600">¥{amount.toFixed(2)}</span>
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
      render: (_: any, record: Dispute) => (
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
            {(record.status === 'pending' || record.status === 'investigating') && (
              <Button
                type="link"
                size="small"
                icon={<CheckCircle className="w-4 h-4" />}
                onClick={() => handleResolve(record)}
              >
                解决
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
          <h1 className="text-2xl font-bold text-gray-900">争议处理</h1>
          <p className="text-gray-600 mt-1">处理订单争议和客户投诉</p>
        </div>
        <Button onClick={fetchDisputes}>刷新</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">总争议</div>
              <div className="text-2xl font-bold">{disputes.length}</div>
            </div>
            <AlertTriangle className="w-8 h-8 text-orange-500" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">待处理</div>
              <div className="text-2xl font-bold text-orange-500">
                {disputes.filter(d => d.status === 'pending').length}
              </div>
            </div>
            <AlertTriangle className="w-8 h-8 text-orange-500" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">已解决</div>
              <div className="text-2xl font-bold text-green-500">
                {disputes.filter(d => d.status === 'resolved').length}
              </div>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
        </Card>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={disputes}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="争议详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={600}
      >
        {selectedDispute && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="争议编号">
              <code>{selectedDispute.disputeNo}</code>
            </Descriptions.Item>
            <Descriptions.Item label="订单号">{selectedDispute.orderNo}</Descriptions.Item>
            <Descriptions.Item label="客户">
              {selectedDispute.customerName} ({selectedDispute.customerEmail})
            </Descriptions.Item>
            <Descriptions.Item label="类型">{TYPE_LABELS[selectedDispute.type]}</Descriptions.Item>
            <Descriptions.Item label="金额">
              <span className="text-lg font-bold text-red-600">
                ¥{selectedDispute.amount.toFixed(2)}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATUS_COLORS[selectedDispute.status]}>
                {STATUS_LABELS[selectedDispute.status]}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="描述">{selectedDispute.description}</Descriptions.Item>
            {selectedDispute.resolution && (
              <Descriptions.Item label="解决方案">{selectedDispute.resolution}</Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  )
}
