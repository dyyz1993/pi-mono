import React, { useState, useEffect } from 'react'
import { Tabs, Input, Button, message, Space, Alert } from 'antd'
import { CodeOutlined, SaveOutlined, FormatPainterOutlined } from '@ant-design/icons'
import type { PermissionInfo } from '@shared/modules/permission'

interface PermissionConfigEditorProps {
  visible: boolean
  title: string
  permissions: PermissionInfo[]
  selectedPermissions: string[]
  onCancel: () => void
  onOk: (permissions: string[]) => void
}

export const PermissionConfigEditor: React.FC<PermissionConfigEditorProps> = ({
  visible,
  permissions,
  selectedPermissions,
  onOk,
}) => {
  const [jsonValue, setJsonValue] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  useEffect(() => {
    if (visible) {
      setJsonValue(JSON.stringify(selectedPermissions, null, 2))
      setJsonError(null)
    }
  }, [visible, selectedPermissions])

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonValue)
      setJsonValue(JSON.stringify(parsed, null, 2))
      setJsonError(null)
      message.success('JSON格式化成功')
    } catch (error) {
      setJsonError(`JSON格式错误: ${(error as Error).message}`)
      message.error('JSON格式错误')
    }
  }

  const handleValidate = () => {
    try {
      const parsed = JSON.parse(jsonValue)

      if (!Array.isArray(parsed)) {
        setJsonError('配置必须是数组格式')
        return false
      }

      const validPermissions = permissions.map(p => p.permission)
      const invalidPermissions = parsed.filter(p => !validPermissions.includes(p))

      if (invalidPermissions.length > 0) {
        setJsonError(`无效的权限: ${invalidPermissions.join(', ')}`)
        return false
      }

      setJsonError(null)
      return true
    } catch (error) {
      setJsonError(`JSON格式错误: ${(error as Error).message}`)
      return false
    }
  }

  const handleOk = () => {
    if (!handleValidate()) {
      message.error('请修复JSON错误后再保存')
      return
    }

    try {
      const parsed = JSON.parse(jsonValue)
      onOk(parsed)
    } catch {
      message.error('保存失败')
    }
  }

  const handleLoadTemplate = (template: string[]) => {
    setJsonValue(JSON.stringify(template, null, 2))
    setJsonError(null)
    message.success('模板加载成功')
  }

  const templates = [
    {
      name: '超级管理员',
      permissions: permissions.map(p => p.permission),
    },
    {
      name: '客服人员',
      permissions: [
        'user:view',
        'content:view',
        'order:view',
        'order:process',
        'ticket:view',
        'ticket:reply',
        'ticket:close',
        'data:export',
        'system:logs',
      ],
    },
    {
      name: '普通用户',
      permissions: ['content:view', 'order:view'],
    },
    {
      name: '内容管理员',
      permissions: ['content:view', 'content:create', 'content:edit', 'content:delete'],
    },
    {
      name: '订单管理员',
      permissions: ['order:view', 'order:process', 'data:export'],
    },
  ]

  if (!visible) return null

  return (
    <div>
      <Tabs
        defaultActiveKey="json"
        items={[
          {
            key: 'json',
            label: (
              <span>
                <CodeOutlined />
                JSON编辑器
              </span>
            ),
            children: (
              <div>
                <Alert
                  message="JSON格式说明"
                  description='请输入权限代码数组，例如：["user:view", "user:create"]'
                  type="info"
                  showIcon
                  style={{ marginBottom: '16px' }}
                />

                <Input.TextArea
                  value={jsonValue}
                  onChange={e => {
                    setJsonValue(e.target.value)
                    setJsonError(null)
                  }}
                  placeholder='["permission1", "permission2"]'
                  rows={15}
                  style={{ fontFamily: 'monospace' }}
                />

                {jsonError && (
                  <Alert message={jsonError} type="error" showIcon style={{ marginTop: '16px' }} />
                )}

                <Space style={{ marginTop: '16px' }}>
                  <Button icon={<FormatPainterOutlined />} onClick={handleFormatJson}>
                    格式化
                  </Button>
                  <Button type="primary" icon={<SaveOutlined />} onClick={handleOk}>
                    保存
                  </Button>
                </Space>
              </div>
            ),
          },
          {
            key: 'templates',
            label: '权限模板',
            children: (
              <div>
                <Alert
                  message="选择预设模板快速配置权限"
                  description="点击模板按钮将替换当前配置"
                  type="info"
                  showIcon
                  style={{ marginBottom: '16px' }}
                />

                <Space direction="vertical" style={{ width: '100%' }}>
                  {templates.map(template => (
                    <Button
                      key={template.name}
                      block
                      onClick={() => handleLoadTemplate(template.permissions)}
                      style={{ textAlign: 'left', height: 'auto', padding: '12px' }}
                    >
                      <div style={{ fontWeight: 'bold' }}>{template.name}</div>
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        {template.permissions.length} 个权限:{' '}
                        {template.permissions.slice(0, 5).join(', ')}
                        {template.permissions.length > 5 && '...'}
                      </div>
                    </Button>
                  ))}
                </Space>
              </div>
            ),
          },
          {
            key: 'help',
            label: '帮助',
            children: (
              <div>
                <h3>权限配置说明</h3>

                <h4>可用权限列表：</h4>
                <ul>
                  {permissions.map(permission => (
                    <li key={permission.permission}>
                      <code>{permission.permission}</code> - {permission.label}
                    </li>
                  ))}
                </ul>

                <h4>配置示例：</h4>
                <pre style={{ background: '#f5f5f5', padding: '12px', borderRadius: '4px' }}>
                  {`[
  "user:view",
  "user:create",
  "user:edit",
  "content:view"
]`}
                </pre>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
