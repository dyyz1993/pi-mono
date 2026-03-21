---
paths: src/client/components/**/*.tsx
---

# Client 组件开发规范

## 📁 目录结构

```
src/client/components/
├── ConnectionStatus.tsx     # 连接状态组件
├── MessageCard.tsx          # 消息卡片组件
├── LoadingSpinner.tsx       # 加载动画组件
├── EmptyState.tsx           # 空状态组件
├── StatusBadge.tsx          # 状态徽章组件
└── __tests__/               # 组件测试
    ├── ConnectionStatus.test.tsx
    ├── MessageCard.test.tsx
    └── ...
```

## 🎯 组件设计原则

### 1. Props 接口定义

```typescript
// ✅ 正确 - 明确定义 Props 接口
interface ButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  className?: string
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onClick,
  disabled = false,
  variant = 'primary',
  className = '',
}) => {
  // 组件实现
}

// ❌ 错误 - 使用 any 或缺少类型定义
export const Button = ({ label, onClick, ...props }: any) => {
  // ...
}
```

### 2. 使用共享类型

```typescript
// ✅ 正确 - 使用共享类型
import type { Item, ItemStatus } from '@shared/schemas'

interface ItemCardProps {
  item: Item
  onStatusChange: (status: ItemStatus) => void
}

// ❌ 错误 - 重复定义类型
interface ItemCardProps {
  item: {
    id: number
    name: string
    status: 'active' | 'inactive' // ❌ 应使用 ItemStatus
  }
}
```

**ESLint 规则**: `prefer-shared-types`

**路径**: `src/client/components/**/*.tsx`

## 🎨 样式规范

### 使用 Tailwind CSS

```typescript
// ✅ 正确 - 使用 Tailwind CSS
export const Card: React.FC<CardProps> = ({ title, children, className = '' }) => {
  return (
    <div className={`p-4 bg-white rounded-lg shadow-sm border border-gray-200 ${className}`}>
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      {children}
    </div>
  )
}

// ❌ 错误 - 使用内联样式
export const Card = ({ title, children }) => {
  return (
    <div style={{ padding: '16px', backgroundColor: 'white' }}>
      <h3 style={{ fontSize: '18px' }}>{title}</h3>
      {children}
    </div>
  )
}
```

### 条件样式处理

```typescript
// ✅ 正确 - 使用条件样式
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const statusColors = {
    active: 'bg-green-500 text-white',
    inactive: 'bg-gray-300 text-gray-700',
    error: 'bg-red-500 text-white',
  }

  return (
    <span className={`px-2 py-1 rounded text-sm ${statusColors[status]}`}>
      {status}
    </span>
  )
}
```

## 🧪 测试规范

### 测试文件位置

测试文件**必须**放在 `__tests__` 目录。

```typescript
// ✅ 正确 - 测试文件位置
// src/client/components/__tests__/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '../Button'

describe('Button', () => {
  it('should render with label', () => {
    render(<Button label="Click me" onClick={() => {}} />)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })
})
```

### 测试 ID 规范

```typescript
// ✅ 正确 - 使用 data-testid
export const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
  return (
    <button
      onClick={onClick}
      data-testid="button"
    >
      {label}
    </button>
  )
}

// 测试中使用
expect(screen.getByTestId('button')).toBeInTheDocument()
```

## 🔗 组件通信规范

### Props 向下传递

```typescript
// ✅ 正确 - Props 向下传递
interface ParentProps {
  items: Item[]
  onItemClick: (id: number) => void
}

export const Parent: React.FC<ParentProps> = ({ items, onItemClick }) => {
  return (
    <div>
      {items.map(item => (
        <ItemCard key={item.id} item={item} onClick={() => onItemClick(item.id)} />
      ))}
    </div>
  )
}
```

### 使用 Store 进行状态管理

```typescript
// ✅ 正确 - 使用 Zustand Store
import { useItemStore } from '@client/stores/itemStore'

export const ItemList: React.FC = () => {
  const items = useItemStore(state => state.items)
  const fetchItems = useItemStore(state => state.fetchItems)

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  return (
    <div>
      {items.map(item => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  )
}
```

## 🚫 禁止事项

### 1. 禁止直接调用 API

```typescript
// ❌ 错误 - 组件中直接调用 API
export const ItemList: React.FC = () => {
  const [items, setItems] = useState([])

  useEffect(() => {
    fetch('/api/items')  // ❌ 应使用 apiClient 或 Store
      .then(res => res.json())
      .then(data => setItems(data))
  }, [])

  return <div>...</div>
}

// ✅ 正确 - 使用 Store
export const ItemList: React.FC = () => {
  const items = useItemStore(state => state.items)
  const fetchItems = useItemStore(state => state.fetchItems)

  useEffect(() => {
    fetchItems()  // ✅
  }, [fetchItems])

  return <div>...</div>
}
```

### 2. 禁止使用 any 类型

```typescript
// ❌ 错误 - 使用 any
interface Props {
  data: any
  onChange: (value: any) => void
}

// ✅ 正确 - 使用明确类型
interface Props {
  data: Item
  onChange: (value: Item) => void
}
```

### 3. 禁止内联对象作为 Props

```typescript
// ❌ 错误 - 内联对象会导致不必要的重渲染
<ItemCard item={{ id: 1, name: 'Item' }} />

// ✅ 正确 - 使用稳定的引用
const item = useMemo(() => ({ id: 1, name: 'Item' }), [])
<ItemCard item={item} />
```

## 📤 导出规范

### 组件导出

```typescript
// ✅ 正确 - 命名导出
export const Button: React.FC<ButtonProps> = ({ ... }) => { ... }

// ❌ 错误 - 默认导出
export default function Button({ ... }) { ... }
```

### 统一导出

```typescript
// src/client/components/index.ts
export { Button } from './Button'
export { Card } from './Card'
export { StatusBadge } from './StatusBadge'
```

## 🚫 Anti-Patterns

```typescript
// ❌ 不要在组件中直接使用 fetch
fetch('/api/items')

// ✅ 应该使用 apiClient 或 Store
import { apiClient } from '@client/services/apiClient'
const response = await apiClient.api.items.$get()

// ❌ 不要使用 any 类型
const handleClick = (data: any) => { ... }

// ✅ 应该使用明确类型
const handleClick = (data: Item) => { ... }

// ❌ 不要在渲染函数中创建对象
return <ItemCard item={{ id: 1, name: 'Item' }} />

// ✅ 应该使用稳定的引用
const item = useMemo(() => ({ id: 1, name: 'Item' }), [])
return <ItemCard item={item} />
```

## 📚 相关文档

- [Client Service 规范](./31-client-services.md) - API 客户端使用规范
- [Zustand 规范](./32-client-state-zustand.md) - 状态管理规范
- [Testing 规范](./60-testing-standards.md) - 测试编写规范
