import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

interface CacheEntry {
  mtime: number
  size: number
  hash: string
}

const hashCache = new Map<string, CacheEntry>()

const FRAMEWORK_PATTERNS = [
  '/shared/core/',
  '/server/core/',
  '/server/entries/',
  '/server/test-utils/',
  '/server/index.ts',
  '/client/services/',
  'eslint.config.js',
  'eslint-rules/',
]

const FRAMEWORK_FILES = ['eslint.config.js']

export function isFrameworkFile(filePath: string): boolean {
  if (FRAMEWORK_PATTERNS.some(p => filePath.includes(p))) {
    return true
  }

  const normalizedPath = filePath?.replace(/\\/g, '/') ?? ''
  const fileName = normalizedPath.split('/').pop() ?? ''

  if (FRAMEWORK_FILES.includes(fileName)) {
    return true
  }

  if (normalizedPath.includes('/eslint-rules/')) {
    return true
  }

  return false
}

export function computeContentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 16)
}

export function computeFileHash(filePath: string): string {
  const stat = fs.statSync(filePath)
  const cached = hashCache.get(filePath)

  if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) {
    return cached.hash
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const codeContent = extractCodeContent(content)
  const hash = computeContentHash(codeContent)

  hashCache.set(filePath, {
    mtime: stat.mtimeMs,
    size: stat.size,
    hash,
  })

  return hash
}

export function extractCodeContent(fullContent: string): string {
  const lines = fullContent.split('\n')
  const codeLines: string[] = []
  let inHeaderComment = false
  let headerEnded = false
  let foundFirstCode = false

  for (const line of lines) {
    if (!headerEnded) {
      if (line.trim().startsWith('/**')) {
        inHeaderComment = true
        continue
      }
      if (inHeaderComment) {
        if (line.trim() === '*/') {
          inHeaderComment = false
          headerEnded = true
        }
        continue
      }
      if (line.trim() === '' || line.trim().startsWith('//')) {
        continue
      }
      headerEnded = true
      foundFirstCode = true
    }
    if (!foundFirstCode && (line.trim() === '' || line.trim().startsWith('//'))) {
      continue
    }
    foundFirstCode = true
    codeLines.push(line)
  }

  return codeLines.join('\n')
}

export interface BaselineInfo {
  baseline: string | null
  hasModify: boolean
  reason: string | null
  impact: string | null
  approvedBy: string | null
}

const BASELINE_REGEX = /@framework-baseline\s+([a-f0-9]+)/i
const MODIFY_REGEX = /@framework-modify/i
const REASON_REGEX = /@reason\s+(.+)/i
const IMPACT_REGEX = /@impact\s+(.+)/i
const APPROVED_BY_REGEX = /@approved-by\s+(.+)/i

export function extractBaselineInfo(content: string): BaselineInfo {
  const firstCommentEnd = content.indexOf('*/')
  const headerComment = firstCommentEnd > 0 ? content.slice(0, firstCommentEnd) : ''

  const baselineMatch = headerComment.match(BASELINE_REGEX)
  const reasonMatch = headerComment.match(REASON_REGEX)
  const impactMatch = headerComment.match(IMPACT_REGEX)
  const approvedByMatch = headerComment.match(APPROVED_BY_REGEX)

  return {
    baseline: baselineMatch ? baselineMatch[1] : null,
    hasModify: MODIFY_REGEX.test(headerComment),
    reason: reasonMatch ? reasonMatch[1].trim() : null,
    impact: impactMatch ? impactMatch[1].trim() : null,
    approvedBy: approvedByMatch ? approvedByMatch[1].trim() : null,
  }
}

export function generateHeaderComment(baseline: string): string {
  return `/**
 * @framework-baseline ${baseline}
 */`
}

export function updateFileBaseline(filePath: string, newBaseline: string): void {
  const content = fs.readFileSync(filePath, 'utf-8')
  const info = extractBaselineInfo(content)

  if (!info.baseline) {
    const codeContent = extractCodeContent(content)
    const newContent = generateHeaderComment(newBaseline) + '\n' + codeContent
    fs.writeFileSync(filePath, newContent, 'utf-8')
    return
  }

  const firstCommentEnd = content.indexOf('*/')
  if (firstCommentEnd < 0) return

  const beforeComment = content.slice(0, content.indexOf('/**'))
  const afterComment = content.slice(firstCommentEnd + 2)

  const oldHeader = content.slice(content.indexOf('/**'), firstCommentEnd + 2)
  const newHeader = oldHeader.replace(
    /@framework-baseline\s+[a-f0-9]+/i,
    `@framework-baseline ${newBaseline}`
  )

  const newContent = beforeComment + newHeader + afterComment
  fs.writeFileSync(filePath, newContent, 'utf-8')
}

export function clearCache(): void {
  hashCache.clear()
}

export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: hashCache.size,
    keys: Array.from(hashCache.keys()),
  }
}
