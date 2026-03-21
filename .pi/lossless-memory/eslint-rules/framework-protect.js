import * as crypto from 'crypto'
import * as fs from 'fs'

const hashCache = new Map()

const FRAMEWORK_PATTERNS = [
  '/shared/core/',
  '/server/core/',
  '/server/entries/',
  '/server/test-utils/',
  '/client/services/',
]

function isFrameworkFile(filePath) {
  return FRAMEWORK_PATTERNS.some(p => filePath.includes(p))
}

function computeContentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 16)
}

function extractCodeContent(fullContent) {
  const lines = fullContent.split('\n')
  const codeLines = []
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

function computeFileHash(filePath) {
  try {
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
  } catch {
    return null
  }
}

function extractBaselineInfo(content) {
  const firstCommentEnd = content.indexOf('*/')
  const headerComment = firstCommentEnd > 0 ? content.slice(0, firstCommentEnd) : ''

  const baselineMatch = headerComment.match(/@framework-baseline\s+([a-f0-9]+)/i)
  const reasonMatch = headerComment.match(/@reason\s+(.+)/i)
  const impactMatch = headerComment.match(/@impact\s+(.+)/i)

  return {
    baseline: baselineMatch ? baselineMatch[1] : null,
    hasModify: /@framework-modify/i.test(headerComment),
    reason: reasonMatch ? reasonMatch[1].trim() : null,
    impact: impactMatch ? impactMatch[1].trim() : null,
  }
}

export const frameworkProtect = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Protect framework files from unauthorized modifications',
      recommended: true,
    },
    messages: {
      missingBaseline:
        '框架文件缺少 @framework-baseline 声明。\n\n' +
        '请运行 npm run framework:init 初始化框架文件基准。',
      fileModified:
        '框架文件已被修改！\n\n' +
        '基准 Hash: {{baseline}}\n' +
        '当前 Hash: {{current}}\n\n' +
        '此文件属于框架层代码，修改需要添加说明。请在文件顶部注释中添加：\n\n' +
        '@framework-modify\n' +
        '@reason [必填] 修改原因\n' +
        '@impact [必填] 影响范围',
      missingReason:
        '框架文件修改缺少 @reason 说明。\n\n' + '请在注释中添加：\n' + '@reason [修改原因]',
      missingImpact:
        '框架文件修改缺少 @impact 说明。\n\n' + '请在注释中添加：\n' + '@impact [影响范围]',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename || context.getFilename()

    if (!isFrameworkFile(filename)) {
      return {}
    }

    return {
      Program(node) {
        const sourceCode = context.sourceCode || context.getSourceCode()
        const content = sourceCode.text
        const info = extractBaselineInfo(content)

        if (!info.baseline) {
          context.report({
            node,
            messageId: 'missingBaseline',
          })
          return
        }

        const currentHash = computeFileHash(filename)
        if (!currentHash) return

        if (currentHash !== info.baseline) {
          if (!info.hasModify) {
            context.report({
              node,
              messageId: 'fileModified',
              data: {
                baseline: info.baseline,
                current: currentHash,
              },
            })
            return
          }

          if (!info.reason) {
            context.report({
              node,
              messageId: 'missingReason',
            })
          }

          if (!info.impact) {
            context.report({
              node,
              messageId: 'missingImpact',
            })
          }
        }
      },
    }
  },
}

export default frameworkProtect
