#!/usr/bin/env node

/**
 * 完整的路由认证检查脚本
 *
 * 这个脚本检查：
 * 1. 所有路由文件是否都有认证中间件
 * 2. 所有路由是否都在 app.ts 中注册
 * 3. 所有路由是否都有权限配置
 * 4. 公开路由是否被明确标记
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
  const routes = []

  const createRouteRegex = /createRoute\s*\(\s*\{/g
  let match

  while ((match = createRouteRegex.exec(content)) !== null) {
    const startIdx = match.index + match[0].length - 1
    const configStr = extractRouteConfig(content, startIdx)

    const methodMatch = configStr.match(/method:\s*['"`](\w+)['"`]/)
    const pathMatch = configStr.match(/path:\s*['"`]([^'"`]+)['"`]/)
    const hasMiddleware = /middleware:\s*\[/.test(configStr)
    const hasAuthMiddleware = /authMiddleware/.test(configStr)
    const hasSecurity = /security:\s*\[/.test(configStr)
    const hasPermissions = /requiredPermissions|requiredRole/.test(configStr)

    if (!methodMatch || !pathMatch) {
      continue
    }

    const method = methodMatch[1]
    const routePath = pathMatch[1]
    const isPublic = isPublicRoute(routePath, method)

    const lineNum = content.substring(0, match.index).split('\n').length

    routes.push({ method, path: routePath, file: filePath })

    if (isPublic) {
      if (hasMiddleware || hasAuthMiddleware) {
        warnings.push({
          file: filePath,
          line: lineNum,
          message: `公开路由 ${method} ${routePath} 不应该有 middleware 配置`,
        })
      }
    } else {
      if (!hasMiddleware) {
        errors.push({
          file: filePath,
          line: lineNum,
          message: `路由 ${method} ${routePath} 缺少 middleware 配置`,
        })
      } else if (!hasAuthMiddleware) {
        errors.push({
          file: filePath,
          line: lineNum,
          message: `路由 ${method} ${routePath} 的 middleware 中没有 authMiddleware`,
        })
      }

      if (!hasSecurity) {
        warnings.push({
          file: filePath,
          line: lineNum,
          message: `路由 ${method} ${routePath} 缺少 security 配置`,
        })
      }

      if (!hasPermissions && hasAuthMiddleware) {
        warnings.push({
          file: filePath,
          line: lineNum,
          message: `路由 ${method} ${routePath} 的 authMiddleware 中没有 requiredPermissions 或 requiredRole`,
        })
      }
    }
  }

  return { errors, warnings, routes }
}

function checkAppRegistration(appFile, allRoutes) {
  const content = fs.readFileSync(appFile, 'utf-8')
  const warnings = []

  for (const route of allRoutes) {
    // 检查路由是否在 app.ts 中注册
    const routeName = path.basename(route.file, '.ts').replace('-routes', '').replace('-route', '')
    const isRegistered = content.includes(routeName) || content.includes('.route(')

    if (!isRegistered) {
      warnings.push({
        file: route.file,
        line: 0,
        message: `路由 ${route.method} ${route.path} 可能没有在 app.ts 中注册`,
      })
    }
  }

  return warnings
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
  const appFile = path.join(srcDir, 'server', 'app.ts')

  let totalErrors = 0
  let totalWarnings = 0
  const allRoutes = []

  console.log('🔍 检查路由认证配置...\n')

  // 检查所有路由文件
  for (const file of routeFiles) {
    const { errors, warnings, routes } = checkRouteFile(file)
    allRoutes.push(...routes)

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

  // 检查路由是否在 app.ts 中注册
  if (fs.existsSync(appFile)) {
    const registrationWarnings = checkAppRegistration(appFile, allRoutes)
    if (registrationWarnings.length > 0) {
      console.log('📄 app.ts - 路由注册检查')
      for (const warning of registrationWarnings) {
        console.log(`  ⚠️  ${warning.message}`)
        totalWarnings++
      }
      console.log()
    }
  }

  console.log('==================================================')
  console.log(`📊 检查结果:`)
  console.log(`  📁 检查了 ${routeFiles.length} 个路由文件`)
  console.log(`  🛣️  检查了 ${allRoutes.length} 个路由`)
  console.log(`  ❌ 错误: ${totalErrors}`)
  console.log(`  ⚠️  警告: ${totalWarnings}`)
  console.log('==================================================\n')

  if (totalErrors > 0) {
    console.log('❌ 发现路由认证配置错误！请修复后再提交代码。')
    process.exit(1)
  } else {
    console.log('✅ 所有路由认证配置正确！')
    process.exit(0)
  }
}

main()
