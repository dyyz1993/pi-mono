#!/usr/bin/env node

/**
 * 菜单权限检查脚本
 *
 * 这个脚本检查菜单配置，确保：
 * 1. 每个菜单项都有权限配置
 * 2. 权限配置不为空数组（除非是公开菜单）
 * 3. 权限配置的权限都存在
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PUBLIC_MENUS = ['/dashboard']

const REQUIRED_PERMISSIONS = {
  '/users': ['user:view'],
  '/orders': ['order:view'],
  '/tickets': ['ticket:view'],
  '/disputes': ['ticket:view'],
  '/content': ['content:view'],
  '/system/settings': ['system:settings'],
  '/system/logs': ['system:logs'],
  '/system/monitor': ['system:monitor'],
  '/system/permissions': ['role:view'],
  '/system/roles': ['role:view'],
}

function extractMenuConfig(content) {
  const menuConfigMatch = content.match(/const MENU_CONFIG:\s*MenuItem\[\]\s*=\s*\[/)
  if (!menuConfigMatch) {
    return null
  }

  let braceCount = 0
  let inString = false
  let stringChar = null
  let config = ''
  let i = menuConfigMatch.index + menuConfigMatch[0].length - 1

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
      if (char === '[') {
        braceCount++
      } else if (char === ']') {
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

function parseMenuItems(configStr) {
  const items = []
  const itemRegex = /{\s*path:\s*['"`]([^'"`]+)['"`]/g
  let match

  while ((match = itemRegex.exec(configStr)) !== null) {
    const path = match[1]
    const itemStart = match.index
    const itemEnd = findItemEnd(configStr, itemStart)
    const itemStr = configStr.substring(itemStart, itemEnd)

    const permissionsMatch = itemStr.match(/permissions:\s*\[([^\]]*)\]/)
    const permissions = permissionsMatch
      ? permissionsMatch[1]
          .split(',')
          .map(p => p.trim().replace(/['"`]/g, ''))
          .filter(p => p && p !== 'Permission.')
      : []

    const labelMatch = itemStr.match(/label:\s*['"`]([^'"`]+)['"`]/)
    const label = labelMatch ? labelMatch[1] : ''

    items.push({ path, label, permissions, itemStr })
  }

  return items
}

function findItemEnd(str, start) {
  let braceCount = 0
  let inString = false
  let stringChar = null

  for (let i = start; i < str.length; i++) {
    const char = str[i]

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true
      stringChar = char
    } else if (inString && char === stringChar && str[i - 1] !== '\\') {
      inString = false
      stringChar = null
    }

    if (!inString) {
      if (char === '{') {
        braceCount++
      } else if (char === '}') {
        braceCount--
        if (braceCount === 0) {
          return i + 1
        }
      }
    }
  }

  return str.length
}

function checkMenuPermissions(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const errors = []
  const warnings = []

  const menuConfig = extractMenuConfig(content)
  if (!menuConfig) {
    warnings.push({
      file: filePath,
      message: '未找到 MENU_CONFIG 配置',
    })
    return { errors, warnings }
  }

  const items = parseMenuItems(menuConfig)

  for (const item of items) {
    const isPublic = PUBLIC_MENUS.includes(item.path)

    if (isPublic) {
      if (item.permissions.length > 0) {
        warnings.push({
          file: filePath,
          path: item.path,
          label: item.label,
          message: `公开菜单 "${item.label}" (${item.path}) 不应该有权限配置`,
        })
      }
    } else {
      if (item.permissions.length === 0) {
        const requiredPerms = REQUIRED_PERMISSIONS[item.path] || []
        errors.push({
          file: filePath,
          path: item.path,
          label: item.label,
          message: `菜单 "${item.label}" (${item.path}) 缺少权限配置。建议添加: [${requiredPerms.map(p => `Permission.${p.toUpperCase().replace(/:/g, '_')}`).join(', ')}]`,
        })
      } else {
        const requiredPerms = REQUIRED_PERMISSIONS[item.path] || []
        const missingPerms = requiredPerms.filter(p => {
          const permCode = `Permission.${p.toUpperCase().replace(/:/g, '_')}`
          return !item.permissions.some(perm => perm.includes(p.toUpperCase().replace(/:/g, '_')))
        })

        if (missingPerms.length > 0) {
          warnings.push({
            file: filePath,
            path: item.path,
            label: item.label,
            message: `菜单 "${item.label}" (${item.path}) 缺少推荐权限: [${missingPerms.map(p => `Permission.${p.toUpperCase().replace(/:/g, '_')}`).join(', ')}]`,
          })
        }
      }
    }
  }

  return { errors, warnings }
}

function main() {
  const srcDir = path.join(__dirname, '..', 'src')
  const menuConfigFile = path.join(
    srcDir,
    'server',
    'module-permission',
    'services',
    'permission-service.ts'
  )

  console.log('🔍 检查菜单权限配置...\n')

  if (!fs.existsSync(menuConfigFile)) {
    console.log('❌ 未找到菜单配置文件:', menuConfigFile)
    process.exit(1)
  }

  const { errors, warnings } = checkMenuPermissions(menuConfigFile)

  if (errors.length > 0 || warnings.length > 0) {
    console.log(`📄 ${path.relative(path.join(__dirname, '..'), menuConfigFile)}\n`)

    for (const error of errors) {
      console.log(`  ❌ ${error.message}`)
    }

    for (const warning of warnings) {
      console.log(`  ⚠️  ${warning.message}`)
    }

    console.log()
  }

  console.log('==================================================')
  console.log(`📊 检查结果:`)
  console.log(`  ❌ 错误: ${errors.length}`)
  console.log(`  ⚠️  警告: ${warnings.length}`)
  console.log('==================================================\n')

  if (errors.length > 0) {
    console.log('❌ 发现菜单权限配置错误！请修复后再提交代码。')
    process.exit(1)
  } else {
    console.log('✅ 所有菜单权限配置正确！')
    process.exit(0)
  }
}

main()
