# 目录结构验证规则（增强版）

## 🎯 概述

增强的目录结构验证器现在可以：

1. ✅ 确保文件放在正确的目录
2. ✅ 禁止特定类型的文件放在特定位置
3. ✅ 限制根目录文件类型
4. ✅ 提供清晰的错误提示和修复建议

## 📋 验证规则

### 1. 必需的目录位置

| 文件模式       | 必需目录     | 说明                          |
| -------------- | ------------ | ----------------------------- |
| `*routes*.ts`  | `routes/`    | 路由文件必须在 routes 目录    |
| `*service*.ts` | `services/`  | 服务文件必须在 services 目录  |
| `*.test.ts`    | `__tests__/` | 单元测试必须在 **tests** 目录 |
| `*.spec.ts`    | `e2e/`       | E2E 测试必须在 e2e 目录       |

### 2. 禁止的位置

| 文件模式       | 禁止目录                   | 错误提示                 | 建议                               |
| -------------- | -------------------------- | ------------------------ | ---------------------------------- |
| `*.test.ts`    | `src/server`, `src/client` | 单元测试不应在源代码目录 | 移动到模块内的 **tests**/ 目录     |
| `*.spec.ts`    | `src`                      | E2E 测试不应在 src 目录  | 移动到项目根目录的 e2e/ 目录       |
| `*example*.ts` | `src`                      | 示例文件不应在 src 目录  | 移动到 examples/ 或 docs/examples/ |
| `*demo*.ts`    | `src`                      | 演示文件不应在 src 目录  | 移动到 demos/ 或 docs/demos/       |
| `*script*.ts`  | `src`                      | 脚本文件不应在 src 目录  | 移动到 scripts/ 目录               |

### 3. 根目录文件限制

**允许的根目录文件**:

- `*.config.ts` - 配置文件
- `*.config.js` - 配置文件
- `*.setup.ts` - 设置文件
- `vite-env.d.ts` - Vite 环境类型
- `vite-plugins.ts` - Vite 插件

**禁止的根目录文件**:

- 其他所有 `.ts` 和 `.tsx` 文件

## 📁 推荐的目录结构

```
project/
├── src/
│   ├── server/
│   │   ├── module-{feature}/
│   │   │   ├── routes/          # 路由文件
│   │   │   ├── services/        # 服务文件
│   │   │   └── __tests__/       # 单元测试
│   │   ├── routes/              # 全局路由
│   │   ├── services/            # 全局服务
│   │   ├── db/                  # 数据库
│   │   ├── lib/                 # 工具库
│   │   └── utils/               # 工具函数
│   ├── client/
│   │   ├── services/            # 客户端服务
│   │   ├── stores/              # 状态管理
│   │   ├── hooks/               # React Hooks
│   │   ├── components/          # UI 组件
│   │   └── pages/               # 页面组件
│   └── shared/
│       ├── schemas/             # Zod schemas
│       └── types/               # TypeScript 类型
├── scripts/                     # 构建和工具脚本
├── e2e/                         # E2E 测试
├── docs/                        # 文档
│   ├── examples/                # 示例代码
│   └── demos/                   # 演示代码
├── lint-scripts/                # 验证脚本
├── drizzle/                     # 数据库迁移
└── patches/                     # 补丁文件
```

## 🚫 错误示例

### 示例 1: 测试文件在源代码目录

```typescript
// ❌ 错误: src/server/user.test.ts
export function testUser() {
  // 测试代码
}
```

**错误提示**:

```
❌ Found 1 directory structure error(s):

🚫 Forbidden Location (1):

  src/server/user.test.ts
    Unit test files should not be in source directories
    Suggestion: Move to __tests__/ directory within the module
```

**正确做法**:

```typescript
// ✅ 正确: src/server/module-user/__tests__/user.test.ts
export function testUser() {
  // 测试代码
}
```

### 示例 2: 示例文件在源代码目录

```typescript
// ❌ 错误: src/example-usage.ts
export function exampleUsage() {
  console.log('This is an example')
}
```

**错误提示**:

```
❌ Found 1 directory structure error(s):

🚫 Forbidden Location (1):

  src/example-usage.ts
    Example files should not be in src/ directory
    Suggestion: Move to examples/ directory at project root or docs/examples/
```

**正确做法**:

```typescript
// ✅ 正确: docs/examples/usage.ts
export function exampleUsage() {
  console.log('This is an example')
}
```

### 示例 3: 路由文件不在 routes 目录

