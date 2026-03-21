import React, { useEffect, useState } from 'react'
import { Table, Card, Input, Select, Space, Tag, Button, Descriptions, Modal } from 'antd'
import { SearchOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { useAuditLogStore } from '../hooks/useAuditLogs'
import type { AuditLogType } from '@shared/modules/audit'

const { Option } = Select

const ACTION_COLORS: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  assign: 'cyan',
  revoke: 'orange',
}

const ACTION_LABELS: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  assign: '分配',
  revoke: '撤销',
}

const RESOURCE_LABELS: Record<string, string> = {
  role: '角色',
  permission: '权限',
  user: '用户',
  route: '路由',
}

export const SystemLogsPage: React.FC = () => {
  const { logs, loading, fetchLogs } = useAuditLogStore()
  const [selectedLog, setSelectedLog] = useState<AuditLogType | null>(null)
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [filters, setFilters] = useState({
    userId: '',
    action: '',
    resourceType: '',
  })

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleSearch = () => {
    fetchLogs(filters)
  }

  const handleReset = () => {
    setFilters({ userId: '', action: '', resourceType: '' })
    fetchLogs()
  }

  const handleViewDetail = (log: AuditLogType) => {
    setSelectedLog(log)
    setDetailModalVisible(true)
  }

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '用户ID',
      dataIndex: 'userId',
      key: 'userId',
      width: 120,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 100,
      render: (action: string) => (
        <Tag color={ACTION_COLORS[action] || 'default'}>{ACTION_LABELS[action] || action}</Tag>
      ),
    },
    {
      title: '资源类型',
      dataIndex: 'resourceType',
      key: 'resourceType',
      width: 120,
      render: (type: string) => RESOURCE_LABELS[type] || type,
    },
    {
      title: '资源ID',
      dataIndex: 'resourceId',
      key: 'resourceId',
      width: 150,
      render: (id: string | null) => id || '-',
    },
    {
      title: 'IP地址',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 140,
      render: (ip: string | null) => ip || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, record: AuditLogType) => (
        <Button type="link" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>
          详情
        </Button>
      ),
    },
  ]

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title="系统日志"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => fetchLogs()}>
            刷新
          </Button>
        }
      >
        <Space style={{ marginBottom: '16px' }} wrap>
          <Input
            placeholder="用户ID"
            value={filters.userId}
            onChange={e => setFilters({ ...filters, userId: e.target.value })}
            style={{ width: 150 }}
          />
          <Select
            placeholder="操作类型"
            value={filters.action || undefined}
            onChange={value => setFilters({ ...filters, action: value || '' })}
            style={{ width: 120 }}
            allowClear
          >
            <Option value="create">创建</Option>
            <Option value="update">更新</Option>
            <Option value="delete">删除</Option>
            <Option value="assign">分配</Option>
            <Option value="revoke">撤销</Option>
          </Select>
          <Select
            placeholder="资源类型"
            value={filters.resourceType || undefined}
            onChange={value => setFilters({ ...filters, resourceType: value || '' })}
            style={{ width: 120 }}
            allowClear
          >
            <Option value="role">角色</Option>
            <Option value="permission">权限</Option>
            <Option value="user">用户</Option>
            <Option value="route">路由</Option>
          </Select>
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
            搜索
          </Button>
          <Button onClick={handleReset}>重置</Button>
        </Space>

        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: total => `共 ${total} 条记录`,
          }}
        />
      </Card>

      <Modal
        title="日志详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={700}
      >
        {selectedLog && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="日志ID">{selectedLog.id}</Descriptions.Item>
            <Descriptions.Item label="用户ID">{selectedLog.userId}</Descriptions.Item>
            <Descriptions.Item label="操作">
              <Tag color={ACTION_COLORS[selectedLog.action] || 'default'}>
                {ACTION_LABELS[selectedLog.action] || selectedLog.action}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="资源类型">
              {RESOURCE_LABELS[selectedLog.resourceType] || selectedLog.resourceType}
            </Descriptions.Item>
            <Descriptions.Item label="资源ID">{selectedLog.resourceId || '-'}</Descriptions.Item>
            <Descriptions.Item label="IP地址">{selectedLog.ipAddress || '-'}</Descriptions.Item>
            <Descriptions.Item label="User Agent">{selectedLog.userAgent || '-'}</Descriptions.Item>
            <Descriptions.Item label="时间">
              {new Date(selectedLog.createdAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
            {selectedLog.oldValue && (
              <Descriptions.Item label="旧值">
                <pre style={{ margin: 0, maxHeight: '200px', overflow: 'auto' }}>
                  {JSON.stringify(JSON.parse(selectedLog.oldValue), null, 2)}
                </pre>
              </Descriptions.Item>
            )}
            {selectedLog.newValue && (
              <Descriptions.Item label="新值">
                <pre style={{ margin: 0, maxHeight: '200px', overflow: 'auto' }}>
                  {JSON.stringify(JSON.parse(selectedLog.newValue), null, 2)}
                </pre>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  )
}
