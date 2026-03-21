---
paths: src/**/*.test.ts, src/**/*.test.tsx, src/**/__tests__/**/*.ts, src/**/__tests__/**/*.tsx, e2e/**/*.spec.ts
---

# Testing 开发规范

## 📁 测试文件组织

### 测试文件位置

| 测试类型 | 位置                                         | 示例                                                  |
| -------- | -------------------------------------------- | ----------------------------------------------------- |
| 单元测试 | `src/**/__tests__/*.test.ts`                 | `src/client/stores/__tests__/todoStore.test.ts`       |
| 组件测试 | `src/**/__tests__/*.test.tsx`                | `src/client/components/__tests__/Navigation.test.tsx` |
| 集成测试 | `src/server/__tests__/integration/*.test.ts` | `src/server/__tests__/integration/todos-api.test.ts`  |
| E2E 测试 | `e2e/*.spec.ts`                              | `e2e/app.spec.ts`                                     |

**ESLint 规则**: `e2e-test-location`

**路径**: `e2e/**/*.spec.ts`

## 🧪 类型安全测试客户端

### 强制使用 createTestClient

所有路由/RPC 测试**必须**使用 `createTestClient()` 获取类型安全的客户端。

```typescript
// ✅ 正确 - 使用类型安全客户端
import { createTestClient } from '@server/test-utils/test-client'

describe('API Tests', () => {
  it('should fetch items', async () => {
    const client = createTestClient()
    const response = await client.api.items.$get()
    const result = await response.json()

    expect(result.success).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
  })
})

// ❌ 错误 - 使用非类型安全方式
const response = await fetch('/api/items')
const response = await app.fetch(new Request('/api/items'))
const response = await app.request('/api/items')
const client = hc<AppType>(baseUrl)
```

**ESLint 规则**: `require-type-safe-test-client`

**路径**: `src/server/**/*.test.ts`

### 禁止禁用类型安全客户端

```typescript
// ❌ 禁止 - 禁用类型安全客户端检查
// eslint-disable-next-line require-type-safe-test-client
const response = await fetch('/api/items')

// ❌ 禁止 - 使用 @ts-ignore 绕过类型检查
// @ts-ignore
const response = await app.request('/api/items')
```

**ESLint 规则**: `no-disable-type-safe-client`

**路径**: `src/server/**/*.test.ts`

## 🧪 测试框架

### Vitest 配置

项目使用 **Vitest** 作为测试框架。

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
```

### 测试编写规范

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('ItemService', () => {
  beforeEach(async () => {
    // 清理测试数据
  })

  it('should create item', async () => {
    // Arrange
    const input = { name: 'Test Item' }

    // Act
    const result = await createItem(input)

    // Assert
    expect(result.id).toBeDefined()
    expect(result.name).toBe('Test Item')
  })
})
```

## 🔧 测试工具

### createTestClient 实现

```typescript
// src/server/test-utils/test-client.ts
import { hc } from 'hono/client'
import type { AppType } from '@server/index'
import { createApp } from '@server/app'

export function createTestClient(baseUrl?: string): TestClient {
  const app = createApp()
  if (baseUrl) {
    return hc<AppType>(baseUrl)
  }
  return hc<AppType>('http://localhost', {
    fetch: (input, init?) => app.fetch(new Request(input, init)),
  })
}
```

### 测试数据库

```typescript
// src/server/db/test-setup.ts
export async function cleanupTestDatabase() {
  // 清理测试数据
}

export async function seedTestDatabase() {
  // 填充测试数据
}
```

## 🎯 测试覆盖目标

| 类型     | 覆盖率目标    |
| -------- | ------------- |
| 单元测试 | >80%          |
| 集成测试 | 关键路径 100% |
| E2E 测试 | 核心用户流程  |

## 🚫 禁止事项

### 1. 禁止使用非类型安全方式

```typescript
// ❌ 错误 - 使用 fetch
const response = await fetch('/api/items')

// ❌ 错误 - 使用 app.fetch
const response = await app.fetch(new Request('/api/items'))

// ❌ 错误 - 使用 app.request
const response = await app.request('/api/items')

// ❌ 错误 - 使用 hc 创建客户端
const client = hc<AppType>(baseUrl)

// ✅ 正确 - 使用 createTestClient
const client = createTestClient()
const response = await client.api.items.$get()
```

### 2. 禁止跳过测试

```typescript
// ❌ 禁止 - 跳过测试
it.skip('should work', () => { ... })

// ❌ 禁止 - 只运行特定测试
it.only('should work', () => { ... })

// ✅ 正确 - 修复或删除测试
it('should work', () => { ... })
```

### 3. 禁止使用 any 类型

```typescript
// ❌ 错误 - 使用 any
const result: any = await response.json()

// ✅ 正确 - 使用类型守卫
const result = await response.json()
if (result.success) {
  expect(result.data).toBeDefined()
}
```

## 📤 测试文件命名

| 类型     | 命名规则     | 示例                |
| -------- | ------------ | ------------------- |
| 单元测试 | `*.test.ts`  | `todoStore.test.ts` |
| 组件测试 | `*.test.tsx` | `Button.test.tsx`   |
| 集成测试 | `*.test.ts`  | `api.test.ts`       |
| E2E 测试 | `*.spec.ts`  | `app.spec.ts`       |

## 🚫 Anti-Patterns

```typescript
// ❌ 不要使用 fetch
const response = await fetch('/api/items')

// ✅ 应该使用 createTestClient
const client = createTestClient()
const response = await client.api.items.$get()

// ❌ 不要跳过测试
it.skip('should work', () => { ... })

// ✅ 应该修复或删除测试
it('should work', () => { ... })

// ❌ 不要使用 any 类型
const result: any = await response.json()

// ✅ 应该使用类型守卫
const result = await response.json()
if (result.success) {
  expect(result.data).toBeDefined()
}
```

## 📚 相关文档

- [Hono Testing 最佳实践](./61-hono-testing.md) - Hono 测试详细指南
- [Server API 规范](./20-server-api.md) - 服务端开发规范
- [API 类型推导规范](./10-api-type-inference.md) - Hono RPC 类型推导
