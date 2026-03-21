---
paths: src/**/*
---

# 文件类型规范

## 📋 原则

**项目统一使用 TypeScript，除非有特殊理由使用其他语言。**

## ✅ TypeScript (.ts/.tsx)

### 必须使用 TypeScript 的场景

| 场景       | 文件类型 | 示例                                   |
| ---------- | -------- | -------------------------------------- |
| 源代码     | `.ts`    | `src/client/services/apiClient.ts`     |
| React 组件 | `.tsx`   | `src/client/components/Navigation.tsx` |
| 脚本工具   | `.ts`    | `scripts/validate-all.ts`              |
| 配置文件   | `.ts`    | `vite.config.ts`, `vitest.config.ts`   |

### TypeScript 特性要求

```typescript
// ✅ 启用严格类型检查
function process(data: TodoInput): Todo {
  // ...
}

// ✅ 使用类型导入（性能更好）
import type { Todo, CreateTodoInput } from '@shared/types'
import { Todo } from '@shared/types' // 值导入

// ✅ 使用 Node.js 协议前缀
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ❌ 避免使用 any
const data: any = getData()

// ✅ 使用 unknown 代替
const data: unknown = getData()
```

## ⚠️ JavaScript (.js/.mjs/.cjs)

### 允许使用 JavaScript 的场景

| 场景        | 理由     | 示例                |
| ----------- | -------- | ------------------- |
| ESLint 配置 | 工具限制 | `eslint.config.js`  |
| 第三方钩子  | 工具要求 | `.husky/pre-commit` |

### JavaScript 代码规范

即使使用 JavaScript，也应遵循 TypeScript 风格：

```javascript
// eslint.config.js
// ✅ 使用 JSDoc 提供类型信息
/**
 * @param {string} filePath - 文件路径
 * @returns {Promise<string>} 文件内容
 */
async function readFile(filePath) {
  // ...
}
```

## 📝 配置文件类型映射

| 文件               | 类型       | 理由                     |
| ------------------ | ---------- | ------------------------ |
| `vite.config.ts`   | TypeScript | ✅ Vite 原生支持         |
| `vitest.config.ts` | TypeScript | ✅ Vitest 原生支持       |
| `eslint.config.js` | JavaScript | ⚠️ ESLint 9 扁平配置要求 |
| `package.json`     | JSON       | ✅ npm 标准              |
| `tsconfig.json`    | JSON       | ✅ TypeScript 标准       |

## 🚫 禁止的文件类型

| 文件类型                    | 原因                    |
| --------------------------- | ----------------------- |
| `.jsx`                      | 项目使用 React + `.tsx` |
| CoffeeScript, LiveScript 等 | 非主流语言              |
| 未配置类型的 `.js`          | 无法获得类型安全        |

## 📂 目录结构

```
project-root/
├── src/
│   ├── client/          # .ts, .tsx
│   ├── server/          # .ts
│   └── shared/          # .ts
├── scripts/             # .ts (工具脚本)
├── eslint.config.js     # .js (工具要求)
├── vite.config.ts       # .ts
└── tsconfig.json        # JSON
```

## 📝 创建新文件时的决策树

```
需要创建文件？
    │
    ├─ 是配置文件？
    │   ├─ 是 ── 工具支持 TypeScript？
    │   │   ├─ 是 ── 使用 .ts
    │   │   └─ 否 ── 使用 .js + JSDoc
    │   │
    │   └─ 否 ── 使用 TypeScript (.ts)
    │
    └─ 是源代码？
        └─ 使用 .ts (React 组件使用 .tsx)
```

## 🎯 总结

| 场景        | 文件类型       | 是否必须    |
| ----------- | -------------- | ----------- |
| 源代码      | `.ts` / `.tsx` | ✅ 必须     |
| 脚本工具    | `.ts`          | ✅ 必须     |
| 配置文件    | `.ts` / `.js`  | 视工具支持  |
| ESLint 配置 | `.js`          | ⚠️ 工具限制 |

**原则：TypeScript 优先，JavaScript 仅作为工具要求的最后选择。**
