# 验证器测试指南

## 🧪 测试方法

### 方法 1: 运行单元测试（推荐）

直接测试验证器的核心功能：

```bash
node --import tsx/esm lint-scripts/test-validators-unit.ts
```

**测试内容**:

- ✅ 服务端 RPC - 非链式语法检测
- ✅ 服务端 RPC - 链式语法通过
- ✅ 客户端 RPC - 直接 fetch 检测
- ✅ 客户端 RPC - apiClient 使用通过

### 方法 2: 运行完整验证

验证整个项目的代码：

```bash
npm run validate:all
```

**验证内容**:

1. TODO/FIXME 检查
2. 敏感信息检查
3. 导入路径检查
4. 服务端 RPC 规范检查
5. 客户端 RPC 调用检查
6. 目录结构检查

### 方法 3: 实时监控

在开发过程中实时监控：

```bash
npm run validate:watch
```

## 📊 测试结果示例

### 单元测试输出

```
🧪 验证器单元测试

============================================================

📋 测试 1: 服务端 RPC - 非链式语法（应该检测到错误）
------------------------------------------------------------
✅ 成功检测到错误:
   - Non-chain syntax detected: variable 'app' is assigned but not using chain syntax
     建议: Use chain syntax: export const routes = new OpenAPIHono()
  .openapi(route1, handler1)
  .openapi(route2, handler2)

📋 测试 2: 服务端 RPC - 链式语法（应该通过）
------------------------------------------------------------
✅ 验证通过（没有错误）

📋 测试 3: 客户端 RPC - 直接 fetch（应该检测到错误）
------------------------------------------------------------
✅ 成功检测到错误:
   - Direct fetch() call to internal API detected: await fetch('/api/
     建议: Use apiClient instead: apiClient.api.todos.$get()

📋 测试 4: 客户端 RPC - 使用 apiClient（应该通过）
------------------------------------------------------------
✅ 验证通过（没有错误）

============================================================
📊 测试总结:
============================================================
  通过: 4/4 个测试

✅ 所有测试通过！验证器工作正常。
```

### 完整验证输出

```
🚀 Running all validators...

🔍 [1/6] Checking TODO/FIXME comments...
  ✅ No unassigned TODOs found

🔍 [2/6] Checking for sensitive data...
  ✅ No sensitive data found

🔍 [3/6] Checking import paths...
  ✅ All imports are valid

🔍 [4/6] Checking server RPC patterns...
  ✅ Server RPC patterns are valid

🔍 [5/6] Checking client RPC usage...
  ✅ Client RPC usage is valid

🔍 [6/6] Checking directory structure...
  ✅ Directory structure is valid

==================================================
📊 Validation Summary:
==================================================
  ✅ TODO/FIXME: 0 error(s)
  ✅ Sensitive Data: 0 error(s)
  ✅ Import Paths: 0 error(s)
  ✅ Server RPC: 0 error(s)
  ✅ Client RPC: 0 error(s)
  ✅ Directory Structure: 0 error(s)
==================================================

✅ All validations passed!
```

## 🎯 验证器功能详解

### 1. 服务端 RPC 规范验证器

**检测的错误**:

- ❌ 非链式语法: `const app = new OpenAPIHono()` 后单独调用
- ❌ 未导出路由: 没有导出路由实例或类型

**正确示例**:

```typescript
export const apiRoutes = new OpenAPIHono().openapi(route1, handler1).openapi(route2, handler2)
```

**错误示例**:

```typescript
const app = new OpenAPIHono()
app.openapi(route1, handler1) // ❌ 非链式
```

### 2. 客户端 RPC 调用验证器

**检测的错误**:

- ❌ 直接 fetch 内部 API: `fetch('/api/todos')`
- ❌ 非类型安全方法: `apiClient.api.todos()` (缺少 `$`)
- ❌ 硬编码 API 路径: `const url = '/api/users'`

**正确示例**:

```typescript
import { apiClient } from '@client/services/apiClient'

const response = await apiClient.api.todos.$get()
const result = await response.json()
```

**错误示例**:

```typescript
const response = await fetch('/api/todos') // ❌ 直接 fetch
```

### 3. 目录结构验证器

**检测的错误**:

- ❌ 路由文件不在 `routes/` 目录
- ❌ 服务文件不在 `services/` 目录
- ❌ 测试文件不在 `__tests__/` 目录

**正确结构**:

```
src/server/module-{feature}/
├── routes/          # 路由文件
├── services/        # 服务文件
└── __tests__/       # 测试文件
```

## 🔧 自定义测试

### 创建自定义测试用例

```typescript
import { validateServerRPCInFile } from './validators/server-rpc.validator.js'

const testCode = `
// 你的测试代码
const app = new OpenAPIHono()
app.openapi(route, handler)
`

const errors = validateServerRPCInFile('test.ts', '/test', config, testCode)

console.log('检测到的错误:', errors)
```

### 测试特定文件

```bash
# 只测试特定目录
npm run validate:all -- --dir src/server

# 只测试特定验证器
node --import tsx/esm lint-scripts/validators/server-rpc.validator.ts
```

## 📝 测试检查清单

在提交代码前，确保：

- [ ] 运行单元测试: `node --import tsx/esm lint-scripts/test-validators-unit.ts`
- [ ] 运行完整验证: `npm run validate:all`
- [ ] 所有验证器都通过
- [ ] 没有误报（如果有，调整配置）
- [ ] 错误信息清晰易懂

## 🐛 故障排除

### 问题 1: 验证器没有检测到错误

**可能原因**:

- 文件不在检查目录内
- 文件被忽略规则排除
- 正则表达式匹配失败

**解决方法**:

```typescript
// 检查配置
console.log('检查目录:', config.checkDirs)
console.log('忽略目录:', config.ignoreDirs)
```

### 问题 2: 验证器误报

**可能原因**:

- 正则表达式过于严格
- 排除规则不够完善

**解决方法**:

```typescript
// 添加排除规则
ignorePatterns: [/server\/config\.ts/, /server\/lib\/logger\.ts/]
```

### 问题 3: 性能问题

**解决方法**:

- 使用 `validate:watch` 进行增量验证
- 减少检查的目录范围
- 调整 `ignoreDirs` 配置

## 🎉 测试成功标准

- ✅ 单元测试全部通过 (4/4)
- ✅ 完整验证无错误
- ✅ 错误信息清晰
- ✅ 性能良好 (< 5秒)
- ✅ 无误报

## 📚 相关文档

- [使用指南](./README.md)
- [配置说明](./config/project.config.ts)
- [验证器源码](./validators/)
