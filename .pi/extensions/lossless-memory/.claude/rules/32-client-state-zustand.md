---
paths: src/client/stores/**/*.ts
---

# Zustand 状态管理规范

## 📁 目录结构

```
src/client/stores/
├── todoStore.ts           # Todo 状态管理
├── chatWSStore.ts         # Chat WebSocket 状态管理
├── notificationStore.ts   # Notification 状态管理
└── __tests__/             # Store 测试
    └── todoStore.test.ts
```

## 🎯 Store 设计原则

### 1. 使用共享类型

```typescript
// ✅ 正确 - 使用共享类型
import type { Item, CreateItemInput } from '@shared/schemas'

interface ItemState {
  items: Item[]
  fetchItems: () => Promise<void>
  createItem: (input: CreateItemInput) => Promise<void>
}

// ❌ 错误 - 重复定义类型
interface ItemState {
  items: Array<{
    id: number
    name: string
  }>
}
```

**ESLint 规则**: `prefer-shared-types`

**路径**: `src/client/stores/**/*.ts`

### 2. Store 结构

```typescript
import { create } from 'zustand'
import { apiClient } from '@client/services/apiClient'
import type { Item, CreateItemInput } from '@shared/schemas'

interface ItemState {
  items: Item[]
  loading: boolean
  error: string | null

  fetchItems: () => Promise<void>
  createItem: (input: CreateItemInput) => Promise<void>
  clearError: () => void
}

export const useItemStore = create<ItemState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetchItems: async () => {
    set({ loading: true, error: null })
    try {
      const response = await apiClient.api.items.$get()
      const result = await response.json()
      if (result.success) {
        set({ items: result.data, loading: false })
      }
    } catch (error) {
      set({ error: 'Failed to fetch items', loading: false })
    }
  },

  createItem: async (input: CreateItemInput) => {
    try {
      const response = await apiClient.api.items.$post({ json: input })
      const result = await response.json()
      if (result.success) {
        set(state => ({ items: [...state.items, result.data] }))
      }
    } catch (error) {
      set({ error: 'Failed to create item' })
    }
  },

  clearError: () => set({ error: null }),
}))
```

## 🔌 WebSocket Store 集成

### WebSocket 状态管理

```typescript
import { create } from 'zustand'
import { apiClient } from '@client/services/apiClient'
import type { WSClient, WSStatus, ChatProtocol } from '@shared/schemas'

interface WSMessage {
  type: string
  payload: unknown
  timestamp?: number
}

interface WSState {
  status: WSStatus
  messages: WSMessage[]

  connect: () => void
  disconnect: () => void
  echo: (params: { message: string }) => Promise<void>
  clearMessages: () => void
}

let wsClient: WSClient<ChatProtocol> | null = null

export const useChatWsStore = create<WSState>((set, get) => ({
  status: 'closed',
  messages: [],

  connect: () => {
    if (wsClient) return

    wsClient = apiClient.api.chat.ws.$ws()

    if (!wsClient) return

    wsClient.onStatusChange((newStatus: WSStatus) => {
      set({ status: newStatus })
    })

    wsClient.on('notification', payload => {
      set(state => ({
        messages: [...state.messages, { type: 'notification', payload }],
      }))
    })
  },

  disconnect: () => {
    if (wsClient) {
      wsClient.close()
      wsClient = null
      set({ status: 'closed' })
    }
  },

  echo: async params => {
    if (!wsClient || get().status !== 'open') return
    try {
      await wsClient.call('echo', params)
    } catch (error) {
      console.error('Echo failed:', error)
    }
  },

  clearMessages: () => {
    set({ messages: [] })
  },
}))
```

## 🎣 组件中使用 Store

### 选择性订阅

```typescript
// ✅ 正确 - 选择性订阅
export const ItemList: React.FC = () => {
  const items = useItemStore(state => state.items)
  const loading = useItemStore(state => state.loading)
  const fetchItems = useItemStore(state => state.fetchItems)

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  if (loading) return <div>Loading...</div>

  return (
    <div>
      {items.map(item => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  )
}

// ❌ 错误 - 订阅整个 Store
export const ItemList: React.FC = () => {
  const { items, loading, fetchItems } = useItemStore()  // ❌ 任何状态变化都会重渲染

  // ...
}
```

## 🧪 测试规范

### Store 测试

```typescript
// src/client/stores/__tests__/itemStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useItemStore } from '../itemStore'

describe('itemStore', () => {
  beforeEach(() => {
    useItemStore.setState({ items: [], loading: false, error: null })
  })

  it('should have initial state', () => {
    const state = useItemStore.getState()
    expect(state.items).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('should fetch items', async () => {
    const { fetchItems } = useItemStore.getState()
    await fetchItems()

    const state = useItemStore.getState()
    expect(state.items.length).toBeGreaterThan(0)
  })
})
```

## 🚫 禁止事项

### 1. 禁止直接调用 API

```typescript
// ❌ 错误 - 直接使用 fetch
fetch('/api/items')
  .then(res => res.json())
  .then(data => set({ items: data }))

// ✅ 正确 - 使用 apiClient
const response = await apiClient.api.items.$get()
const result = await response.json()
if (result.success) {
  set({ items: result.data })
}
```

### 2. 禁止使用 any 类型

```typescript
// ❌ 错误 - 使用 any
interface State {
  items: any[]
  createItem: (input: any) => Promise<void>
}

// ✅ 正确 - 使用明确类型
interface State {
  items: Item[]
  createItem: (input: CreateItemInput) => Promise<void>
}
```

### 3. 禁止在 Store 中定义组件

```typescript
// ❌ 错误 - 在 Store 中定义组件
export const useItemStore = create((set) => ({
  ItemComponent: () => <div>...</div>,  // ❌
}))

// ✅ 正确 - Store 只管理状态
export const useItemStore = create((set) => ({
  items: [],
  fetchItems: async () => { ... },
}))
```

## 📤 导出规范

```typescript
// ✅ 正确 - 命名导出
export const useItemStore = create<ItemState>((set, get) => ({ ... }))

// ❌ 错误 - 默认导出
export default create<ItemState>((set, get) => ({ ... }))
```

## 🚫 Anti-Patterns

```typescript
// ❌ 不要订阅整个 Store
const { items, loading, fetchItems } = useItemStore()

// ✅ 应该选择性订阅
const items = useItemStore(state => state.items)
const loading = useItemStore(state => state.loading)
const fetchItems = useItemStore(state => state.fetchItems)

// ❌ 不要在 Store 中直接使用 fetch
fetch('/api/items')

// ✅ 应该使用 apiClient
const response = await apiClient.api.items.$get()

// ❌ 不要使用 any 类型
interface State {
  items: any[]
}

// ✅ 应该使用明确类型
interface State {
  items: Item[]
}
```

## 📚 相关文档

- [Client Service 规范](./31-client-services.md) - API 客户端使用规范
- [Client 组件规范](./30-client-components.md) - 组件开发规范
- [Testing 规范](./60-testing-standards.md) - 测试编写规范
