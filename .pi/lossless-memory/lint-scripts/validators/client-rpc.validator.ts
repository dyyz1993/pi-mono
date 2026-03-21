/**
 * 客户端 RPC 调用验证器
 *
 * 检查客户端代码是否符合 API 调用规范：
 * 1. 必须使用 apiClient 进行 API 调用
 * 2. 必须使用类型安全的方法（$get, $post, $ws, $sse 等）
 * 3. 禁止直接使用 fetch 调用内部 API
 * 4. 禁止直接使用 WebSocket/EventSource
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ClientRPCConfig, ClientRPCError } from './index.js'

export function validateClientRPCInFile(
  filePath: string,
  rootPath: string,
  config: ClientRPCConfig,
  fileContent?: string
): ClientRPCError[] {
  const content = fileContent || readFileSync(filePath, 'utf-8')
  const errors: ClientRPCError[] = []

  if (config.forbidDirectFetch) {
    const fetchPattern = /(?:await\s+)?fetch\s*\(\s*['"`](\/api\/|\/ws\/)/g
    let match
    while ((match = fetchPattern.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length
      const matchedText = match[0]

      errors.push({
        file: relative(rootPath, filePath),
        line: lineNumber,
        message: `Direct fetch() call to internal API detected: ${matchedText}`,
        suggestion: `Use apiClient instead: apiClient.api.todos.$get()`,
      })
    }
  }

  if (config.requireAPIClient) {
    const hasAPIClientImport =
      /import\s+.*apiClient.*from\s+['"]@client\/services\/apiClient['"]/.test(content)
    const hasAPIClientUsage = /apiClient\s*\.\s*api\s*\./.test(content)

    const hasAPIPathUsage = /['"`](\/api\/\w+)['"`]/.test(content)

    if (hasAPIPathUsage && !hasAPIClientImport && !hasAPIClientUsage) {
      const lineNumber = content.split('\n').findIndex(line => /['"`]\/api\//.test(line)) + 1
      errors.push({
        file: relative(rootPath, filePath),
        line: lineNumber || 1,
        message: 'API path detected but apiClient is not used',
        suggestion: `Import and use apiClient: import { apiClient } from '@client/services/apiClient'`,
      })
    }
  }

  if (config.requireAPIClient) {
    const nonTypeSafePattern = /apiClient\s*\.\s*api\s*\.\s*\w+\s*\(\s*\)/g
    let match
    while ((match = nonTypeSafePattern.exec(content)) !== null) {
      const matchedText = match[0]
      if (!matchedText.includes('$')) {
        const lineNumber = content.substring(0, match.index).split('\n').length
        errors.push({
          file: relative(rootPath, filePath),
          line: lineNumber,
          message: `Non-type-safe API method call: ${matchedText}`,
          suggestion: `Use type-safe method with $ prefix: apiClient.api.todos.$get()`,
        })
      }
    }
  }

  if (config.forbidDirectWebSocket !== false) {
    const wsPattern = /new\s+WebSocket\s*\(/g
    let match
    while ((match = wsPattern.exec(content)) !== null) {
      const lineNumber = content.substring(0, match.index).split('\n').length
      errors.push({
        file: relative(rootPath, filePath),
        line: lineNumber,
        message: 'Direct new WebSocket() is not allowed',
        suggestion: `Use type-safe $ws() method: apiClient.api.chat.ws.$ws()`,
      })
    }
  }

  if (config.forbidDirectEventSource !== false) {
    const isImplementationFile =
      filePath.endsWith('wsClient.ts') ||
      filePath.endsWith('sseClient.ts') ||
      filePath.includes('/services/wsClient.ts') ||
      filePath.includes('/services/sseClient.ts')

    if (!isImplementationFile) {
      const ssePattern = /new\s+EventSource\s*\(/g
      let match
      while ((match = ssePattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split('\n').length
        errors.push({
          file: relative(rootPath, filePath),
          line: lineNumber,
          message: 'Direct new EventSource() is not allowed',
          suggestion: `Use type-safe $sse() method: await apiClient.api.notifications.stream.$sse()`,
        })
      }
    }
  }

  return errors
}

function scanDirectory(
  rootPath: string,
  targetDir: string,
  config: ClientRPCConfig
): ClientRPCError[] {
  const errors: ClientRPCError[] = []
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
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const fileErrors = validateClientRPCInFile(fullPath, rootPath, config)
        errors.push(...fileErrors)
      }
    }
  }

  scanDir(targetPath)
  return errors
}

export function validateClientRPC(config: ClientRPCConfig, rootPath: string): ClientRPCError[] {
  const allErrors: ClientRPCError[] = []

  for (const dir of config.checkDirs) {
    const errors = scanDirectory(rootPath, dir, config)
    allErrors.push(...errors)
  }

  return allErrors
}

export function formatClientRPCErrors(errors: ClientRPCError[]): string {
  if (errors.length === 0) return ''

  let output = `❌ Found ${errors.length} client RPC usage error(s):\n\n`

  for (const err of errors) {
    output += `  ${err.file}:${err.line}\n`
    output += `    Error: ${err.message}\n`
    output += `    Suggestion: ${err.suggestion}\n\n`
  }

  output += '📋 Client RPC Guidelines:\n'
  output += '  ✅ DO: Use apiClient with type-safe methods\n'
  output += "    import { apiClient } from '@client/services/apiClient'\n"
  output += '    const response = await apiClient.api.todos.$get()\n'
  output += '    const result = await response.json()\n\n'
  output += '  ✅ DO: Use $ws() for WebSocket\n'
  output += '    const ws = apiClient.api.chat.ws.$ws()\n'
  output += '    const result = await ws.call("echo", { message: "hello" })\n\n'
  output += '  ✅ DO: Use $sse() for SSE\n'
  output += '    const conn = await apiClient.api.notifications.stream.$sse()\n'
  output += '    conn.on("notification", (n) => { ... })\n\n'
  output += "  ❌ DON'T: Use direct fetch for internal APIs\n"
  output += "    const response = await fetch('/api/todos')\n\n"
  output += "  ❌ DON'T: Use non-type-safe methods\n"
  output += '    apiClient.api.todos()  // Missing $ prefix\n\n'
  output += "  ❌ DON'T: Use direct WebSocket/EventSource\n"
  output += '    new WebSocket(...)  // Use $ws() instead\n'
  output += '    new EventSource(...)  // Use $sse() instead\n\n'
  output += '  📖 See: .claude/rules/client-service-rules.md\n'

  return output
}
