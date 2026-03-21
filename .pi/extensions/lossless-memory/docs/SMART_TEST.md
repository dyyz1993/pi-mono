# Smart Test Runner

智能测试运行器，只运行与改动文件相关的测试。

## 功能特性

- 🔍 **智能依赖分析**：自动分析文件依赖关系，找到相关的测试
- 🏗️ **架构测试过滤**：支持只运行底层架构测试
- 📦 **业务测试隔离**：避免运行业务逻辑测试
- ⚡ **快速反馈**：只运行必要的测试，节省时间

## 使用方法

### 1. 智能测试（推荐）

自动检测改动文件，只运行相关测试：

```bash
npm run test:smart
```

### 2. 只测试已暂存的文件

在 commit 前运行，只测试已 `git add` 的文件：

```bash
npm run test:smart:staged
```

### 3. 只运行架构测试

只运行数据库、配置等底层架构测试：

```bash
npm run test:infrastructure
```

### 4. 运行所有测试

```bash
npm run test:all
```

## 工作原理

### 依赖图构建

```
源文件 A → 导入 → 模块 B → 导入 → 模块 C
                                    ↓
                              测试文件 X
```

当修改 `模块 B` 时，脚本会：
1. 分析 `模块 B` 被哪些文件导入
2. 找到依赖 `模块 B` 的测试文件
3. 只运行这些相关测试

### 架构测试识别

以下文件会被识别为架构测试：
- `/db/` - 数据库相关
- `/config` - 配置文件
- `/driver` - 数据库驱动
- `/test-setup` - 测试设置
- `vitest.setup` - Vitest 配置

## Pre-commit Hook

已集成到 `.husky/pre-commit`，每次 commit 前自动运行：

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "Running TypeScript type check..."
npm run typecheck

npx lint-staged

echo "Running smart tests for changed files..."
npm run test:smart:staged
```

## 示例场景

### 场景 1：修改数据库配置

```bash
# 修改了 src/server/db/driver.ts
npm run test:smart

# 输出：
🔍 Analyzing changes...
📝 Changed files:
  - src/server/db/driver.ts

🎯 Running related tests:
  🏗️  [Infrastructure] src/server/module-todos/__tests__/todo-service.test.ts
  🏗️  [Infrastructure] src/server/module-todos/__tests__/todos-route.test.ts
  🏗️  [Infrastructure] src/server/integration/todos-api.test.ts
```

### 场景 2：修改业务组件

```bash
# 修改了 src/client/components/App.tsx
npm run test:smart

# 输出：
🔍 Analyzing changes...
📝 Changed files:
  - src/client/components/App.tsx

🎯 Running related tests:
  📦 [Business] src/client/components/__tests__/App.test.tsx
```

### 场景 3：修改共享类型

```bash
# 修改了 src/shared/schemas/todos.ts
npm run test:smart

# 输出：
🔍 Analyzing changes...
📝 Changed files:
  - src/shared/schemas/todos.ts

🎯 Running related tests:
  📦 [Business] src/client/stores/__tests__/todoStore.test.ts
  🏗️  [Infrastructure] src/server/module-todos/__tests__/todo-service.test.ts
  🏗️  [Infrastructure] src/server/module-todos/__tests__/todos-route.test.ts
```

## 性能对比

| 场景 | 全量测试 | 智能测试 | 提升 |
|------|---------|---------|------|
| 修改单个组件 | 33 tests | 1-3 tests | 90%+ |
| 修改数据库配置 | 33 tests | 3-5 tests | 85%+ |
| 修改共享类型 | 33 tests | 5-10 tests | 70%+ |

## 注意事项

1. **首次运行**：如果没有改动文件，会提示 "No changes detected"
2. **新增文件**：新增的文件需要先 `git add` 才会被检测到
3. **删除文件**：删除的文件不会触发测试
4. **依赖分析**：只分析相对路径导入和 `@shared/`、`@client/`、`@server/` 别名

## 故障排查

### 问题：没有检测到相关测试

**原因**：可能是导入路径使用了绝对路径或其他别名

**解决**：检查导入语句，确保使用相对路径或已配置的别名

### 问题：运行了不相关的测试

**原因**：依赖链中存在间接引用

**解决**：这是正常的，确保了代码改动的安全性

## 扩展配置

可以在 `scripts/smart-test.ts` 中自定义：

- 添加新的架构测试模式
- 调整依赖分析逻辑
- 添加更多测试文件匹配规则
