---
name: remind-db-migration
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/server/db/schema/.*\.ts$
---

💾 **数据库 Schema 已修改**

检测到数据库 schema 文件的更改，请记得执行数据库迁移。

**执行步骤：**

```bash
# 1. 生成迁移文件
npm run db:generate

# 2. 检查生成的迁移文件（在 drizzle/ 目录下）
cat drizzle/0001_*.sql

# 3. 执行迁移
npm run db:migrate

# 4. 验证迁移结果（可选）
npm run db:studio
```

**Schema 文件位置：**

- `src/server/db/schema/todos.ts` - Todo 表定义
- `src/server/db/schema/notifications.ts` - Notification 表定义
- `src/server/db/schema/index.ts` - Schema 导出

**常见操作：**

```typescript
// 添加新字段
export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  // 新增字段
  priority: text('priority', { enum: ['low', 'medium', 'high'] }).default('medium'),
  createdAt: integer('created_at').notNull(),
})

// 添加索引
export const todosIndex = index('todos_created_at_idx').on(todos.createdAt)
```

**注意事项：**

- 生产环境迁移前先备份数据库
- 检查迁移 SQL 是否符合预期
- 团队协作时，迁移文件需要提交到版本控制
- 使用 `db:studio` 可视化查看数据库结构
