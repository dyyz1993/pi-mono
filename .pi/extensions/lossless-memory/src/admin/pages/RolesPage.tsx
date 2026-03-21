import React, { useEffect, useState } from 'react'
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Switch,
  message,
  Popconfirm,
  Space,
  Tag,
  Tabs,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  KeyOutlined,
  CodeOutlined,
  ApartmentOutlined,
} from '@ant-design/icons'
import { useRoleStore } from '../hooks/useRoles'
import { useConfig, usePermissionCategories } from '../hooks/useConfig'
import { usePermissions } from '../hooks/usePermissions'
import type { RoleType } from '@shared/modules/role/schemas'
import { PermissionConfigEditor } from '../components/PermissionConfigEditor'
import { PermissionTree } from '../components/PermissionTree'
import { apiClient } from '../services/apiClient'
import { validatePermissionDependencies } from '@shared/modules/permission/permission-dependencies'

export const RolesPage: React.FC = () => {
  const { roles, loading, fetchRoles, createRole, updateRole, deleteRole, updateRolePermissions } =
    useRoleStore()
  const { permissions } = useConfig()
  const { categories } = usePermissionCategories()
  const { refreshPermissions } = usePermissions()
  const [modalVisible, setModalVisible] = useState(false)
  const [permissionModalVisible, setPermissionModalVisible] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleType | null>(null)
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [form] = Form.useForm()

  useEffect(() => {
    fetchRoles()
  }, [fetchRoles])

  const handleCreate = () => {
    setEditingRole(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (role: RoleType) => {
    setEditingRole(role)
    form.setFieldsValue(role)
    setModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    const success = await deleteRole(id)
    if (success) {
      message.success('角色删除成功')
    }
  }

  const handleManagePermissions = async (role: RoleType) => {
    setEditingRole(role)

    try {
      const response = await apiClient.api.roles[':id'].$get({
        param: { id: role.id },
      })
      const data = await response.json()

      if (data.success && data.data.permissions) {
        setSelectedPermissions(data.data.permissions)
      } else {
        setSelectedPermissions([])
      }
    } catch (error) {
      console.error('Failed to fetch role permissions:', error)
      setSelectedPermissions([])
    }

    setPermissionModalVisible(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (editingRole) {
        const success = await updateRole(editingRole.id, values)
        if (success) {
          message.success('角色更新成功')
          setModalVisible(false)
        }
      } else {
        const success = await createRole(values)
        if (success) {
          message.success('角色创建成功')
          setModalVisible(false)
        }
      }
    } catch (error) {
      console.error('Form validation failed:', error)
    }
  }

  const handlePermissionSubmit = async () => {
    if (!editingRole) return

    const validation = validatePermissionDependencies(selectedPermissions)
    if (!validation.valid) {
      Modal.error({
        title: '权限依赖校验失败',
        content: (
          <div>
            <p>以下权限配置存在问题：</p>
            <ul>
              {validation.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        ),
      })
      return
    }

    const success = await updateRolePermissions(editingRole.id, selectedPermissions)
    if (success) {
      message.success('权限更新成功')
      setPermissionModalVisible(false)
      await refreshPermissions()
    }
  }

  const columns = [
    {
      title: '角色代码',
      dataIndex: 'code',
      key: 'code',
    },
    {
      title: '角色名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '显示名称',
      dataIndex: 'label',
      key: 'label',
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: '系统角色',
      dataIndex: 'isSystem',
      key: 'isSystem',
      render: (isSystem: boolean) => (
        <Tag color={isSystem ? 'blue' : 'default'}>{isSystem ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'red'}>{isActive ? '启用' : '禁用'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: RoleType) => (
        <Space>
          {record.code !== 'super_admin' && (
            <Button
              type="link"
              icon={<KeyOutlined />}
              onClick={() => handleManagePermissions(record)}
            >
              权限
            </Button>
          )}
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          {!record.isSystem && (
            <Popconfirm
              title="确定要删除这个角色吗？"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
        <h1>角色管理</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          创建角色
        </Button>
      </div>

      <Table columns={columns} dataSource={roles} rowKey="id" loading={loading} />

      <Modal
        title={editingRole ? '编辑角色' : '创建角色'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        okText="确定"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="角色代码"
            rules={[{ required: true, message: '请输入角色代码' }]}
          >
            <Input disabled={!!editingRole} placeholder="请输入角色代码，如：manager" />
          </Form.Item>

          <Form.Item
            name="name"
            label="角色名称"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="请输入角色名称" />
          </Form.Item>

          <Form.Item
            name="label"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="请输入显示名称" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="请输入角色描述" />
          </Form.Item>

          {editingRole && (
            <Form.Item name="isActive" label="状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title={`管理角色权限 - ${editingRole?.label || ''}`}
        open={permissionModalVisible}
        onOk={handlePermissionSubmit}
        onCancel={() => setPermissionModalVisible(false)}
        width={900}
        okText="保存"
        cancelText="取消"
      >
        <Tabs
          defaultActiveKey="tree"
          items={[
            {
              key: 'tree',
              label: (
                <span>
                  <ApartmentOutlined />
                  树状选择
                </span>
              ),
              children: (
                <PermissionTree
                  permissions={permissions}
                  categories={categories}
                  selectedPermissions={selectedPermissions}
                  onSelectionChange={setSelectedPermissions}
                />
              ),
            },
            {
              key: 'json',
              label: (
                <span>
                  <CodeOutlined />
                  JSON编辑
                </span>
              ),
              children: (
                <PermissionConfigEditor
                  visible={true}
                  title=""
                  permissions={permissions}
                  selectedPermissions={selectedPermissions}
                  onCancel={() => {}}
                  onOk={setSelectedPermissions}
                />
              ),
            },
          ]}
        />
      </Modal>
    </div>
  )
}
