#!/usr/bin/env node

/**
 * 批量修复路由认证配置脚本
 *
 * 这个脚本会自动为所有缺少认证的路由添加认证中间件
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PUBLIC_ROUTES = [
  { path: '/api/admin/login', method: 'POST' },
  { path: '/api/admin/register', method: 'POST' },
  { path: '/api/captcha', method: 'GET' },
  { path: '/api/verify-captcha', method: 'POST' },
  { path: '/api/permissions', method: 'GET' },
  { path: '/api/permissions/roles', method: 'GET' },
  { path: '/api/permissions/categories', method: 'GET' },
  { path: '/api/permissions/role-labels', method: 'GET' },
  { path: '/api/permissions/permission-labels', method: 'GET' },
  { path: '/api/permissions/menu-config', method: 'GET' },
  { path: '/api/permissions/page-permissions', method: 'GET' },
  { path: '/health', method: 'GET' },
]

// 权限映射表：根据路由路径和方法推断需要的权限
const PERMISSION_MAPPING = {
  notifications: {
    GET: 'NOTIFICATION_VIEW',
    POST: 'NOTIFICATION_CREATE',
    PUT: 'NOTIFICATION_EDIT',
    PATCH: 'NOTIFICATION_EDIT',
    DELETE: 'NOTIFICATION_DELETE',
  },
  todos: {
    GET: 'TODO_VIEW',
    POST: 'TODO_CREATE',
    PUT: 'TODO_EDIT',
    DELETE: 'TODO_DELETE',
  },
  chat: {
    GET: 'CHAT_VIEW',
    POST: 'CHAT_SEND',
  },
}

function isPublicRoute(routePath, method) {
  return PUBLIC_ROUTES.some(
    route => route.path === routePath && route.method.toUpperCase() === method.toUpperCase()
  )
}

function getPermissionForRoute(routePath, method) {
  const pathParts = routePath.split('/').filter(Boolean)
  if (pathParts.length < 2) return null

  const resource = pathParts[1] // /api/notifications -> notifications
  const mapping = PERMISSION_MAPPING[resource]

  if (!mapping) return null

  return mapping[method]
}

function fixRouteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  let modified = false
  let newContent = content

  // 检查是否已经导入了 authMiddleware
  const hasAuthMiddlewareImport = /import.*authMiddleware.*from/.test(content)
  const hasPermissionImport = /import.*Permission.*from/.test(content)

  // 如果需要添加导入
  if (!hasAuthMiddlewareImport || !hasPermissionImport) {
    const importLine = content.match(/import.*from.*route-helpers/)
    if (importLine) {
      const newImportLines = []
      if (!hasAuthMiddlewareImport) {
        newImportLines.push("import { authMiddleware } from '../../middleware/auth'")
      }
      if (!hasPermissionImport) {
        newImportLines.push("import { Permission } from '@shared/modules/permission'")
      }
      newContent = newContent.replace(
        importLine[0],
        importLine[0] + '\n' + newImportLines.join('\n')
      )
      modified = true
    }
  }

  // 查找所有 createRoute 调用
  const createRouteRegex = /const\s+(\w+)\s*=\s*createRoute\s*\(\s*\{/g
  let match

  while ((match = createRouteRegex.exec(newContent)) !== null) {
    const routeName = match[1]
    const startIdx = match.index + match[0].length - 1

    // 提取路由配置
    let braceCount = 0
    let inString = false
    let stringChar = null
    let config = ''
    let i = startIdx

    while (i < newContent.length) {
      const char = newContent[i]

      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true
        stringChar = char
      } else if (inString && char === stringChar && newContent[i - 1] !== '\\') {
        inString = false
        stringChar = null
      }

      if (!inString) {
        if (char === '{') {
          braceCount++
        } else if (char === '}') {
          braceCount--
          if (braceCount === 0) {
            config += char
            break
          }
        }
      }

      config += char
      i++
    }

    // 提取 method 和 path
    const methodMatch = config.match(/method:\s*['"`](\w+)['"`]/)
    const pathMatch = config.match(/path:\s*['"`]([^'"`]+)['"`]/)
    const hasMiddleware = /middleware:\s*\[/.test(config)
    const hasSecurity = /security:\s*\[/.test(config)

    if (!methodMatch || !pathMatch) continue

    const method = methodMatch[1]
    const routePath = pathMatch[1]

    // 如果是公开路由，跳过
    if (isPublicRoute(routePath, method)) continue

    // 如果已经有 middleware，跳过
    if (hasMiddleware) continue

    // 获取权限
    const permission = getPermissionForRoute(routePath, method)

    if (!permission) {
      console.log(`⚠️  无法推断权限: ${method} ${routePath}`)
      continue
    }

    // 添加 security 和 middleware
    const tagsMatch = config.match(/tags:\s*\[[^\]]*\]/)
    if (tagsMatch) {
      const securityLine = 'security: [{ Bearer: [] }],'
      const middlewareLine = `middleware: [authMiddleware({ requiredPermissions: [Permission.${permission}] })],`

      const newConfig = config.replace(
        tagsMatch[0],
        tagsMatch[0] + '\n  ' + securityLine + '\n  ' + middlewareLine
      )

      newContent = newContent.replace(config, newConfig)
      modified = true

      console.log(`✅ 添加认证: ${method} ${routePath} -> Permission.${permission}`)
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, newContent, 'utf-8')
    return true
  }

  return false
}

function findRouteFiles(dir) {
  const files = []

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('-routes.ts') || entry.name.endsWith('-route.ts'))
      ) {
        files.push(fullPath)
      }
    }
  }

  walk(dir)
  return files
}

function main() {
  const srcDir = path.join(__dirname, '..', 'src')
  const routeFiles = findRouteFiles(srcDir)

  console.log('🔧 批量修复路由认证配置...\n')

  let fixedCount = 0

  for (const file of routeFiles) {
    const fixed = fixRouteFile(file)
    if (fixed) {
      console.log(`📄 已修复: ${path.relative(srcDir, file)}`)
      fixedCount++
    }
  }

  console.log('\n==================================================')
  console.log(`📊 修复结果:`)
  console.log(`  📁 检查了 ${routeFiles.length} 个路由文件`)
  console.log(`  ✅ 修复了 ${fixedCount} 个文件`)
  console.log('==================================================\n')

  if (fixedCount > 0) {
    console.log('✅ 已修复部分路由认证配置！')
    console.log('⚠️  请手动检查修复后的代码，确保权限配置正确。')
  } else {
    console.log('✅ 所有路由认证配置正确！')
  }
}

main()
