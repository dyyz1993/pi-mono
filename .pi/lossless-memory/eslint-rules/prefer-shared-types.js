import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SHARED_TYPES_CACHE = new Map()
let cacheTimestamp = 0
const CACHE_TTL = 5000

function extractFieldNamesFromZodObject(node) {
  const fields = new Set()
  
  if (node.type !== 'CallExpression') return null
  
  const { callee } = node
  if (
    callee.type !== 'MemberExpression' ||
    callee.object?.type !== 'Identifier' ||
    callee.object.name !== 'z' ||
    callee.property?.type !== 'Identifier' ||
    callee.property.name !== 'object'
  ) {
    return null
  }
  
  const args = node.arguments
  if (!args || args.length === 0) return null
  
  const objectArg = args[0]
  if (objectArg.type !== 'ObjectExpression') return null
  
  for (const prop of objectArg.properties) {
    if (prop.type === 'Property' && prop.key?.type === 'Identifier') {
      fields.add(prop.key.name)
    }
  }
  
  return fields
}

function parseSchemaFile(content) {
  const schemaMap = new Map()
  
  const schemaVarMatch = content.matchAll(
    /export\s+const\s+(\w+Schema)\s*=\s*z\.object\s*\(\s*\{([^}]+)\}/gs
  )
  
  for (const match of schemaVarMatch) {
    const schemaName = match[1]
    const fieldsBlock = match[2]
    
    const fields = new Set()
    const fieldMatches = fieldsBlock.matchAll(/(\w+)\s*:/g)
    for (const fm of fieldMatches) {
      fields.add(fm[1])
    }
    
    if (fields.size > 0) {
      schemaMap.set(schemaName, fields)
    }
  }
  
  const typeExportMatch = content.matchAll(
    /export\s+type\s+(\w+)\s*=\s*z\.infer<typeof\s+(\w+Schema)>/g
  )
  
  const typeToSchema = new Map()
  for (const match of typeExportMatch) {
    const typeName = match[1]
    const schemaName = match[2]
    typeToSchema.set(typeName, schemaName)
  }
  
  return { schemaMap, typeToSchema }
}

function getSharedTypes(context) {
  const now = Date.now()
  if (SHARED_TYPES_CACHE.size > 0 && now - cacheTimestamp < CACHE_TTL) {
    return SHARED_TYPES_CACHE
  }
  
  SHARED_TYPES_CACHE.clear()
  
  const cwd = context.cwd || process.cwd()
  
  const schemaFiles = [
    resolve(cwd, 'src/shared/modules/todos/schemas.ts'),
    resolve(cwd, 'src/shared/modules/notifications/schemas.ts'),
    resolve(cwd, 'src/shared/modules/chat/index.ts'),
  ]
  
  const allTypeToSchema = new Map()
  const allSchemaFields = new Map()
  
  for (const filePath of schemaFiles) {
    if (!existsSync(filePath)) continue
    
    try {
      const content = readFileSync(filePath, 'utf-8')
      const { schemaMap, typeToSchema } = parseSchemaFile(content)
      
      for (const [typeName, schemaName] of typeToSchema) {
        allTypeToSchema.set(typeName, schemaName)
      }
      
      for (const [schemaName, fields] of schemaMap) {
        allSchemaFields.set(schemaName, fields)
      }
    } catch {
      // ignore read errors
    }
  }
  
  for (const [typeName, schemaName] of allTypeToSchema) {
    const fields = allSchemaFields.get(schemaName)
    if (fields) {
      SHARED_TYPES_CACHE.set(typeName, {
        schemaName,
        fields: [...fields],
      })
    }
  }
  
  cacheTimestamp = now
  return SHARED_TYPES_CACHE
}

function calculateSimilarity(fields1, fields2) {
  if (fields1.size === 0 || fields2.size === 0) return 0
  
  const set1 = new Set(fields1)
  const set2 = new Set(fields2)
  
  const intersection = new Set([...set1].filter(x => set2.has(x)))
  const union = new Set([...set1, ...set2])
  
  return intersection.size / union.size
}

function extractFieldsFromTSInterface(node) {
  const fields = new Set()
  
  if (node.type !== 'TSInterfaceDeclaration') return null
  
  for (const member of node.body.body) {
    if (member.type === 'TSPropertySignature' && member.key?.type === 'Identifier') {
      fields.add(member.key.name)
    }
  }
  
  return fields
}

