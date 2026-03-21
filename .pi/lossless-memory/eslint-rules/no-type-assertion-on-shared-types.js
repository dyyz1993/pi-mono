/**
 * 自定义 ESLint 规则：禁止对 @shared/modules 导入的类型使用 `as` 类型断言
 *
 * 从 @shared/modules 导入的类型应该是类型安全的。
 * 如果需要使用 `as` 断言，说明服务端类型定义有问题。
 *
 * 错误示例:
 *   import { User, Permission } from '@shared/modules/admin'
 *   const user = data as User              // ❌ 禁止
 *   setPermissions(data.permissions as Permission[])  // ❌ 禁止
 *
 * 正确示例:
 *   // 修复服务端类型定义，让 API 返回正确的类型
 *   const user: User = data                // ✅ 类型注解
 *   setPermissions(data.permissions)       // ✅ 类型推断正确
 */

export const noTypeAssertionOnSharedTypes = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow `as` type assertion on types imported from @shared/modules',
      recommended: true,
    },
    messages: {
      noTypeAssertionOnSharedTypes:
        '🚫 禁止对从 @shared/modules 导入的类型使用 `as` 类型断言！\n\n' +
        '类型: {{typeName}}\n\n' +
        '这通常意味着服务端类型定义与客户端不匹配。请检查以下内容：\n\n' +
        '1. 服务端 Schema 定义是否正确？\n' +
        '   ✅ 确保使用 z.enum() 定义枚举类型\n' +
        '   ✅ 确保数组使用 .array() 方法\n' +
        '   ✅ 确保可选字段使用 .optional()\n\n' +
        '2. 服务端路由是否正确返回类型？\n' +
        '   ✅ successResponse(data) 返回的类型应该匹配 Schema\n\n' +
        '3. 类型是否正确导出？\n' +
        '   ✅ export type Xxx = z.infer<typeof XxxSchema>\n\n' +
        '📖 相关文档：\n' +
        '   - .claude/rules/40-shared-types.md - 共享类型规范\n' +
        '   - .claude/rules/10-api-type-inference.md - API 类型推导规范\n\n' +
        '💡 建议：修复服务端类型定义，而不是使用 `as` 断言。',
    },
    schema: [],
  },
  create(context) {
    const sharedTypes = new Set()

    return {
      ImportDeclaration(node) {
        if (!node.source || node.source.type !== 'Literal') return

        const source = node.source.value
        if (typeof source !== 'string') return

        // 检查是否从 @shared/modules 导入
        if (source.startsWith('@shared/modules') || source === '@shared/modules') {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportSpecifier') {
              sharedTypes.add(specifier.local.name)
            }
          }
        }
      },

      TSAsExpression(node) {
        const typeAnnotation = node.typeAnnotation
        if (!typeAnnotation) return

        // 获取类型名称
        let typeName = ''
        if (typeAnnotation.type === 'TSTypeReference') {
          if (typeAnnotation.typeName.type === 'Identifier') {
            typeName = typeAnnotation.typeName.name
          } else if (typeAnnotation.typeName.type === 'TSQualifiedName') {
            // 处理 Permission[] 这样的数组类型
            const left = typeAnnotation.typeName.left
            if (left.type === 'Identifier') {
              typeName = left.name
            }
          }
        } else if (typeAnnotation.type === 'TSArrayType') {
          // 处理数组类型
          const elementType = typeAnnotation.elementType
          if (elementType.type === 'TSTypeReference' && elementType.typeName.type === 'Identifier') {
            typeName = elementType.typeName.name
          }
        }

        // 检查是否是对 @shared/modules 导入的类型使用 as 断言
        if (typeName && sharedTypes.has(typeName)) {
          context.report({
            node,
            messageId: 'noTypeAssertionOnSharedTypes',
            data: { typeName },
          })
        }
      },
    }
  },
}

export default noTypeAssertionOnSharedTypes
