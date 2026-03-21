---
paths: src/shared/**/*.ts
---

# Shared Types 开发规范

## 🎯 Core Principle

`src/shared/` 目录包含前后端共享的类型定义和 Schema，分为**框架层**和**业务层**两部分。

## 📁 目录结构

```
src/shared/
├── core/                    # 框架层（不可修改）
│   ├── api-schemas.ts       # API 响应 Schema (ApiSuccess, ApiError)
│   ├── protocol-types.ts    # RPC 协议类型推导
│   ├── ws-client.ts         # WebSocket 客户端实现
│   ├── sse-client.ts        # SSE 客户端实现
│   └── index.ts             # 框架层统一导出
│
├── modules/                 # 业务层（可扩展）
│   ├── todos/
│   │   ├── schemas.ts       # Todo Zod Schema
│   │   └── index.ts         # Todo 类型导出
│   ├── notifications/
│   │   ├── schemas.ts       # Notification Zod Schema
│   │   └── index.ts
│   ├── chat/
│   │   └── index.ts         # Chat Protocol Schema
│   └── index.ts             # 业务层统一导出
│
└── schemas/
    └── index.ts             # 全局统一导出（供外部使用）
```

## 🏗️ 分层架构

### 框架层

**位置**: `src/shared/core/`

**职责**: 提供通用的基础设施，不感知具体业务。

**特点**:

- 带有 `@framework-baseline` 注释
- 修改需要特殊审批
- 提供类型推导工具

```typescript
// src/shared/core/api-schemas.ts
export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

export type ApiSuccess<T> = { success: true; data: T }
```

### 业务层

**位置**: `src/shared/modules/`

**职责**: 定义业务相关的 Schema 和类型。

**特点**:

- 按模块组织
- 使用 Zod 定义 Schema
- 自动导出 TypeScript 类型

```typescript
// src/shared/modules/todos/schemas.ts
import { z } from '@hono/zod-openapi'

export const TodoSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(200),
  status: z.enum(['pending', 'in_progress', 'completed']),
})

export type Todo = z.infer<typeof TodoSchema>
```

## 📦 Schema 定义规范

### 1. 使用 Zod 定义 Schema

```typescript
// ✅ 正确 - 使用 Zod
import { z } from '@hono/zod-openapi'

export const TodoSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  createdAt: z.string().datetime(),
})

// ❌ 错误 - 使用纯 TypeScript interface（无法用于验证）
export interface Todo {
  id: number
  title: string
  status: 'pending' | 'in_progress' | 'completed'
}
```

### 2. 导出 TypeScript 类型

```typescript
// ✅ 正确 - 使用 z.infer 自动推导类型
export type Todo = z.infer<typeof TodoSchema>
export type CreateTodoInput = z.infer<typeof CreateTodoSchema>

// ❌ 错误 - 手动定义类型（容易不一致）
export interface Todo {
  id: number
  title: string
  // ...
}
```

### 3. Schema 命名规范

| 类型        | 命名                        | 示例                                         |
| ----------- | --------------------------- | -------------------------------------------- |
| 实体 Schema | PascalCase + Schema         | `TodoSchema`, `NotificationSchema`           |
| 输入 Schema | Verb/Adjective + Schema     | `CreateTodoSchema`, `UpdateTodoSchema`       |
| 枚举 Schema | PascalCase + Schema         | `TodoStatusSchema`, `NotificationTypeSchema` |
| 协议 Schema | PascalCase + ProtocolSchema | `ChatProtocolSchema`, `AppSSEProtocolSchema` |
| 类型导出    | PascalCase                  | `Todo`, `CreateTodoInput`                    |

## 🔄 前端使用规范

### 1. 导入类型

```typescript
// src/client/stores/todoStore.ts
import type { Todo, CreateTodoInput, UpdateTodoInput } from '@shared/schemas'

interface TodoState {
  todos: Todo[]
  createTodo: (input: CreateTodoInput) => Promise<void>
}
```

### 2. 使用 Schema 进行验证

```typescript
// src/client/components/TodoForm.tsx
import { CreateTodoSchema } from '@shared/schemas'

const handleSubmit = (data: unknown) => {
  const result = CreateTodoSchema.safeParse(data)
  if (result.success) {
    // result.data 类型为 CreateTodoInput
    createTodo(result.data)
  } else {
    // 处理验证错误
    console.error(result.error.errors)
  }
}
```

### 3. 类型守卫

```typescript
// src/client/services/apiClient.ts
import type { ApiSuccess, ApiError } from '@shared/schemas'

export function isSuccess<T>(response: unknown): response is ApiSuccess<T> {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    (response as { success: boolean }).success === true &&
    'data' in response
  )
}
```

## 🖥️ 后端使用规范

### 1. 路由定义

```typescript
// src/server/module-todos/routes/todos-routes.ts
import { createRoute, z } from '@hono/zod-openapi'
import { TodoSchema, CreateTodoSchema } from '@shared/schemas'

const createRouteDef = createRoute({
  method: 'post',
  path: '/todos',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTodoSchema, // ✅ 使用 shared Schema
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: TodoSchema, // ✅ 使用 shared Schema
          }),
        },
      },
    },
  },
})
```

### 2. Service 层

```typescript
// src/server/module-todos/services/todo-service.ts
import type { Todo, CreateTodoInput } from '@shared/schemas'

export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  // 业务逻辑
}
```

### 3. 响应辅助函数

