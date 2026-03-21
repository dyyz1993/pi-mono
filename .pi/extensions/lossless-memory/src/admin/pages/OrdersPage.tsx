import { useState, useEffect, useCallback } from 'react'
import { Table, Card, Tag, Button, Space, Modal, Select, message, Descriptions } from 'antd'
import { Eye, CheckCircle, XCircle, Clock, DollarSign } from 'lucide-react'
import { PermissionGuard } from '../components/PermissionGuard'
import { Permission } from '@shared/modules/admin'
import { apiClient } from '../services/apiClient'

interface Order {
  id: string
  orderNo: string
  customerName: string
  customerEmail: string
  productName: string
  amount: number
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'disputed'
  createdAt: string
  updatedAt: string
}

const STATUS_COLORS = {
  pending: 'orange',
  processing: 'blue',
  completed: 'green',
  cancelled: 'red',
  disputed: 'purple',
}

const STATUS_LABELS = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  cancelled: '已取消',
  disputed: '争议中',
}

export const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string | undefined>()

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.append('status', filterStatus)

      const response = await apiClient.api.orders.$get({
        query: Object.fromEntries(params),
      })
      const result = await response.json()
      if (result.success) {
        setOrders(result.data)
      }
    } catch {
      message.error('获取订单列表失败')
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleProcess = async (orderId: string) => {
    try {
      const response = await apiClient.api.orders[':id'].process.$put({
        param: { id: orderId },
      })
      const result = await response.json()
      if (result.success) {
        message.success('订单已开始处理')
        fetchOrders()
      }
    } catch {
      message.error('处理订单失败')
    }
  }

  const handleCancel = async (orderId: string) => {
    Modal.confirm({
      title: '确认取消',
      content: '确定要取消这个订单吗？',
      onOk: async () => {
        try {
          const response = await apiClient.api.orders[':id'].cancel.$put({
            param: { id: orderId },
          })
          const result = await response.json()
          if (result.success) {
            message.success('订单已取消')
            fetchOrders()
          }
        } catch {
          message.error('取消订单失败')
        }
      },
    })
  }

  const showDetail = (order: Order) => {
    setSelectedOrder(order)
    setDetailVisible(true)
  }

  const columns = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      render: (text: string) => <code className="text-sm">{text}</code>,
    },
    {
      title: '客户信息',
      key: 'customer',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (_: any, record: Order) => (
        <div>
          <div className="font-medium">{record.customerName}</div>
          <div className="text-sm text-gray-500">{record.customerEmail}</div>
        </div>
      ),
    },
    {
      title: '商品',
      dataIndex: 'productName',
      key: 'productName',
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number) => (
        <span className="font-medium text-green-600">¥{amount.toFixed(2)}</span>
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
      render: (_: any, record: Order) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<Eye className="w-4 h-4" />}
            onClick={() => showDetail(record)}
          >
            查看
          </Button>
          <PermissionGuard permission={Permission.ORDER_PROCESS}>
            {record.status === 'pending' && (
              <Button
                type="link"
                size="small"
                icon={<CheckCircle className="w-4 h-4" />}
                onClick={() => handleProcess(record.id)}
              >
                处理
              </Button>
            )}
            {(record.status === 'pending' || record.status === 'processing') && (
              <Button
                type="link"
                size="small"
                danger
                icon={<XCircle className="w-4 h-4" />}
                onClick={() => handleCancel(record.id)}
              >
                取消
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
          <h1 className="text-2xl font-bold text-gray-900">订单管理</h1>
          <p className="text-gray-600 mt-1">管理和处理所有订单</p>
        </div>
        <Space>
          <Select
            placeholder="筛选状态"
            style={{ width: 150 }}
            allowClear
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: 'pending', label: '待处理' },
              { value: 'processing', label: '处理中' },
              { value: 'completed', label: '已完成' },
              { value: 'cancelled', label: '已取消' },
              { value: 'disputed', label: '争议中' },
            ]}
          />
          <Button onClick={fetchOrders}>刷新</Button>
        </Space>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">总订单</div>
              <div className="text-2xl font-bold">{orders.length}</div>
            </div>
            <DollarSign className="w-8 h-8 text-blue-500" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">待处理</div>
              <div className="text-2xl font-bold text-orange-500">
                {orders.filter(o => o.status === 'pending').length}
              </div>
            </div>
            <Clock className="w-8 h-8 text-orange-500" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">处理中</div>
              <div className="text-2xl font-bold text-blue-500">
                {orders.filter(o => o.status === 'processing').length}
              </div>
            </div>
            <Clock className="w-8 h-8 text-blue-500" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">已完成</div>
              <div className="text-2xl font-bold text-green-500">
                {orders.filter(o => o.status === 'completed').length}
              </div>
            </div>
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
        </Card>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={orders}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showTotal: total => `共 ${total} 条`,
          }}
        />
      </Card>

      <Modal
        title="订单详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={600}
      >
        {selectedOrder && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="订单号">
              <code>{selectedOrder.orderNo}</code>
            </Descriptions.Item>
            <Descriptions.Item label="客户姓名">{selectedOrder.customerName}</Descriptions.Item>
            <Descriptions.Item label="客户邮箱">{selectedOrder.customerEmail}</Descriptions.Item>
            <Descriptions.Item label="商品名称">{selectedOrder.productName}</Descriptions.Item>
            <Descriptions.Item label="订单金额">
              <span className="text-lg font-bold text-green-600">
                ¥{selectedOrder.amount.toFixed(2)}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="订单状态">
              <Tag color={STATUS_COLORS[selectedOrder.status]}>
                {STATUS_LABELS[selectedOrder.status]}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(selectedOrder.createdAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {new Date(selectedOrder.updatedAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  )
}
