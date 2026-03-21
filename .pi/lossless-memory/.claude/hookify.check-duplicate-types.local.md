---
name: check-duplicate-types
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/.*\.(ts|tsx)$
  - field: new_text
    operator: regex_match
    pattern: ^(export\s+)?(type|interface)\s+\w+
---

⚠️ **检测到类型定义 - 请检查仓库中是否已存在相同类型**

## 🎯 核心原则

**不要重复定义类型！优先复用项目已有类型！**

## 📦 项目已有类型一览

### 从 `@shared/types` 导入（推荐）

```typescript
import type {
  // Common API Types
  ApiSuccess, // 成功响应包装
  ApiError, // 错误响应
  ApiResponse, // 统一响应类型

  // Todo Types
  TodoStatus, // 'pending' | 'in_progress' | 'completed'
  Todo, // 完整的 Todo 对象
  CreateTodoInput, // 创建 Todo 的输入
  UpdateTodoInput, // 更新 Todo 的输入

  // Notification Types
  NotificationType, // 'info' | 'warning' | 'success' | 'error'
  AppNotification, // 完整的通知对象
  CreateNotificationInput,
  NotificationListQuery,
  SSEEvent,

  // WebSocket Types
  AppWSProtocol, // WebSocket 协议定义
  WSMessage, // WebSocket 消息
} from '@shared/types'
```

### 从 `@shared/schemas` 导入（包含运行时验证）

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

### 从数据库 Schema 推断

```typescript
import { todos, notifications } from '@server/db/schema'

// 从表定义推断类型
type TodoTable = typeof todos.$inferSelect // 查询结果类型
type NewTodo = typeof todos.$inferInsert // 插入数据类型

type NotificationTable = typeof notifications.$inferSelect
type NewNotification = typeof notifications.$inferInsert
```

## 🔍 如何查找已有类型

### 方法 1：使用 IDE 搜索

在 VS Code 中：

- `Cmd/Ctrl + T` 输入类型名称
- `Cmd/Ctrl + Shift + F` 全局搜索 `type YourTypeName`

### 方法 2：查看类型定义文件

- **共享类型**：`src/shared/core/` 和 `src/shared/modules/`
- **Schema 定义**：`src/shared/schemas/*.ts`
- **数据库 Schema**：`src/server/db/schema/*.ts`

### 方法 3：使用 TypeScript 编译器

```bash
# 查找所有类型定义
grep -r "^export type\|^export interface" src/shared/
```

## ✅ 正确示例

### 示例 1：使用已有类型

```typescript
// ❌ 错误 - 重复定义
interface Todo {
  id: number
  title: string
  status: 'pending' | 'completed'
}

// ✅ 正确 - 导入已有类型
import type { Todo } from '@shared/types'

async function getTodo(id: number): Promise<Todo> {
  // ...
}
```

### 示例 2：扩展现有类型

```typescript
// ❌ 错误 - 重复定义相似类型
interface TodoPreview {
  id: number
  title: string
}

// ✅ 正确 - 使用 Pick 提取需要的字段
import type { Todo } from '@shared/types'
type TodoPreview = Pick<Todo, 'id' | 'title'>

// ✅ 正确 - 使用 Omit 排除字段
type TodoWithoutTimestamps = Omit<Todo, 'createdAt' | 'updatedAt'>

// ✅ 正确 - 使用 Partial 使字段可选
type PartialTodo = Partial<Todo>
```

### 示例 3：组件 Props 类型

```typescript
// ❌ 错误 - 定义重复的 Props 类型
interface TodoItemProps {
  todo: {
    id: number
    title: string
    status: string
  }
}

// ✅ 正确 - 复用已有类型
import type { Todo } from '@shared/types'

interface TodoItemProps {
  todo: Todo
  onToggle: (id: number) => void
}
```

### 示例 4：API 响应类型

```typescript
// ❌ 错误 - 重新定义响应类型
interface TodoListResponse {
  success: boolean
  data: Todo[]
}

// ✅ 正确 - 使用通用响应类型
import type { ApiResponse, Todo } from '@shared/types'

type TodoListResponse = ApiResponse<Todo[]>
```

## 🛠️ 类型复用工具

### TypeScript 内置工具类型

```typescript
import type { Todo, CreateTodoInput } from '@shared/types'

// Partial - 所有字段可选
type UpdateData = Partial<Todo>

// Required - 所有字段必需
type CompleteTodo = Required<Todo>

// Pick - 选择部分字段
type TodoPreview = Pick<Todo, 'id' | 'title' | 'status'>

// Omit - 排除部分字段
type TodoWithoutId = Omit<Todo, 'id'>

// Record - 键值对
type TodoMap = Record<number, Todo>

// Extract/Exclude - 条件类型
type PendingTodo = Extract<Todo, { status: 'pending' }>
```

### 组合使用

```typescript
import type { Todo, CreateTodoInput } from '@shared/types'

// 创建带时间戳的类型
type TodoWithTimestamp = Todo & { timestamp: number }

// 创建只读类型
type ReadonlyTodo = Readonly<Todo>

// 嵌套 Pick
type TodoStatusInfo = Pick<Todo, 'id' | 'status'>
```

## 📚 类型定义位置速查

| 类型类别      | 定义位置                                    | 导入路径                          |
| ------------- | ------------------------------------------- | --------------------------------- |
| 共享业务类型  | `src/shared/core/` 和 `src/shared/modules/` | `@shared/core`, `@shared/modules` |
| Schema + 类型 | `src/shared/schemas/*.ts`                   | `@shared/schemas`                 |
| 数据库表类型  | `src/server/db/schema/*.ts`                 | `@server/db/schema`               |
| API 路由类型  | `src/server/index.ts`                       | `@server/index` (AppType)         |
| 组件 Props    | 组件文件内定义                              | -                                 |
| 页面状态      | Store 文件内定义                            | -                                 |

## 🚫 常见错误

### 错误 1：重复定义枚举类型

```typescript
// ❌ 错误 - 重复定义
type Status = 'pending' | 'in_progress' | 'completed'

// ✅ 正确
import type { TodoStatus } from '@shared/types'
```

### 错误 2：重复定义 API 响应结构

```typescript
// ❌ 错误
interface GetTodosResponse {
  success: boolean
  data: Todo[]
}

// ✅ 正确
import type { ApiResponse, Todo } from '@shared/types'
type GetTodosResponse = ApiResponse<Todo[]>
```

### 错误 3：重复定义数据库模型

```typescript
// ❌ 错误
interface TodoModel {
  id: number
  title: string
  // ...
}

// ✅ 正确 - 从 Schema 推断
import { todos } from '@server/db/schema'
type TodoModel = typeof todos.$inferSelect
```

## 💡 最佳实践

1. **优先导入** - 永远先检查是否已有类型
2. **使用工具类型** - 用 Pick/Omit/Partial 组合而非重新定义
3. **Schema First** - 用 Zod Schema 定义类型，自动推断
4. **单一来源** - 类型定义集中在 `shared/` 目录
5. **文档化** - 复杂类型添加 JSDoc 注释

## 🔗 相关文档

- [API Type Inference Rules](./rules/10-api-type-inference.md)
- [Shared Types Rules](./rules/40-shared-types.md)
- [Server API Validation](./rules/20-server-api.md)

---

**记住：每次定义新类型前，先搜索仓库中是否已存在相同或相似的类型！**