```typescript
// src/server/utils/route-helpers.ts
import { ApiSuccessSchema, ApiErrorSchema } from '@shared/schemas'

export function successResponse<T extends z.ZodTypeAny>(schema: T, description: string) {
  return {
    content: {
      'application/json': { schema: ApiSuccessSchema(schema) },
    },
    description,
  }
}
```

## 🔌 协议定义规范

### WebSocket 协议

```typescript
// src/shared/modules/chat/index.ts
import { z } from '@hono/zod-openapi'

export const ChatProtocolSchema = z.object({
  rpc: z.object({
    echo: z.object({
      in: z.object({ message: z.string() }),
      out: z.object({ message: z.string(), timestamp: z.number() }),
    }),
    ping: z.object({
      in: z.object({}),
      out: z.object({ pong: z.boolean(), timestamp: z.number() }),
    }),
  }),
  events: z.object({
    notification: z.object({
      title: z.string(),
      body: z.string(),
      timestamp: z.number(),
    }),
    connected: z.object({
      timestamp: z.number(),
    }),
  }),
})

export type ChatProtocol = z.infer<typeof ChatProtocolSchema>
```

### SSE 协议

```typescript
// src/shared/modules/notifications/schemas.ts
export const AppSSEProtocolSchema = z.object({
  events: z.object({
    notification: NotificationSchema,
    ping: z.object({ timestamp: z.number() }),
    connected: z.object({ timestamp: z.number() }),
  }),
})

export type AppSSEProtocol = z.infer<typeof AppSSEProtocolSchema>
```

## 📤 导出规范

### 1. 模块导出

```typescript
// src/shared/modules/todos/index.ts
export {
  TodoSchema,
  TodoStatusSchema,
  CreateTodoSchema,
  UpdateTodoSchema,
  type Todo,
  type TodoStatus,
  type CreateTodoInput,
  type UpdateTodoInput,
} from './schemas'
```

### 2. 全局导出

```typescript
// src/shared/schemas/index.ts
export { TodoSchema, type Todo, type CreateTodoInput } from '../modules/todos'

export { NotificationSchema, type AppNotification } from '../modules/notifications'

export { ChatProtocolSchema, type ChatProtocol } from '../modules/chat'
```

### 3. 使用方式

```typescript
// ✅ 推荐 - 从统一入口导入
import type { Todo, AppNotification } from '@shared/schemas'

// ⚠️ 允许 - 从模块导入
import type { Todo } from '@shared/modules/todos'

// ❌ 禁止 - 从相对路径导入
import type { Todo } from '../../shared/modules/todos/schemas'
```

## 🚫 禁止事项

### 1. 禁止导入客户端/服务端代码

```typescript
// ❌ 禁止 - 导入客户端代码
import { useTodoStore } from '@client/stores/todoStore'

// ❌ 禁止 - 导入服务端代码
import { createTodo } from '@server/module-todos/services/todo-service'

// ✅ 正确 - shared 只依赖外部库
import { z } from '@hono/zod-openapi'
```

### 2. 禁止包含运行时逻辑

```typescript
// ❌ 禁止 - 包含运行时逻辑
export function validateTodo(data: unknown) {
  return TodoSchema.parse(data)
}

// ✅ 正确 - 只导出 Schema 和类型
export const TodoSchema = z.object({ ... })
export type Todo = z.infer<typeof TodoSchema>
```

### 3. 禁止使用 React 类型

```typescript
// ❌ 禁止 - 使用 React 类型
export interface TodoProps {
  children: React.ReactNode
}

// ✅ 正确 - 使用标准类型
export interface Todo {
  id: number
  title: string
}
```

## 🔄 同步规则

### 修改 Schema 时

1. **修改 Schema 定义**
2. **类型自动更新** - TypeScript 编译器会提示类型错误
3. **更新前后端使用** - 修复所有类型错误

```bash
# 修改 Schema 后，运行类型检查
npm run typecheck

# 修复所有类型错误后提交
```

### 添加新模块时

1. **创建模块目录**: `src/shared/modules/{module}/`
2. **定义 Schema**: `schemas.ts`
3. **导出类型**: `index.ts`
4. **更新全局导出**: `src/shared/schemas/index.ts`

```typescript
// 1. src/shared/modules/products/schemas.ts
import { z } from '@hono/zod-openapi'

export const ProductSchema = z.object({
  id: z.number(),
  name: z.string(),
  price: z.number().positive(),
})

export type Product = z.infer<typeof ProductSchema>

// 2. src/shared/modules/products/index.ts
export { ProductSchema, type Product } from './schemas'

// 3. src/shared/schemas/index.ts
export { ProductSchema, type Product } from '../modules/products'
```

## 🔒 框架保护

框架层文件带有 `@framework-baseline` 注释：

```typescript
/**
 * @framework-baseline [hash]
 *
 * 此文件属于框架层代码。如需修改，请添加以下说明：
 * @framework-modify
 * @reason [必填] 修改原因
 * @impact [必填] 影响范围
 */
```

**框架层文件**:

- `src/shared/core/api-schemas.ts`
- `src/shared/core/protocol-types.ts`
- `src/shared/core/ws-client.ts`
- `src/shared/core/sse-client.ts`

## 📚 相关文档

- [API 类型推导规范](./10-api-type-inference.md) - Hono RPC 类型推导
- [Server API 规范](./20-server-api.md) - 服务端路由定义
- [WebSocket 规范](./50-websocket.md) - WebSocket 协议定义
- [SSE 规范](./51-sse.md) - SSE 协议定义
