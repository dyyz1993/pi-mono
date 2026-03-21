#!/usr/bin/env node

/**
 * 权限检查脚本
 *
 * 这个脚本检查所有路由文件，确保：
 * 1. 每个 createRoute 调用都有权限配置
 * 2. 公开路由被明确标记
 * 3. 非公开路由都有 authMiddleware 或 permissionMiddleware
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PUBLIC_ROUTES = [
  { path: '/api/admin/login', method: 'POST' },
  { path: '/api/admin/register', method: 'POST' },
  { path: '/api/permissions', method: 'GET' },
  { path: '/api/permissions/roles', method: 'GET' },
  { path: '/api/permissions/categories', method: 'GET' },
  { path: '/api/permissions/role-labels', method: 'GET' },
  { path: '/api/permissions/permission-labels', method: 'GET' },
  { path: '/api/permissions/menu-config', method: 'GET' },
  { path: '/api/permissions/page-permissions', method: 'GET' },
  { path: '/health', method: 'GET' },
]

function isPublicRoute(routePath, method) {
  return PUBLIC_ROUTES.some(
    route => route.path === routePath && route.method.toUpperCase() === method.toUpperCase()
  )
}

function extractRouteConfig(content, startIdx) {
  let braceCount = 0
  let inString = false
  let stringChar = null
  let config = ''
  let i = startIdx

  while (i < content.length) {
    const char = content[i]

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true
      stringChar = char
    } else if (inString && char === stringChar && content[i - 1] !== '\\') {
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

  return config
}

function checkRouteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const errors = []
  const warnings = []

  const createRouteRegex = /createRoute\s*\(\s*\{/g
  let match

  while ((match = createRouteRegex.exec(content)) !== null) {
    const startIdx = match.index + match[0].length - 1
    const configStr = extractRouteConfig(content, startIdx)

    const methodMatch = configStr.match(/method:\s*['"`](\w+)['"`]/)
    const pathMatch = configStr.match(/path:\s*['"`]([^'"`]+)['"`]/)
    const hasSecurity = /security:\s*\[/.test(configStr)
    const hasMiddleware = /middleware:\s*\[/.test(configStr)
    const hasAuthMiddleware = /authMiddleware/.test(configStr)
    const hasPermissionMiddleware = /permissionMiddleware/.test(configStr)

    if (!methodMatch || !pathMatch) {
      continue
    }

    const method = methodMatch[1]
    const routePath = pathMatch[1]
    const isPublic = isPublicRoute(routePath, method)

    const lineNum = content.substring(0, match.index).split('\n').length

    if (isPublic) {
      if (hasSecurity || hasMiddleware) {
        warnings.push({
          file: filePath,
          line: lineNum,
          message: `公开路由 ${method} ${routePath} 不应该有 security 或 middleware 配置`,
        })
      }
    } else {
      if (!hasSecurity) {
        errors.push({
          file: filePath,
          line: lineNum,
          message: `路由 ${method} ${routePath} 缺少 security 配置`,
        })
      }

      if (!hasMiddleware) {
        errors.push({
          file: filePath,
          line: lineNum,
          message: `路由 ${method} ${routePath} 缺少 middleware 配置`,
        })
      }

      if (hasMiddleware && !hasAuthMiddleware && !hasPermissionMiddleware) {
        errors.push({
          file: filePath,
          line: lineNum,
          message: `路由 ${method} ${routePath} 的 middleware 中没有 authMiddleware 或 permissionMiddleware`,
        })
      }
    }
  }

  return { errors, warnings }
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

  let totalErrors = 0
  let totalWarnings = 0

  console.log('🔍 检查路由权限配置...\n')

  for (const file of routeFiles) {
    const { errors, warnings } = checkRouteFile(file)

    if (errors.length > 0 || warnings.length > 0) {
      console.log(`📄 ${path.relative(srcDir, file)}`)

      for (const error of errors) {
        console.log(`  ❌ Line ${error.line}: ${error.message}`)
        totalErrors++
      }

      for (const warning of warnings) {
        console.log(`  ⚠️  Line ${warning.line}: ${warning.message}`)
        totalWarnings++
      }

      console.log()
    }
  }

  console.log('==================================================')
  console.log(`📊 检查结果:`)
  console.log(`  ❌ 错误: ${totalErrors}`)
  console.log(`  ⚠️  警告: ${totalWarnings}`)
  console.log('==================================================\n')

  if (totalErrors > 0) {
    console.log('❌ 发现权限配置错误！请修复后再提交代码。')
    process.exit(1)
  } else {
    console.log('✅ 所有路由权限配置正确！')
    process.exit(0)
  }
}

main()
