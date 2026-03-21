# TypeScript 类型重复检测 Hook

## 📋 功能说明

这个 Hook 会在编辑或创建 TypeScript 文件时自动检测是否存在重复的类型定义，帮助开发者：

- ✅ 避免重复定义相同的类型
- ✅ 提示已有类型的位置
- ✅ 建议使用 TypeScript 工具类型
- ✅ 促进类型复用，提高代码质量

## 🚀 工作原理

### 触发时机

当使用 `Write` 或 `Edit` 工具编辑 `.ts` 或 `.tsx` 文件后自动触发。

### 检测流程

```
编辑 TS 文件
    ↓
提取新定义的类型名称
    ↓
在整个 src/ 目录搜索相同类型
    ↓
如果发现重复 → 显示警告和建议
```

## 📦 文件结构

```
.claude/
├── hookify.check-duplicate-types.local.md  # 规则说明文档
├── scripts/
│   └── check-duplicate-types.ts            # TypeScript 检测脚本
└── settings.json                            # Hook 配置
```

## 🎯 使用示例

### 示例 1：检测到重复类型

当你尝试定义一个已存在的类型时：

```typescript
// ❌ 你尝试定义
export interface Todo {
  id: number
  title: string
}
```

**Hook 输出：**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  检测到重复类型定义！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 类型名称: Todo
   已存在 1 处定义，首次定义位置:
   📁 src/shared/schemas/todos.ts:35

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 建议:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 检查上述位置的类型定义是否可以复用
2. 如果需要不同结构，考虑使用 TypeScript 工具类型:
   • Pick<T, K>      - 选择部分字段
   • Omit<T, K>      - 排除部分字段
   • Partial<T>      - 所有字段可选
   • Required<T>     - 所有字段必需

3. 从共享类型导入:
   import type { Todo } from '@shared/types'

4. 查看 .claude/hookify.check-duplicate-types.local.md 了解更多

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 示例 2：正确复用类型

```typescript
// ✅ 正确 - 导入已有类型
import type { Todo } from '@shared/types'

async function getTodo(id: number): Promise<Todo> {
  // ...
}
```

### 示例 3：使用工具类型扩展

```typescript
// ✅ 正确 - 基于已有类型扩展
import type { Todo } from '@shared/types'

// 使用 Pick 提取部分字段
type TodoPreview = Pick<Todo, 'id' | 'title'>

// 使用 Omit 排除字段
type TodoWithoutTimestamps = Omit<Todo, 'createdAt' | 'updatedAt'>

// 使用 Partial 使字段可选
type PartialTodo = Partial<Todo>
```

## 🔧 技术实现

### TypeScript 脚本优势

相比 Bash 脚本，TypeScript 版本具有以下优势：

1. **精确解析** - 使用正则表达式精确匹配类型定义
2. **类型安全** - TypeScript 编译时检查
3. **易于维护** - 清晰的代码结构
4. **可扩展** - 易于添加新功能（如结构相似度检测）
5. **跨平台** - 不依赖特定 shell 环境

### 核心功能

```typescript
// 提取类型名称
function extractTypeNames(text: string): Set<string>

// 在项目中搜索类型
function searchTypeInProject(
  typeName: string,
  projectRoot: string,
  currentFile: string
): Array<{ file: string; line: number }>

// 显示警告信息
function printWarning(duplicates: DuplicateInfo[])
```

## 📚 相关文档

- [API Type Inference Rules](../rules/10-api-type-inference.md)
- [Shared Types Rules](../rules/40-shared-types.md)
- [Server API Validation](../rules/20-server-api.md)

## 🎨 未来改进方向

### 1. 结构相似度检测

检测结构相似但名称不同的类型：

```typescript
// 可能是重复定义
interface UserInfo {
  id: number
  name: string
}

interface UserData {
  id: number
  name: string
}
```

### 2. 类型使用统计

统计每个类型的使用频率，帮助识别最常用的类型。

### 3. 自动导入建议

根据类型名称，自动建议正确的导入语句。

### 4. 类型重构建议

当检测到重复类型时，建议如何重构代码以复用类型。

## 🤝 贡献

如果你有改进建议或发现 bug，欢迎：

1. 提交 Issue
2. 创建 Pull Request
3. 更新文档

## 📄 许可证

MIT License