```typescript
// ❌ 错误: src/server/user-routes.ts
export const userRoutes = new OpenAPIHono().openapi(route, handler)
```

**错误提示**:

```
❌ Found 1 directory structure error(s):

📁 Wrong Directory Location (1):

  src/server/user-routes.ts
    Expected: routes/
    Actual: server/
```

**正确做法**:

```typescript
// ✅ 正确: src/server/routes/user-routes.ts
export const userRoutes = new OpenAPIHono().openapi(route, handler)
```

## ⚙️ 配置说明

### 配置文件位置

`lint-scripts/config/project.config.ts`

### 添加新的禁止位置规则

```typescript
export const directoryStructureConfig: DirectoryStructureConfig = {
  forbiddenLocations: [
    {
      pattern: '*temp*.ts', // 文件模式
      forbiddenDirs: ['src'], // 禁止的目录
      message: '临时文件不应在 src 目录', // 错误提示
      suggestion: '移动到 temp/ 目录', // 修复建议
    },
  ],
}
```

### 添加新的必需目录规则

```typescript
export const directoryStructureConfig: DirectoryStructureConfig = {
  rules: [
    {
      pattern: '*helper*.ts', // 文件模式
      requiredDir: 'utils', // 必需的目录
      description: 'Helper files must be in utils/', // 描述
    },
  ],
}
```

### 允许更多根目录文件

```typescript
export const directoryStructureConfig: DirectoryStructureConfig = {
  allowedRootFiles: [
    '*.config.ts',
    '*.config.js',
    '*.setup.ts',
    'vite-env.d.ts',
    'vite-plugins.ts',
    'custom-file.ts', // 新增允许的文件
  ],
}
```

## 🧪 测试验证

### 运行验证

```bash
npm run validate:all
```

### 测试特定场景

创建一个错误放置的文件来测试：

```bash
# 创建测试文件
echo "export function example() {}" > src/example-wrong.ts

# 运行验证
npm run validate:all

# 应该看到错误提示
# ❌ Example files should not be in src/ directory

# 删除测试文件
rm src/example-wrong.ts
```

## 📊 验证结果

### 成功示例

```
🔍 [6/6] Checking directory structure...
  ✅ Directory structure is valid
```

### 失败示例

```
🔍 [6/6] Checking directory structure...
❌ Found 2 directory structure error(s):

📁 Wrong Directory Location (1):

  src/server/user-routes.ts
    Expected: routes/
    Actual: server/

🚫 Forbidden Location (1):

  src/example-usage.ts
    Example files should not be in src/ directory
    Suggestion: Move to examples/ directory at project root or docs/examples/
```

## 🎯 最佳实践

1. **遵循目录结构**: 按照推荐的目录结构组织代码
2. **测试文件分离**: 将测试文件放在专门的测试目录
3. **文档分离**: 将示例和演示代码放在 docs/ 目录
4. **脚本分离**: 将构建和工具脚本放在 scripts/ 目录
5. **配置集中**: 配置文件可以放在根目录

## 📚 相关文档

- [项目配置](../.claude/rules/00-project-config.md)
- [测试标准](../.claude/rules/60-testing-standards.md)
- [验证器使用指南](./README.md)
- [验证器测试指南](./TESTING.md)

## 🔧 故障排除

### 问题 1: 误报

**解决方案**: 在配置中添加排除规则

```typescript
ignoreDirs: ['node_modules', 'dist', '.git', 'build', 'coverage', 'custom-dir'],
```

### 问题 2: 需要特殊处理

**解决方案**: 在 `allowedRootFiles` 中添加

```typescript
allowedRootFiles: [
  '*.config.ts',
  'special-file.ts',  // 允许特殊文件
],
```

### 问题 3: 规则太严格

**解决方案**: 调整 `forbiddenLocations` 配置

```typescript
// 移除或注释不需要的规则
forbiddenLocations: [
  // {
  //   pattern: '*example*.ts',
  //   forbiddenDirs: ['src'],
  //   message: 'Example files should not be in src/ directory',
  //   suggestion: 'Move to examples/ directory',
  // },
],
```

## ✅ 总结

增强的目录结构验证器能够：

- ✅ 自动检测错误放置的文件
- ✅ 提供清晰的错误提示
- ✅ 给出具体的修复建议
- ✅ 强制执行项目结构规范
- ✅ 提高代码组织质量

通过这套规则，可以确保项目结构清晰、一致，便于维护和协作。
