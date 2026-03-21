# 响应系统整理计划

## 问题诊断

### 1. 类型与 Schema 不一致
```typescript
// api-schemas.ts
ApiSuccessSchema<T> → { success: true, data: T, timestamp: string }  // Schema
ApiSuccess<T>       → { success: true; data: T }                    // 类型 ❌ 缺少 timestamp
```

### 2. 文件职责
| 文件 | 职责 | 问题 |
|------|------|------|
| `api-schemas.ts` | Zod Schema + TypeScript 类型 | 类型定义不完整 |
| `response.ts` | 运行时响应包装函数 | 职责清晰 |
| `route-helpers.ts` | OpenAPI 响应配置 + 重导出 | 重导出造成语义混淆 |

## 整理方案

### 方案 A：最小改动（推荐）
只修复 `ApiSuccess<T>` 类型定义，添加 `timestamp` 字段：

```typescript
// api-schemas.ts
export type ApiSuccess<T> = { success: true; data: T; timestamp: string }
```

**优点**：改动最小，风险低
**缺点**：导入路径语义问题保留

### 方案 B：重构导入路径
1. 修复类型定义
2. 路由文件直接从 `response.ts` 导入运行时函数
3. 从 `route-helpers.ts` 只导入 OpenAPI 配置函数

```typescript
// 路由文件中
import { success, list, deleted } from '../../utils/response'        // 运行时
import { successResponse, defineResponses } from '../../utils/route-helpers'  // OpenAPI 配置
```

**优点**：职责清晰，语义明确
**缺点**：需要修改所有路由文件的导入语句

### 方案 C：合并文件
将 `response.ts` 和 `route-helpers.ts` 合并为一个文件：

```
response.ts
├── 运行时辅助函数 (success, created, list, deleted)
├── OpenAPI 配置函数 (successResponse, errorResponse, defineResponses)
└── 请求配置快捷函数 (idParam, bodyRequest, queryRequest)
```

**优点**：一个文件解决所有响应相关
**缺点**：文件变大，职责混合

## 推荐方案

**方案 A** - 最小改动，只修复类型定义：

```diff
// api-schemas.ts
-export type ApiSuccess<T> = { success: true; data: T }
+export type ApiSuccess<T> = { success: true; data: T; timestamp: string }
```

## 后续任务

1. [x] 分析响应系统结构
2. [ ] 确认整理方案
3. [ ] 修复 `ApiSuccess<T>` 类型定义
4. [ ] 继续修复剩余路由文件的类型错误
5. [ ] 验证所有类型错误已修复
6. [ ] 提交代码
