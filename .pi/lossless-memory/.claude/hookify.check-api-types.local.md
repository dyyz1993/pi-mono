---
name: check-api-types
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/server/module-.*/routes/.*\.ts$
  - field: new_text
    operator: regex_match
    pattern: return\s+c\.json\(
---

⚠️ **API 路由建议使用类型定义**

检测到 API 路由返回 JSON 响应，建议添加类型定义以确保类型安全。

**当前代码示例：**

```typescript
// ⚠️ 缺少类型定义
app.get('/api/todos', async c => {
  const todos = await getTodos()
  return c.json({ success: true, data: todos })
})
```

**推荐做法：**

```typescript
// ✅ 使用 Zod schema 定义类型
import { z } from '@hono/zod-openapi'
import { TodoSchema } from '@shared/schemas/todos'

// 定义响应类型
const TodoListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(TodoSchema),
})

type TodoListResponse = z.infer<typeof TodoListResponseSchema>

// 在路由中使用
app.get('/api/todos', async c => {
  const todos = await getTodos()
  const response: TodoListResponse = {
    success: true,
    data: todos,
  }
  return c.json<TodoListResponse>(response)
})

// ✅ 或者使用 OpenAPI 路由（推荐）
import { createRoute } from '@hono/zod-openapi'

const getTodosRoute = createRoute({
  method: 'get',
  path: '/api/todos',
  responses: {
    200: {
      content: {
        'application/json': { schema: TodoListResponseSchema },
      },
      description: 'Get todo list',
    },
  },
})

app.openapi(getTodosRoute, async c => {
  const todos = await getTodos()
  return c.json({ success: true, data: todos })
})
```

**类型定义位置：**

- Schema 定义：`src/shared/schemas/*.ts`
- 类型导出：`src/shared/core/` 和 `src/shared/modules/`

**已有 Schema：**

```typescript
// src/shared/schemas/todos.ts
export const TodoSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(['pending', 'completed']),
  completed: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// src/shared/schemas/common.ts
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema,
  })
```

**优势：**

- 编译时类型检查
- 自动生成 API 文档
- 前后端类型共享
- 更好的 IDE 支持
- 运行时数据验证

**参考文档：**
详细规范请查看 [Server API 规范](./rules/20-server-api.md)
