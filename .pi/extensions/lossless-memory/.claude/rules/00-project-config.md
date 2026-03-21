---
paths: package.json, tsconfig.json, vite.config.ts, vitest.config.ts, .eslintrc*, .prettierrc*, eslint.config.js
---

# Project Rules

## 📦 项目配置

### TypeScript 配置

**路径**: `tsconfig.json`

**关键配置**:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@client/*": ["src/client/*"],
      "@server/*": ["src/server/*"]
    }
  }
}
```

### ESLint 配置

**路径**: `eslint.config.js`

**ESLint 版本**: 9.x (Flat Config)

**关联的 ESLint 规则**:

| 规则                                 | 类型  | 说明               |
| ------------------------------------ | ----- | ------------------ |
| `@typescript-eslint/no-unused-vars`  | error | 未使用的变量       |
| `@typescript-eslint/no-explicit-any` | warn  | 禁止 any 类型      |
| `no-console`                         | error | 禁止 console.log   |
| `no-restricted-globals`              | error | 禁止直接使用 fetch |

### 自定义 ESLint 规则

项目包含 17 个自定义 ESLint 规则，详见各模块规则文档。

## 📦 稡块结构

### 后端模块结构

```
src/server/
├── core/                    # 框架层（不可修改）
│   ├── runtime.ts
│   └── realtime-scanner.ts
├── middleware/              # 中间件
│   ├── auth.ts
│   ├── cors.ts
│   └── logger.ts
├── module-{feature}/       # 业务模块
│   ├── routes/
│   │   └── {feature}-routes.ts
│   ├── services/
│   │   └── {feature}-service.ts
│   └── __tests__/
│       └── *.test.ts
└── utils/                   # 工具函数
    ├── route-helpers.ts
    └── logger.ts
```

### 前端模块结构

```
src/client/
├── components/               # React 组件
│   └── __tests__/
├── hooks/                   # 自定义 Hooks
├── pages/                   # 页面组件
├── services/               # API 客户端
│   └── apiClient.ts
└── stores/                  # Zustand Store
    └── __tests__/
```

### 共享模块结构

```
src/shared/
├── core/                    # 框架层
│   ├── api-schemas.ts
│   ├── ws-client.ts
│   └── sse-client.ts
├── modules/                 # 业务层
│   ├── todos/
│   ├── notifications/
│   └── chat/
└── schemas/                 # 统一导出
    └── index.ts
```

## 🔗 路径别名

使用路径别名代替相对导入:

```typescript
// ✅ 正确
import { User } from '@shared/types'
import { useUserStore } from '@client/stores/userStore'

// ❌ 错误
import { User } from '../../../shared/types'
import { useUserStore } from '../../stores/userStore'
```

**ESLint 规则**: 无（建议添加）

**建议**: 添加 `no-restricted-imports` 规则禁止多级相对路径。

## 🧪 测试

详细测试规范请参考 [Testing 规范](./60-testing-standards.md)

快速参考:

- 单元测试: `__tests__/*.test.ts`
- 集成测试: `src/server/__tests__/integration/*.test.ts`
- E2E 测试: `e2e/*.spec.ts`
- 覆盖率目标: >80%

## 🎨 代码风格

- 使用 Prettier 进行格式化
- 遵循 ESLint 规则
- ❌ 生产代码禁止 `console.log`
- ✅ 允许 `console.error` 和 `console.warn` 用于错误日志
- 使用 TypeScript strict mode

## 📚 相关文档

- [Server API 规范](./20-server-api.md) - 服务端开发规范
- [Client 组件规范](./30-client-components.md) - 前端组件开发规范
- [Shared Types 规范](./40-shared-types.md) - 共享类型定义规范
- [Testing 规范](./60-testing-standards.md) - 测试编写规范