function extractFieldsFromTSTypeAlias(node, context) {
  const fields = new Set()
  
  if (node.type !== 'TSTypeAliasDeclaration') return null
  
  const typeAnnotation = node.typeAnnotation
  
  if (typeAnnotation?.type === 'TSTypeLiteral') {
    for (const member of typeAnnotation.members) {
      if (member.type === 'TSPropertySignature' && member.key?.type === 'Identifier') {
        fields.add(member.key.name)
      }
    }
  }
  
  return fields.size > 0 ? fields : null
}

export const preferSharedTypes = {
  meta: {
    type: 'suggestion',
    docs: {
      description: '检测与 @shared/schemas 中结构相似的类型定义，建议直接导入',
      recommended: true,
    },
    messages: {
      similarTypeDetected:
        '类型 "{{typeName}}" 的结构 (字段: {{fields}}) 与 @shared/schemas 中的 "{{sharedTypeName}}" (字段: {{sharedFields}}) 相似度 {{similarity}}%。\n' +
        '建议直接导入: `import type { {{sharedTypeName}} } from "@shared/schemas"`',
      duplicateTypeDetected:
        '类型 "{{typeName}}" 已存在于 @shared/schemas 中。\n' +
        '请直接导入: `import type { {{typeName}} } from "@shared/schemas"`',
    },
    schema: [
      {
        type: 'object',
        properties: {
          similarityThreshold: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.6,
          },
          checkClientOnly: {
            type: 'boolean',
            default: true,
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {}
    const similarityThreshold = options.similarityThreshold ?? 0.6
    const checkClientOnly = options.checkClientOnly ?? true
    
    const filename = context.filename || context.getFilename?.() || ''
    
    const isClientFile = filename.includes('/src/client/')
    const isSharedFile = filename.includes('/src/shared/')
    
    if (checkClientOnly && !isClientFile) return {}
    if (isSharedFile) return {}
    
    const sharedTypes = getSharedTypes(context)
    
    return {
      TSInterfaceDeclaration(node) {
        const typeName = node.id?.name
        if (!typeName) return
        
        const fields = extractFieldsFromTSInterface(node)
        if (!fields || fields.size === 0) return
        
        if (sharedTypes.has(typeName)) {
          context.report({
            node,
            messageId: 'duplicateTypeDetected',
            data: { typeName },
          })
          return
        }
        
        for (const [sharedTypeName, info] of sharedTypes) {
          const sharedFields = new Set(info.fields)
          const similarity = calculateSimilarity(fields, sharedFields)
          
          if (similarity >= similarityThreshold) {
            context.report({
              node,
              messageId: 'similarTypeDetected',
              data: {
                typeName,
                fields: [...fields].slice(0, 5).join(', ') + (fields.size > 5 ? '...' : ''),
                sharedTypeName,
                sharedFields: [...sharedFields].slice(0, 5).join(', ') + (sharedFields.size > 5 ? '...' : ''),
                similarity: Math.round(similarity * 100),
              },
            })
            break
          }
        }
      },
      
      TSTypeAliasDeclaration(node) {
        const typeName = node.id?.name
        if (!typeName) return
        
        const fields = extractFieldsFromTSTypeAlias(node, context)
        if (!fields || fields.size === 0) return
        
        if (sharedTypes.has(typeName)) {
          context.report({
            node,
            messageId: 'duplicateTypeDetected',
            data: { typeName },
          })
          return
        }
        
        for (const [sharedTypeName, info] of sharedTypes) {
          const sharedFields = new Set(info.fields)
          const similarity = calculateSimilarity(fields, sharedFields)
          
          if (similarity >= similarityThreshold) {
            context.report({
              node,
              messageId: 'similarTypeDetected',
              data: {
                typeName,
                fields: [...fields].slice(0, 5).join(', ') + (fields.size > 5 ? '...' : ''),
                sharedTypeName,
                sharedFields: [...sharedFields].slice(0, 5).join(', ') + (sharedFields.size > 5 ? '...' : ''),
                similarity: Math.round(similarity * 100),
              },
            })
            break
          }
        }
      },
    }
  },
}

export default preferSharedTypes
