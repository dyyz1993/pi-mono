import React, { useState, useMemo } from 'react'
import { Tree, Card, Tag, Input, Space, Button, Tooltip } from 'antd'
import { SearchOutlined, InfoCircleOutlined } from '@ant-design/icons'
import type { PermissionInfo, PermissionCategory } from '@shared/modules/permission'
import type { DataNode } from 'antd/es/tree'
import {
  PERMISSION_DEPENDENCIES,
  getRequiredPermissions,
} from '@shared/modules/permission/permission-dependencies'

interface PermissionTreeProps {
  permissions: PermissionInfo[]
  categories: Record<string, PermissionCategory>
  selectedPermissions: string[]
  onSelectionChange: (permissions: string[]) => void
}

export const PermissionTree: React.FC<PermissionTreeProps> = ({
  permissions,
  categories,
  selectedPermissions,
  onSelectionChange,
}) => {
  const [searchText, setSearchText] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

  const treeData = useMemo(() => {
    const categoryMap = new Map<string, PermissionInfo[]>()

    permissions.forEach(permission => {
      const category = permission.category
      if (!categoryMap.has(category)) {
        categoryMap.set(category, [])
      }
      categoryMap.get(category)!.push(permission)
    })

    return Array.from(categoryMap.entries()).map(([category, perms]) => ({
      key: category,
      title: (
        <span>
          <Tag color="blue">{categories[category]?.label || category}</Tag>
          <span style={{ marginLeft: '8px' }}>
            {perms.filter(p => selectedPermissions.includes(p.permission)).length} / {perms.length}
          </span>
        </span>
      ),
      children: perms.map(perm => ({
        key: perm.permission,
        title: (
          <span>
            <Tag color={selectedPermissions.includes(perm.permission) ? 'green' : 'default'}>
              {perm.label}
            </Tag>
            <span style={{ marginLeft: '8px', color: '#666', fontSize: '12px' }}>
              {perm.permission}
            </span>
            {PERMISSION_DEPENDENCIES[perm.permission] && (
              <Tooltip title={`需要权限: ${PERMISSION_DEPENDENCIES[perm.permission].join(', ')}`}>
                <InfoCircleOutlined style={{ marginLeft: '4px', color: '#1890ff' }} />
              </Tooltip>
            )}
          </span>
        ),
      })),
    }))
  }, [permissions, categories, selectedPermissions])

  const filteredTreeData = useMemo(() => {
    if (!searchText) return treeData

    return treeData
      .map(category => {
        const filteredChildren = category.children?.filter(child => {
          const permission = permissions.find(p => p.permission === child.key)
          return (
            permission?.permission.toLowerCase().includes(searchText.toLowerCase()) ||
            permission?.label.toLowerCase().includes(searchText.toLowerCase())
          )
        })

        if (filteredChildren && filteredChildren.length > 0) {
          return {
            ...category,
            children: filteredChildren,
          }
        }

        return null
      })
      .filter(Boolean)
  }, [treeData, searchText, permissions])

  const handleCheck = (
    checked: React.Key[] | { checked: React.Key[]; halfChecked: React.Key[] }
  ) => {
    const checkedKeys = Array.isArray(checked) ? checked : checked.checked
    const newCheckedPermissions = checkedKeys.filter(key =>
      permissions.some(p => p.permission === key)
    ) as string[]

    const oldCheckedPermissions = selectedPermissions
    const addedPermissions = newCheckedPermissions.filter(p => !oldCheckedPermissions.includes(p))
    const removedPermissions = oldCheckedPermissions.filter(p => !newCheckedPermissions.includes(p))

    let finalPermissions = [...newCheckedPermissions]

    for (const permission of addedPermissions) {
      const required = getRequiredPermissions(permission)
      for (const req of required) {
        if (!finalPermissions.includes(req)) {
          finalPermissions.push(req)
        }
      }
    }

    for (const permission of removedPermissions) {
      const dependentPermissions = Object.entries(PERMISSION_DEPENDENCIES)
        .filter(([_, deps]) => deps.includes(permission))
        .map(([perm]) => perm)

      for (const dep of dependentPermissions) {
        finalPermissions = finalPermissions.filter(p => p !== dep)
      }
    }

    finalPermissions = [...new Set(finalPermissions)]
    onSelectionChange(finalPermissions)
  }

  const handleSelectAll = () => {
    onSelectionChange(permissions.map(p => p.permission))
  }

  const handleClearAll = () => {
    onSelectionChange([])
  }

  const handleExpandAll = () => {
    setExpandedKeys(Object.keys(categories))
  }

  const handleCollapseAll = () => {
    setExpandedKeys([])
  }

  const handleExpand = (keys: React.Key[]) => {
    setExpandedKeys(keys as string[])
  }

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%', marginBottom: '16px' }}>
        <Input
          placeholder="搜索权限..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          allowClear
        />

        <Space>
          <Button size="small" onClick={handleSelectAll}>
            全选
          </Button>
          <Button size="small" onClick={handleClearAll}>
            清空
          </Button>
          <Button size="small" onClick={handleExpandAll}>
            展开全部
          </Button>
          <Button size="small" onClick={handleCollapseAll}>
            收起全部
          </Button>
        </Space>
      </Space>

      <Tree
        checkable
        checkedKeys={selectedPermissions}
        expandedKeys={expandedKeys}
        onExpand={handleExpand}
        onCheck={handleCheck}
        treeData={filteredTreeData.filter(Boolean) as DataNode[]}
        style={{ marginTop: '16px' }}
      />

      <div style={{ marginTop: '16px', color: '#666' }}>
        已选择 <Tag color="green">{selectedPermissions.length}</Tag> 个权限
      </div>
    </Card>
  )
}
