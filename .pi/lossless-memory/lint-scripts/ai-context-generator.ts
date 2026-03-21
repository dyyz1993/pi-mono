#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const PROJECT_ROOT = process.cwd()

function generateAIContext(): string {
  const lines: string[] = [
    '# 项目上下文（用于 AI 会话）',
    '',
    '## 项目信息',
    '',
    `- **类型**: React + Hono 全栈应用`,
    `- **技术栈**: React, TypeScript, Hono, Drizzle ORM, Zustand`,
    `- **架构**: 模块化架构，前后端分离`,
    '',
    '## 目录结构',
    '',
    '```',
    'src/',
    '├── client/          # React 前端',
    '│   ├── components/  # UI 组件',
    '│   ├── stores/      # Zustand 状态管理',
    '│   └── services/    # API 客户端',
    '├── server/          # Hono 后端',
    '│   ├── module-*/    # 业务模块',
    '│   │   ├── routes/  # API 路由',
    '│   │   ├── services/# 业务逻辑',
    '│   │   └── __tests__/# 测试',
    '│   ├── middleware/  # 中间件',
    '│   └── db/schema/   # 数据库表',
    '└── shared/          # 共享类型',
    '    ├── core/        # 框架层（不可修改）',
    '    └── modules/     # 业务层 Schema',
    '```',
    '',
  ]

  const compactContextPath = join(PROJECT_ROOT, '.dev-context-compact.md')
  if (existsSync(compactContextPath)) {
    const compactContext = readFileSync(compactContextPath, 'utf-8')
    lines.push('## 项目统计')
    lines.push('')
    lines.push(compactContext.split('\n').slice(4).join('\n'))
  }

  const guidePath = join(PROJECT_ROOT, '.dev-guide.md')
  if (existsSync(guidePath)) {
    const guide = readFileSync(guidePath, 'utf-8')
    lines.push('')
    lines.push('## 开发指引')
    lines.push('')
    lines.push(guide)
  }

  lines.push('')
  lines.push('## 开发规范')
  lines.push('')
  lines.push('### 关键规则')
  lines.push('')
  lines.push('1. **中间件位置**: 中间件必须在 `src/server/middleware/` 目录')
  lines.push('2. **路由位置**: 路由必须在 `src/server/module-*/routes/` 目录')
  lines.push('3. **中间件应用**: 中间件只能在 `app.ts` 中应用，不能在路由文件中应用')
  lines.push('4. **类型安全**: 使用 Zod Schema 定义类型，禁止使用 `any`')
  lines.push('5. **分层架构**: 路由调用服务，服务处理业务逻辑')
  lines.push('6. **工具函数**: 工具函数放在 `utils/` 目录，不要放在 service 中')
  lines.push('')
  lines.push('### API 开发流程')
  lines.push('')
  lines.push('```')
  lines.push('1. 定义 Schema (src/shared/modules/{feature}/schemas.ts)')
  lines.push('2. 创建数据库表 (src/server/db/schema/{feature}.ts)')
  lines.push('3. 实现服务层 (src/server/module-{feature}/services/{feature}-service.ts)')
  lines.push('4. 定义路由 (src/server/module-{feature}/routes/{feature}-routes.ts)')
  lines.push('5. 注册路由 (src/server/app.ts)')
  lines.push('6. 编写测试 (src/server/module-{feature}/__tests__/)')
  lines.push('```')
  lines.push('')
  lines.push('### 前端开发流程')
  lines.push('')
  lines.push('```')
  lines.push('1. 创建 API 客户端 (src/client/services/apiClient.ts)')
  lines.push('2. 创建状态管理 (src/client/stores/{feature}Store.ts)')
  lines.push('3. 创建组件 (src/client/components/{feature}/)')
  lines.push('4. 创建页面 (src/client/pages/{feature}Page.tsx)')
  lines.push('```')
  lines.push('')
  lines.push('## 常用命令')
  lines.push('')
  lines.push('```bash')
  lines.push('npm run dev          # 启动开发服务器')
  lines.push('npm test             # 运行测试')
  lines.push('npm run typecheck    # 类型检查')
  lines.push('npm run lint         # 代码检查')
  lines.push('npm run db:generate  # 生成数据库迁移')
  lines.push('npm run db:migrate   # 执行数据库迁移')
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}

function copyToClipboard(text: string): void {
  try {
    const platform = process.platform

    if (platform === 'darwin') {
      execSync('pbcopy', { input: text })
    } else if (platform === 'linux') {
      execSync('xclip -selection clipboard', { input: text })
    } else if (platform === 'win32') {
      execSync('clip', { input: text })
    } else {
      console.log('⚠️  不支持的操作系统，无法自动复制到剪贴板')
      console.log('请手动复制以下内容：\n')
      console.log(text)
      return
    }

    console.log('✅ 上下文已复制到剪贴板！')
    console.log('💡 现在可以直接粘贴到 AI 会话中\n')
  } catch (error) {
    console.log('⚠️  无法复制到剪贴板，请手动复制以下内容：\n')
    console.log(text)
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const shouldCopy = !args.includes('--no-copy')

  console.log('🔍 生成 AI 会话上下文...\n')

  const context = generateAIContext()

  const outputPath = join(PROJECT_ROOT, '.ai-context.md')
  writeFileSync(outputPath, context, 'utf-8')
  console.log(`✅ 上下文已保存到: ${outputPath}\n`)

  if (shouldCopy) {
    copyToClipboard(context)
  } else {
    console.log(context)
  }

  console.log('📖 使用方法:')
  console.log('   1. 在 AI 会话中粘贴上下文')
  console.log('   2. 描述你的开发需求')
  console.log('   3. AI 会根据上下文提供精准的帮助\n')

  console.log('💡 示例对话:')
  console.log('   用户: 我正在开发一个 React + Hono 项目。这是项目上下文：')
  console.log('   [粘贴上下文]')
  console.log('   我需要开发一个订单管理接口，请帮我实现。\n')
}

main()
