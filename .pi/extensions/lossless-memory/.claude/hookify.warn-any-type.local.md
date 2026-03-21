---
name: warn-any-type
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/.*\.(ts|tsx)$
  - field: new_text
    operator: regex_match
    pattern: :\s*any\b|as\s+any\b
---

⚠️ **检测到 any 类型使用**

使用 `any` 类型会绕过 TypeScript 的类型检查，可能导致运行时错误。

**问题示例：**

```typescript
// ❌ 避免 - 使用 any 类型
let data: any = fetchData();
const result = response as any;
function process(input: any): any { ... }
```

## 🎯 优先使用项目已有类型

**重要原则：不要随意定义新类型，优先在项目中查找已有类型！**

### 项目已有类型一览

**从 `@shared/types` 导入：**

```typescript
import type {
  // Common
  ApiSuccess,
  ApiError,
  ApiResponse,
  // Todos
  TodoStatus, // 'pending' | 'in_progress' | 'completed'
  Todo, // 完整的 Todo 对象
  CreateTodoInput, // 创建 Todo 的输入
  UpdateTodoInput, // 更新 Todo 的输入
  // Notifications
  NotificationType, // 'info' | 'warning' | 'success' | 'error'
  AppNotification, // 完整的通知对象
  CreateNotificationInput,
  NotificationListQuery,
  SSEEvent,
} from '@shared/types'
```

**从 `@shared/schemas` 导入（推荐）：**

```typescript
import {
  // Schemas（用于运行时验证）
  TodoSchema,
  CreateTodoSchema,
  UpdateTodoSchema,
  NotificationSchema,
  // Types（自动推断）
  type Todo,
  type CreateTodoInput,
  type UpdateTodoInput,
} from '@shared/schemas'
```

### 使用示例

```typescript
// ❌ 避免 - 使用 any
async function getTodo(id: number): Promise<any> {
  const response = await fetch(`/api/todos/${id}`)
  return response.json()
}

// ✅ 正确 - 使用项目已有类型
import type { Todo, ApiResponse } from '@shared/types'

async function getTodo(id: number): Promise<Todo> {
  const response = await fetch(`/api/todos/${id}`)
  const data: ApiResponse<Todo> = await response.json()

  if (!data.success) {
    throw new Error(data.error)
  }

  return data.data
}

// ✅ 更好 - 使用 Zod 进行运行时验证
import { TodoSchema, type Todo } from '@shared/schemas'

async function getTodo(id: number): Promise<Todo> {
  const response = await fetch(`/api/todos/${id}`)
  const json = await response.json()

  const result = TodoSchema.safeParse(json)
  if (!result.success) {
    throw new Error('Invalid todo data')
  }

  return result.data
}
```

## 🔧 其他替代方案

### 1. 使用 Partial、Pick、Omit（基于已有类型）

```typescript
import type { Todo, CreateTodoInput } from '@shared/types';

// ❌ 避免
function updateTodo(id: number, updates: any) { ... }

// ✅ 使用 Partial
function updateTodo(id: number, updates: Partial<Todo>) { ... }

// ✅ 使用 Pick
type TodoPreview = Pick<Todo, 'id' | 'title'>;

// ✅ 使用 Omit
type TodoWithoutTimestamps = Omit<Todo, 'createdAt' | 'updatedAt'>;
```

### 2. 使用泛型

```typescript
// ❌ 避免
function getFirstItem(items: any): any {
  return items[0]
}

// ✅ 使用泛型
function getFirstItem<T>(items: T[]): T | undefined {
  return items[0]
}

// 使用项目类型
import type { Todo } from '@shared/types'
const firstTodo = getFirstItem<Todo>(todos)
```

### 3. 使用 unknown（当类型真的未知时）

```typescript
// ❌ 避免
function parseJSON(json: string): any {
  return JSON.parse(json)
}

// ✅ 使用 unknown + Zod 验证
import { TodoSchema, type Todo } from '@shared/schemas'

function parseTodo(json: string): Todo {
  const data: unknown = JSON.parse(json)
  const result = TodoSchema.safeParse(data)

  if (!result.success) {
    throw new Error('Invalid todo data')
  }

  return result.data
}
```

### 4. 使用 Record（键值对场景）

```typescript
import type { Todo } from '@shared/types'

// ❌ 避免
const todoCache: any = {}

// ✅ 使用 Record
const todoCache: Record<number, Todo> = {}
```

## 📚 项目类型定义

- **类型导出**：`src/shared/core/` 和 `src/shared/modules/`
- **Schema 定义**：`src/shared/schemas/`
  - `index.ts` - 统一导出

## ⚠️ 特殊情况

如果确实需要使用 `any`（极少数情况）：

```typescript
// 临时禁用 ESLint 规则（不推荐，但有时必要）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legacyData: any = oldApi.getData()

// 或者使用 @ts-expect-error（更好）
// @ts-expect-error - 第三方库类型定义缺失
const result = thirdPartyLib.someMethod()
```

**记住：优先在项目中查找已有类型，不要随意定义新类型！**
