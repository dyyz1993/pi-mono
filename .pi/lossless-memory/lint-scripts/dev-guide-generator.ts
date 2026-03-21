#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import { execSync } from 'child_process'

interface DevelopmentGuide {
  title: string
  description: string
  steps: DevelopmentStep[]
  codeExamples: CodeExample[]
  relatedFiles: string[]
  testingGuide: string[]
  commonMistakes: string[]
}

interface DevelopmentStep {
  order: number
  title: string
  description: string
  files: string[]
  checklist: string[]
  codeSnippet?: string
}

interface CodeExample {
  title: string
  code: string
  explanation: string
}

const PROJECT_ROOT = process.cwd()

class DevelopmentGuideGenerator {
  private rules: Map<string, string> = new Map()

  constructor() {
    this.loadRules()
  }

  private loadRules(): void {
    const rulesPath = join(PROJECT_ROOT, '.claude/rules')
    if (!existsSync(rulesPath)) return

    const ruleFiles = [
      '20-server-api.md',
      '31-client-services.md',
      '40-shared-types.md',
      '60-testing-standards.md',
      '10-api-type-inference.md',
    ]

    for (const file of ruleFiles) {
      const filePath = join(rulesPath, file)
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8')
        this.rules.set(file, content)
      }
    }
  }

  generateGuide(taskDescription: string): DevelopmentGuide {
    const taskType = this.detectTaskType(taskDescription)

    switch (taskType) {
      case 'api':
        return this.generateAPIGuide(taskDescription)
      case 'frontend':
        return this.generateFrontendGuide(taskDescription)
      case 'database':
        return this.generateDatabaseGuide(taskDescription)
      case 'websocket':
        return this.generateWebSocketGuide(taskDescription)
      case 'sse':
        return this.generateSSEGuide(taskDescription)
      default:
        return this.generateGeneralGuide(taskDescription)
    }
  }

  private detectTaskType(description: string): string {
    const desc = description.toLowerCase()

    if (desc.includes('接口') || desc.includes('api') || desc.includes('路由')) {
      return 'api'
    }
    if (desc.includes('前端') || desc.includes('页面') || desc.includes('组件')) {
      return 'frontend'
    }
    if (desc.includes('数据库') || desc.includes('表') || desc.includes('db')) {
      return 'database'
    }
    if (desc.includes('websocket') || desc.includes('ws') || desc.includes('实时')) {
      return 'websocket'
    }
    if (desc.includes('sse') || desc.includes('推送') || desc.includes('通知')) {
      return 'sse'
    }

    return 'general'
  }

  private generateAPIGuide(description: string): DevelopmentGuide {
    const featureName = this.extractFeatureName(description)

    return {
      title: `开发 ${featureName} API 接口`,
      description: `完整的服务端 API 开发流程，包括路由定义、服务实现、类型定义和测试`,
      steps: [
        {
          order: 1,
          title: '定义共享类型 (Schema)',
          description: '在 shared/modules 中定义请求和响应的 Schema',
          files: [`src/shared/modules/${featureName}/schemas.ts`],
          checklist: [
            '创建请求 Schema (CreateInput, UpdateInput)',
            '创建响应 Schema (ItemSchema, ListSchema)',
            '导出到 src/shared/modules/index.ts',
            '确保使用 Zod 定义类型',
          ],
          codeSnippet: this.getSchemaExample(featureName),
        },
        {
          order: 2,
          title: '创建数据库表（如需要）',
          description: '在 server/db/schema 中定义数据库表结构',
          files: [`src/server/db/schema/${featureName}.ts`],
          checklist: [
            '定义表结构 (pgTable)',
            '定义关系 (relations)',
            '导出到 src/server/db/schema/index.ts',
            '运行 db:generate 生成迁移',
          ],
          codeSnippet: this.getDatabaseExample(featureName),
        },
        {
          order: 3,
          title: '实现服务层',
          description: '在 module 中实现业务逻辑',
          files: [`src/server/module-${featureName}/services/${featureName}-service.ts`],
          checklist: [
            '实现 CRUD 操作',
            '处理业务逻辑',
            '使用类型安全的数据库查询',
            '不要在 service 中定义工具函数',
          ],
          codeSnippet: this.getServiceExample(featureName),
        },
        {
          order: 4,
          title: '定义路由',
          description: '使用 Hono OpenAPI 定义类型安全的路由',
          files: [`src/server/module-${featureName}/routes/${featureName}-routes.ts`],
          checklist: [
            '使用 createRoute 定义路由',
            '使用链式语法 .openapi()',
            '调用 service 层方法',
            '使用 successResponse/errorResponse',
          ],
          codeSnippet: this.getRouteExample(featureName),
        },
        {
          order: 5,
          title: '注册路由到应用',
          description: '在 app.ts 中注册新路由',
          files: ['src/server/app.ts'],
          checklist: ['导入路由', '使用 .route() 注册', '确保在中间件之后注册'],
          codeSnippet: this.getAppRegistrationExample(featureName),
        },
        {
          order: 6,
          title: '编写测试',
          description: '编写单元测试和集成测试',
          files: [
            `src/server/module-${featureName}/__tests__/${featureName}-service.test.ts`,
            `src/server/module-${featureName}/__tests__/${featureName}-routes.test.ts`,
          ],
          checklist: [
            '测试 service 层方法',
            '测试 API 端点',
            '使用 testClient 进行集成测试',
            '覆盖成功和失败场景',
          ],
          codeSnippet: this.getTestExample(featureName),
        },
      ],
      codeExamples: [
        {
          title: '完整的 API 开发示例',
          code: this.getFullAPIExample(featureName),
          explanation: '展示了从 Schema 到路由的完整流程',
        },
      ],
      relatedFiles: [
        '.claude/rules/20-server-api.md',
        '.claude/rules/40-shared-types.md',
        '.claude/rules/60-testing-standards.md',
      ],
      testingGuide: [
        '运行单元测试: npm test',
        '运行集成测试: npm run test:integration',
        '运行特定测试: npm test <test-file>',
        '查看测试覆盖率: npm run test:coverage',
      ],
      commonMistakes: [
        '❌ 在路由文件中应用中间件（应在 app.ts 中）',
        '❌ 在 service 中定义工具函数（应放在 utils/）',
        '❌ 使用 any 类型（应使用 Zod Schema）',
        '❌ 直接在路由中实现业务逻辑（应调用 service）',
        '❌ 忘记导出 Schema 到 shared/modules/index.ts',
      ],
    }
  }

  private generateFrontendGuide(description: string): DevelopmentGuide {
    const featureName = this.extractFeatureName(description)

    return {
      title: `开发 ${featureName} 前端功能`,
      description: `完整的前端开发流程，包括组件、状态管理和 API 集成`,
      steps: [
        {
          order: 1,
          title: '创建 API 客户端',
          description: '在 services 中创建类型安全的 API 客户端',
          files: [`src/client/services/apiClient.ts`],
          checklist: ['使用 Hono RPC 客户端', '确保类型推导正确', '处理错误响应'],
          codeSnippet: this.getAPIClientExample(featureName),
        },
        {
          order: 2,
          title: '创建状态管理',
          description: '使用 Zustand 创建状态管理',
          files: [`src/client/stores/${featureName}Store.ts`],
          checklist: ['定义状态接口', '实现 actions', '处理异步操作', '导出到 stores/index.ts'],
          codeSnippet: this.getZustandExample(featureName),
        },
        {
          order: 3,
          title: '创建 UI 组件',
          description: '创建功能组件',
          files: [`src/client/components/${featureName}/`],
          checklist: ['创建展示组件', '使用 antd 组件', '处理加载和错误状态', '编写组件测试'],
          codeSnippet: this.getComponentExample(featureName),
        },
        {
          order: 4,
          title: '创建页面',
          description: '创建页面组件并集成功能',
          files: [`src/client/pages/${featureName}Page.tsx`],
          checklist: ['集成组件和状态', '处理路由参数', '添加页面测试'],
          codeSnippet: this.getPageExample(featureName),
        },
      ],
      codeExamples: [],
      relatedFiles: [
        '.claude/rules/30-client-components.md',
        '.claude/rules/31-client-services.md',
        '.claude/rules/32-client-state-zustand.md',
      ],
      testingGuide: [
        '测试组件: npm test <component>.test.tsx',
        '测试 Store: npm test <store>.test.ts',
        '使用 @testing-library/react',
      ],
      commonMistakes: [
        '❌ 直接使用 fetch（应使用 apiClient）',
        '❌ 在组件中直接调用 API（应通过 Store）',
        '❌ 使用 useState 管理复杂状态（应使用 Zustand）',
      ],
    }
  }

  private generateDatabaseGuide(description: string): DevelopmentGuide {
    const featureName = this.extractFeatureName(description)

    return {
      title: `开发 ${featureName} 数据库功能`,
      description: '数据库表定义、迁移和查询',
      steps: [
        {
          order: 1,
          title: '定义表结构',
          description: '使用 Drizzle ORM 定义表',
          files: [`src/server/db/schema/${featureName}.ts`],
          checklist: ['定义主表', '定义关系', '添加索引', '导出到 index.ts'],
          codeSnippet: this.getDatabaseExample(featureName),
        },
        {
          order: 2,
          title: '生成迁移',
          description: '生成数据库迁移文件',
          files: [],
          checklist: ['运行 npm run db:generate', '检查生成的 SQL', '运行 npm run db:migrate'],
          codeSnippet: 'npm run db:generate\nnpm run db:migrate',
        },
      ],
      codeExamples: [],
      relatedFiles: ['drizzle.config.ts'],
      testingGuide: ['使用测试数据库', '清理测试数据'],
      commonMistakes: ['❌ 直接修改迁移文件', '❌ 忘记导出表定义'],
    }
  }

  private generateWebSocketGuide(description: string): DevelopmentGuide {
    const featureName = this.extractFeatureName(description)

    return {
      title: `开发 ${featureName} WebSocket 功能`,
      description: '实时双向通信功能',
      steps: [
        {
          order: 1,
          title: '定义协议',
          description: '定义 WebSocket 消息协议',
          files: [`src/shared/modules/${featureName}/index.ts`],
          checklist: ['定义消息类型', '使用 Zod Schema', '导出协议'],
          codeSnippet: this.getWebSocketProtocolExample(featureName),
        },
        {
          order: 2,
          title: '实现服务端',
          description: '实现 WebSocket 处理器',
          files: [`src/server/module-${featureName}/services/${featureName}-service.ts`],
          checklist: ['使用 runtime.registerRPC', '处理连接和消息', '广播消息'],
          codeSnippet: this.getWebSocketServiceExample(featureName),
        },
        {
          order: 3,
          title: '创建客户端',
          description: '创建 WebSocket 客户端',
          files: [`src/shared/core/ws-client.ts`],
          checklist: ['使用 WSClient 类', '处理重连', '类型安全调用'],
          codeSnippet: this.getWebSocketClientExample(featureName),
        },
      ],
      codeExamples: [],
      relatedFiles: ['.claude/rules/50-websocket.md'],
      testingGuide: ['使用 testServer', '测试连接和消息'],
      commonMistakes: ['❌ 直接使用原生 WebSocket', '❌ 不处理重连'],
    }
  }

  private generateSSEGuide(description: string): DevelopmentGuide {
    const featureName = this.extractFeatureName(description)

    return {
      title: `开发 ${featureName} SSE 功能`,
      description: '服务器推送事件',
      steps: [
        {
          order: 1,
          title: '定义事件类型',
          description: '定义 SSE 事件 Schema',
          files: [`src/shared/modules/${featureName}/schemas.ts`],
          checklist: ['定义事件类型', '使用 Zod Schema'],
          codeSnippet: this.getSSESchemaExample(featureName),
        },
        {
          order: 2,
          title: '实现 SSE 路由',
          description: '实现 SSE 端点',
          files: [`src/server/module-${featureName}/routes/${featureName}-routes.ts`],
          checklist: ['使用 $sse() 方法', '返回事件流', '处理错误'],
          codeSnippet: this.getSSERouteExample(featureName),
        },
        {
          order: 3,
          title: '创建客户端',
          description: '创建 SSE 客户端',
          files: [`src/shared/core/sse-client.ts`],
          checklist: ['使用 SSEClient 类', '处理重连', '类型安全'],
          codeSnippet: this.getSSEClientExample(featureName),
        },
      ],
      codeExamples: [],
      relatedFiles: ['.claude/rules/51-sse.md'],
      testingGuide: ['不需要服务器', '使用 fakeServer'],
      commonMistakes: ['❌ 直接使用 EventSource', '❌ 不处理重连'],
    }
  }

  private generateGeneralGuide(description: string): DevelopmentGuide {
    return {
      title: '通用开发指引',
      description: '根据任务描述生成开发步骤',
      steps: [
        {
          order: 1,
          title: '分析需求',
          description: '理解任务需求和技术栈',
          files: [],
          checklist: ['确定技术栈', '识别依赖关系', '规划开发步骤'],
        },
        {
          order: 2,
          title: '查看相关规则',
          description: '阅读开发规范文档',
          files: ['.claude/rules/*.md'],
          checklist: ['查看架构规范', '了解最佳实践', '避免常见错误'],
        },
        {
          order: 3,
          title: '参考现有代码',
          description: '查看类似功能的实现',
          files: [],
          checklist: ['找到参考模块', '理解实现模式', '复用代码结构'],
        },
      ],
      codeExamples: [],
      relatedFiles: ['.claude/rules/'],
      testingGuide: ['编写单元测试', '编写集成测试'],
      commonMistakes: ['跳过测试', '不遵循规范'],
    }
  }

  private extractFeatureName(description: string): string {
    const keywords = description.toLowerCase()
    const patterns = [
      /todo/i,
      /notification/i,
      /chat/i,
      /order/i,
      /user/i,
      /admin/i,
      /permission/i,
      /content/i,
      /dispute/i,
      /ticket/i,
      /captcha/i,
    ]

    for (const pattern of patterns) {
      if (pattern.test(keywords)) {
        return pattern.source.toLowerCase()
      }
    }

    return 'feature'
  }

  private getSchemaExample(feature: string): string {
    return `// src/shared/modules/${feature}/schemas.ts
import { z } from '@hono/zod-openapi'

export const ${feature}Schema = z.object({
  id: z.number(),
  title: z.string(),
  createdAt: z.string(),
})

export const create${feature.charAt(0).toUpperCase() + feature.slice(1)}Schema = z.object({
  title: z.string().min(1),
})

export type ${feature.charAt(0).toUpperCase() + feature.slice(1)} = z.infer<typeof ${feature}Schema>
export type Create${feature.charAt(0).toUpperCase() + feature.slice(1)} = z.infer<typeof create${feature.charAt(0).toUpperCase() + feature.slice(1)}Schema>`
  }

  private getDatabaseExample(feature: string): string {
    return `// src/server/db/schema/${feature}.ts
import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core'

export const ${feature} = pgTable('${feature}', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})`
  }

  private getServiceExample(feature: string): string {
    return `// src/server/module-${feature}/services/${feature}-service.ts
import { getDb } from '@server/db'
import { ${feature} } from '@server/db/schema'
import type { Create${feature.charAt(0).toUpperCase() + feature.slice(1)} } from '@shared/modules/${feature}/schemas'

export async function list${feature.charAt(0).toUpperCase() + feature.slice(1)}s() {
  const db = await getDb()
  return db.select().from(${feature})
}

export async function create${feature.charAt(0).toUpperCase() + feature.slice(1)}(input: Create${feature.charAt(0).toUpperCase() + feature.slice(1)}) {
  const db = await getDb()
  const result = await db.insert(${feature}).values(input).returning()
  return result[0]
}`
  }

  private getRouteExample(feature: string): string {
    return `// src/server/module-${feature}/routes/${feature}-routes.ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { ${feature}Schema, create${feature.charAt(0).toUpperCase() + feature.slice(1)}Schema } from '@shared/modules/${feature}/schemas'
import { successResponse, errorResponse } from '@server/utils/route-helpers'
import { list${feature.charAt(0).toUpperCase() + feature.slice(1)}s, create${feature.charAt(0).toUpperCase() + feature.slice(1)} } from '../services/${feature}-service'

const listRoute = createRoute({
  method: 'get',
  path: '/${feature}s',
  responses: {
    200: successResponse(z.array(${feature}Schema), '获取列表'),
  },
})

const createRoute = createRoute({
  method: 'post',
  path: '/${feature}s',
  request: {
    body: {
      content: {
        'application/json': { schema: create${feature.charAt(0).toUpperCase() + feature.slice(1)}Schema },
      },
    },
  },
  responses: {
    201: successResponse(${feature}Schema, '创建成功'),
    400: errorResponse('参数错误'),
  },
})

export const apiRoutes = new OpenAPIHono()
  .openapi(listRoute, async c => {
    const items = await list${feature.charAt(0).toUpperCase() + feature.slice(1)}s()
    return c.json({ success: true, data: items })
  })
  .openapi(createRoute, async c => {
    const data = c.req.valid('json')
    const item = await create${feature.charAt(0).toUpperCase() + feature.slice(1)}(data)
    return c.json({ success: true, data: item }, 201)
  })`
  }

  private getAppRegistrationExample(feature: string): string {
    return `// src/server/app.ts
import { ${feature}Routes } from './module-${feature}/routes/${feature}-routes'

export function createApp() {
  return new OpenAPIHono()
    .use('*', errorHandlerMiddleware())
    .route('/api', ${feature}Routes) // 添加这一行
}`
  }

  private getTestExample(feature: string): string {
    return `// src/server/module-${feature}/__tests__/${feature}-routes.test.ts
import { describe, it, expect } from 'vitest'
import { testClient } from '@server/test-utils/test-client'
import app from '@server/app'

describe('${feature} API', () => {
  it('should list ${feature}s', async () => {
    const client = testClient(app)
    const res = await client.api['${feature}s'].$get()
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})`
  }

  private getFullAPIExample(feature: string): string {
    return `${this.getSchemaExample(feature)}

${this.getServiceExample(feature)}

${this.getRouteExample(feature)}`
  }

  private getAPIClientExample(feature: string): string {
    return `// src/client/services/apiClient.ts
import { hc } from 'hono/client'
import type { AppType } from '@server/app'

export const apiClient = hc<AppType>('/api')`
  }

  private getZustandExample(feature: string): string {
    return `// src/client/stores/${feature}Store.ts
import { create } from 'zustand'
import type { ${feature.charAt(0).toUpperCase() + feature.slice(1)} } from '@shared/modules/${feature}/schemas'

interface ${feature.charAt(0).toUpperCase() + feature.slice(1)}State {
  items: ${feature.charAt(0).toUpperCase() + feature.slice(1)}[]
  loading: boolean
  fetchItems: () => Promise<void>
}

export const use${feature.charAt(0).toUpperCase() + feature.slice(1)}Store = create<${feature.charAt(0).toUpperCase() + feature.slice(1)}State>(set => ({
  items: [],
  loading: false,
  fetchItems: async () => {
    set({ loading: true })
    const res = await apiClient.api['${feature}s'].$get()
    const data = await res.json()
    set({ items: data.data, loading: false })
  },
}))`
  }

  private getComponentExample(feature: string): string {
    return `// src/client/components/${feature}/${feature.charAt(0).toUpperCase() + feature.slice(1)}List.tsx
import { use${feature.charAt(0).toUpperCase() + feature.slice(1)}Store } from '@client/stores/${feature}Store'

export function ${feature.charAt(0).toUpperCase() + feature.slice(1)}List() {
  const { items, loading, fetchItems } = use${feature.charAt(0).toUpperCase() + feature.slice(1)}Store()
  
  useEffect(() => {
    fetchItems()
  }, [])
  
  if (loading) return <div>Loading...</div>
  
  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  )
}`
  }

  private getPageExample(feature: string): string {
    return `// src/client/pages/${feature.charAt(0).toUpperCase() + feature.slice(1)}Page.tsx
import { ${feature.charAt(0).toUpperCase() + feature.slice(1)}List } from '@client/components/${feature}/${feature.charAt(0).toUpperCase() + feature.slice(1)}List'

export function ${feature.charAt(0).toUpperCase() + feature.slice(1)}Page() {
  return (
    <div>
      <h1>${feature.charAt(0).toUpperCase() + feature.slice(1)}</h1>
      <${feature.charAt(0).toUpperCase() + feature.slice(1)}List />
    </div>
  )
}`
  }

  private getWebSocketProtocolExample(feature: string): string {
    return `// src/shared/modules/${feature}/index.ts
import { z } from '@hono/zod-openapi'

export const ${feature}MessageSchema = z.object({
  type: z.literal('${feature}'),
  data: z.any(),
})

export type ${feature.charAt(0).toUpperCase() + feature.slice(1)}Message = z.infer<typeof ${feature}MessageSchema>`
  }

  private getWebSocketServiceExample(feature: string): string {
    return `// 在路由中注册 RPC 方法
.openapi(wsRoute, async c => {
  const ws = await c.env.runtime.$ws(c)
  
  ws.on('message', async (data) => {
    // 处理消息
  })
})`
  }

  private getWebSocketClientExample(feature: string): string {
    return `// 使用 WebSocket 客户端
import { WSClient } from '@shared/core/ws-client'

const ws = new WSClient('ws://localhost:3010/api/${feature}/ws')
await ws.call('${feature}Method', { data: 'test' })`
  }

  private getSSESchemaExample(feature: string): string {
    return `// src/shared/modules/${feature}/schemas.ts
export const ${feature}EventSchema = z.object({
  id: z.string(),
  message: z.string(),
  timestamp: z.number(),
})`
  }

  private getSSERouteExample(feature: string): string {
    return `// SSE 路由
.openapi(sseRoute, async c => {
  return c.env.runtime.$sse(c, async (stream) => {
    await stream.write({ event: '${feature}', data: { message: 'Hello' } })
  })
})`
  }

  private getSSEClientExample(feature: string): string {
    return `// 使用 SSE 客户端
import { SSEClient } from '@shared/core/sse-client'

const sse = new SSEClient('/api/${feature}/stream')
sse.on('${feature}', (data) => {
  console.log('Event:', data)
})`
  }

  printGuide(guide: DevelopmentGuide): void {
    console.log('\n' + '='.repeat(70))
    console.log(`📖 ${guide.title}`)
    console.log('='.repeat(70))
    console.log(`\n${guide.description}\n`)

    console.log('📋 开发步骤:\n')
    for (const step of guide.steps) {
      console.log(`${step.order}. ${step.title}`)
      console.log(`   ${step.description}`)
      if (step.files.length > 0) {
        console.log('   文件:')
        step.files.forEach(f => console.log(`     - ${f}`))
      }
      if (step.checklist.length > 0) {
        console.log('   检查清单:')
        step.checklist.forEach(c => console.log(`     ☐ ${c}`))
      }
      if (step.codeSnippet) {
        console.log('\n   代码示例:')
        console.log('   ' + step.codeSnippet.split('\n').join('\n   '))
      }
      console.log('')
    }

    if (guide.commonMistakes.length > 0) {
      console.log('⚠️  常见错误:\n')
      guide.commonMistakes.forEach(m => console.log(`  ${m}`))
      console.log('')
    }

    if (guide.testingGuide.length > 0) {
      console.log('🧪 测试指南:\n')
      guide.testingGuide.forEach(t => console.log(`  • ${t}`))
      console.log('')
    }

    if (guide.relatedFiles.length > 0) {
      console.log('📚 相关文档:\n')
      guide.relatedFiles.forEach(f => console.log(`  • ${f}`))
      console.log('')
    }
  }

  saveGuide(guide: DevelopmentGuide, outputPath: string): void {
    const lines: string[] = [
      `# ${guide.title}`,
      '',
      `> ${guide.description}`,
      '',
      '## 📋 开发步骤',
      '',
    ]

    for (const step of guide.steps) {
      lines.push(`### ${step.order}. ${step.title}`)
      lines.push('')
      lines.push(step.description)
      lines.push('')

      if (step.files.length > 0) {
        lines.push('**相关文件**:')
        lines.push('')
        step.files.forEach(f => lines.push(`- \`${f}\``))
        lines.push('')
      }

      if (step.checklist.length > 0) {
        lines.push('**检查清单**:')
        lines.push('')
        step.checklist.forEach(c => lines.push(`- [ ] ${c}`))
        lines.push('')
      }

      if (step.codeSnippet) {
        lines.push('**代码示例**:')
        lines.push('')
        lines.push('```typescript')
        lines.push(step.codeSnippet)
        lines.push('```')
        lines.push('')
      }
    }

    if (guide.commonMistakes.length > 0) {
      lines.push('## ⚠️ 常见错误')
      lines.push('')
      guide.commonMistakes.forEach(m => lines.push(m))
      lines.push('')
    }

    if (guide.testingGuide.length > 0) {
      lines.push('## 🧪 测试指南')
      lines.push('')
      guide.testingGuide.forEach(t => lines.push(`- ${t}`))
      lines.push('')
    }

    if (guide.relatedFiles.length > 0) {
      lines.push('## 📚 相关文档')
      lines.push('')
      guide.relatedFiles.forEach(f => lines.push(`- [${basename(f)}](${f})`))
      lines.push('')
    }

    writeFileSync(outputPath, lines.join('\n'), 'utf-8')
    console.log(`\n✅ 开发指引已保存到: ${outputPath}\n`)
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const taskDescription = args.join(' ')

  if (!taskDescription) {
    console.log('用法: npm run dev:guide "任务描述"')
    console.log('示例: npm run dev:guide "我要开发一个用户管理接口"')
    process.exit(1)
  }

  const generator = new DevelopmentGuideGenerator()
  const guide = generator.generateGuide(taskDescription)

  generator.printGuide(guide)

  const outputPath = join(PROJECT_ROOT, '.dev-guide.md')
  generator.saveGuide(guide, outputPath)

  console.log('💡 提示:')
  console.log('   1. 查看完整指引: cat .dev-guide.md')
  console.log('   2. 按照步骤逐一完成开发')
  console.log('   3. 每完成一步，勾选检查清单')
  console.log('   4. 参考代码示例进行实现')
  console.log('   5. 避免常见错误\n')
}

main()
