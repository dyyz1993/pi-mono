/**
 * 服务端 RPC 规范验证器
 *
 * 检查服务端路由文件是否符合 Hono RPC 规范：
 * 1. 必须使用 OpenAPIHono 链式语法
 * 2. 禁止非链式调用
 * 3. 必须导出路由类型
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ServerRPCConfig, ServerRPCError } from './index.js'

export function validateServerRPCInFile(
  filePath: string,
  rootPath: string,
  config: ServerRPCConfig,
  fileContent?: string
): ServerRPCError[] {
  const content = fileContent || readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const errors: ServerRPCError[] = []

  const hasOpenAPIHono = content.includes('OpenAPIHono')
  if (!hasOpenAPIHono) return errors

  const chainSyntaxPattern = /new\s+OpenAPIHono\s*\(\s*\)\s*\n?\s*\./
  const nonChainPattern = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+OpenAPIHono\s*\(\s*\)/

  const chainMatch = content.match(chainSyntaxPattern)
  const nonChainMatch = content.match(nonChainPattern)

  if (nonChainMatch && !chainMatch) {
    const variableName = nonChainMatch[1]
    const lineNumber = content.substring(0, nonChainMatch.index!).split('\n').length

    errors.push({
      file: relative(rootPath, filePath),
      line: lineNumber,
      message: `Non-chain syntax detected: variable '${variableName}' is assigned but not using chain syntax`,
      suggestion: `Use chain syntax: export const routes = new OpenAPIHono()\n  .openapi(route1, handler1)\n  .openapi(route2, handler2)`,
    })

    const standaloneOpenapiPattern = new RegExp(`${variableName}\\s*\\.\\s*openapi\\s*\\(`, 'g')
    let match
    while ((match = standaloneOpenapiPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length
      errors.push({
        file: relative(rootPath, filePath),
        line: lineNum,
        message: `Standalone .openapi() call on variable '${variableName}'`,
        suggestion: `Chain the .openapi() calls directly after new OpenAPIHono()`,
      })
    }
  }

  if (config.requireTypeExport) {
    const hasTypeExport = /export\s+(?:type|const)\s+\w+/.test(content)
    const hasExportDefault = /export\s+(?:const|default)\s+\w+/.test(content)

    if (!hasTypeExport && !hasExportDefault && chainMatch) {
      const lineNumber = lines.length
      errors.push({
        file: relative(rootPath, filePath),
        line: lineNumber,
        message: 'Route file does not export route type or instance',
        suggestion: `Export the route: export const apiRoutes = new OpenAPIHono()... or export type { RoutesType }`,
      })
    }
  }

  return errors
}

function scanDirectory(
  rootPath: string,
  targetDir: string,
  config: ServerRPCConfig
): ServerRPCError[] {
  const errors: ServerRPCError[] = []
  const targetPath = join(rootPath, targetDir)

  if (!existsSync(targetPath)) {
    return errors
  }

  function scanDir(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!config.ignoreDirs.includes(entry.name)) {
          scanDir(fullPath)
        }
      } else if (entry.isFile() && entry.name.includes('routes') && entry.name.endsWith('.ts')) {
        const fileErrors = validateServerRPCInFile(fullPath, rootPath, config)
        errors.push(...fileErrors)
      }
    }
  }

  scanDir(targetPath)
  return errors
}

export function validateServerRPC(config: ServerRPCConfig, rootPath: string): ServerRPCError[] {
  const allErrors: ServerRPCError[] = []

  for (const dir of config.checkDirs) {
    const errors = scanDirectory(rootPath, dir, config)
    allErrors.push(...errors)
  }

  return allErrors
}

export function formatServerRPCErrors(errors: ServerRPCError[]): string {
  if (errors.length === 0) return ''

  let output = `❌ Found ${errors.length} server RPC pattern error(s):\n\n`

  for (const err of errors) {
    output += `  ${err.file}:${err.line}\n`
    output += `    Error: ${err.message}\n`
    output += `    Suggestion: ${err.suggestion}\n\n`
  }

  output += '📋 Server RPC Guidelines:\n'
  output += '  ✅ DO: Use chain syntax with OpenAPIHono\n'
  output += '    export const apiRoutes = new OpenAPIHono()\n'
  output += '      .openapi(route1, handler1)\n'
  output += '      .openapi(route2, handler2)\n\n'
  output += "  ❌ DON'T: Use standalone variable assignment\n"
  output += '    const app = new OpenAPIHono()\n'
  output += '    app.openapi(route1, handler1)\n\n'
  output += '  📖 See: .claude/rules/api-type-inference-rules.md\n'

  return output
}
