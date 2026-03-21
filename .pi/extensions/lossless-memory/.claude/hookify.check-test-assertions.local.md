---
name: check-test-assertions
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: __tests__/.*\.test\.tsx?$
  - field: new_text
    operator: regex_match
    pattern: expect\([^)]+\)\.(toBeTruthy|toBeFalsy|toBe)\((true|false|null|undefined)?\)
---

⚠️ **检测到简单的真值断言**

测试标准要求验证具体数值，而非简单的 true/false/null 检查。

**问题示例：**

```typescript
// ❌ 避免 - 过于简单，没有验证实际业务逻辑
expect(result.success).toBe(true)
expect(data.length).toBeGreaterThan(0)
expect(todo.completed).toBe(true)
expect(response).toBeTruthy()
expect(error).toBeNull()
```

**推荐做法：**

```typescript
// ✅ 正确 - 验证具体的业务值
it('应当创建新 Todo 并设置初始属性', async () => {
  const todo = await createTodo({
    title: 'Test Todo',
    description: 'Test description',
  })

  // 验证 ID 生成
  expect(todo.id).toBeGreaterThan(0)

  // 验证所有字段
  expect(todo.title).toBe('Test Todo')
  expect(todo.description).toBe('Test description')
  expect(todo.status).toBe('pending')

  // 验证时间戳
  expect(todo.createdAt).toBeLessThanOrEqual(Date.now())
})

// ✅ 正确 - 验证完整的对象结构
it('应当返回正确的 API 响应', async () => {
  const response = await request.get('/api/todos/1')

  expect(response.status).toBe(200)
  expect(response.body).toEqual({
    success: true,
    data: {
      id: 1,
      title: 'Buy groceries',
      status: 'pending',
      completed: false,
    },
  })
})

// ✅ 正确 - 验证数组内容
it('应当返回 Todo 列表', async () => {
  const { items, total } = await getTodos()

  expect(items).toHaveLength(3)
  expect(items[0].title).toBe('Buy groceries')
  expect(items[1].title).toBe('Clean house')
  expect(total).toBe(3)
})
```

**断言数量要求：**

- 每个测试必须包含 **2-3 个具体数值的断言**
- 验证关键字段，而非仅验证存在性
- 覆盖率目标：**>80%**

**好的断言应该验证：**

- 具体的字段值（字符串、数字、枚举）
- 对象的完整结构
- 数组的长度和元素内容
- 时间戳的合理性
- 业务逻辑的正确性

**参考文档：**
详细测试规范请查看 [Testing 规范](./rules/60-testing-standards.md)
