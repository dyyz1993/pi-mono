# 自动化代码检查系统使用指南

## 🎯 系统概述

本系统实现了完整的自动化代码检查和校验，确保代码质量和规范性。系统包含 6 个验证器，在编辑和提交代码时自动运行。

## 📋 验证器列表

### 1. TODO/FIXME 检查

- 检查未分配的 TODO/FIXME 注释
- 要求使用 `@author` 标注责任人
- **优先级**: 低（警告）

### 2. 敏感信息检查

- 检测 API Keys、密码、token 等敏感信息
- 检测 console.log 调试代码
- 检测 .env 文件引用
- **优先级**: 高（必须通过）

### 3. 导入路径检查

- 检测跨模块的相对路径导入
- 强制使用路径别名（@shared, @client, @server）
- **优先级**: 中（建议通过）

### 4. 服务端 RPC 规范检查 ⭐ 新增

- 检查是否使用 OpenAPIHono 链式语法
- 确保路由文件导出类型供客户端使用
- **优先级**: 高（必须通过）

**正确示例**:

```typescript
export const apiRoutes = new OpenAPIHono().openapi(listRoute, handler1).openapi(getRoute, handler2)
```

**错误示例**:

```typescript
const app = new OpenAPIHono()
app.openapi(listRoute, handler1) // ❌ 非链式调用
```

### 5. 客户端 RPC 调用检查 ⭐ 新增

- 确保使用 apiClient 进行 API 调用
- 禁止直接 fetch 内部 API
- 强制使用类型安全方法（$get, $post 等）
- **优先级**: 高（必须通过）

**正确示例**:

```typescript
const response = await apiClient.api.todos.$get()
const result = await response.json()
```

**错误示例**:

```typescript
const response = await fetch('/api/todos') // ❌ 直接 fetch
apiClient.api.todos() // ❌ 缺少 $ 前缀
```

### 6. 目录结构检查 ⭐ 增强版

- 确保文件放在正确的目录
- **禁止特定类型文件放在特定位置**:
  - ❌ 测试文件不能在 `src/` 目录
  - ❌ 示例文件不能在 `src/` 目录
  - ❌ 演示文件不能在 `src/` 目录
  - ❌ 脚本文件不能在 `src/` 目录
- **限制根目录文件类型**
- **优先级**: 中（建议通过）

**正确结构**:

```
src/server/module-{feature}/
├── routes/          # 路由文件
├── services/        # 服务文件
└── __tests__/       # 测试文件

scripts/             # 脚本文件
e2e/                 # E2E 测试
docs/examples/       # 示例文件
```

**错误示例**:

```
src/user.test.ts     # ❌ 测试文件在源代码目录
src/example.ts       # ❌ 示例文件在源代码目录
```

## 🔄 触发机制

### 1. Claude Code 编辑后自动触发

每次使用 Claude Code 编辑代码后，会自动运行所有验证器：

```
编辑代码 → afterToolUse hook → post-edit-check.sh → validate:all
```

**配置文件**: `.claude/settings.json`

```json
{
  "hooks": {
    "afterToolUse": [
      {
        "type": "command",
        "command": "bash .claude/scripts/post-edit-check.sh"
      }
    ]
  }
}
```

### 2. Git Commit 前自动触发

每次提交代码前，会自动运行完整的检查流程：

```
git commit → pre-commit hook → typecheck → validate:all → lint-staged → test
```

**配置文件**: `.husky/pre-commit`

### 3. 手动运行

```bash
# 运行所有验证器
npm run validate:all

# 实时监控模式
npm run validate:watch
```

## 📊 验证结果

### 成功示例

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

### 失败示例

```
❌ Found 2 server RPC pattern error(s):

  src/server/routes/user-routes.ts:10
    Error: Non-chain syntax detected: variable 'app' is assigned but not using chain syntax
    Suggestion: Use chain syntax: export const routes = new OpenAPIHono()
      .openapi(route1, handler1)
      .openapi(route2, handler2)

📋 Server RPC Guidelines:
  ✅ DO: Use chain syntax with OpenAPIHono
    export const apiRoutes = new OpenAPIHono()
      .openapi(route1, handler1)
      .openapi(route2, handler2)

  ❌ DON'T: Use standalone variable assignment
    const app = new OpenAPIHono()
    app.openapi(route1, handler1)

  📖 See: .claude/rules/api-type-inference-rules.md
```

## ⚙️ 配置文件

### 项目配置

`lint-scripts/config/project.config.ts`

可以自定义每个验证器的规则：

- 检查的目录
- 忽略的目录
- 规则严格程度

### 示例：调整服务端 RPC 检查

```typescript
export const serverRPCConfig: ServerRPCConfig = {
  checkDirs: ['src/server'], // 检查的目录
  ignoreDirs: ['node_modules', 'dist', '__tests__'], // 忽略的目录
  requireChainSyntax: true, // 要求链式语法
  requireTypeExport: true, // 要求导出类型
}
```

## 🔧 故障排除

### 问题 1: 验证器误报

**解决方案**: 在配置文件中添加排除规则

```typescript
// 在 project.config.ts 中
ignorePatterns: [
  /server\/config\.ts/,  // 排除配置文件
  /server\/lib\/logger\.ts/,  // 排除日志文件
],
```

### 问题 2: 性能问题

**解决方案**:

- 使用 `validate:watch` 进行增量验证
- 减少检查的目录范围
- 调整 `ignoreDirs` 配置

### 问题 3: Hook 不触发

**解决方案**:

1. 检查文件权限: `chmod +x .claude/scripts/post-edit-check.sh`
2. 检查 Claude Code 配置: `.claude/settings.json`
3. 检查 husky 配置: `.husky/pre-commit`

## 📚 相关文档

- [API 类型推导规则](../.claude/rules/10-api-type-inference.md)
- [客户端服务规则](../.claude/rules/31-client-services.md)
- [项目配置](../.claude/rules/00-project-config.md)
- [WebSocket 规范](../.claude/rules/50-websocket.md)

## 🎯 最佳实践

1. **提交前检查**: 养成提交前运行 `npm run validate:all` 的习惯
2. **增量验证**: 开发时使用 `npm run validate:watch` 实时监控
3. **配置调整**: 根据项目需求调整验证规则
4. **错误处理**: 认真阅读错误提示，按照建议修复

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 运行验证
npm run validate:all

# 3. 实时监控
npm run validate:watch

# 4. 提交代码（自动触发验证）
git add .
git commit -m "feat: add new feature"
```

## 📈 效果

通过这套自动化检查系统，可以：

- ✅ 确保代码质量和一致性
- ✅ 减少代码审查时间
- ✅ 避免常见的编码错误
- ✅ 强制执行最佳实践
- ✅ 提高团队协作效率
