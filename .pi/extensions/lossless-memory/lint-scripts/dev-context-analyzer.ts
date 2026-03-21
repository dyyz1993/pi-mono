#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs'
import { resolve, relative, dirname, basename, join, extname } from 'path'
import { execSync } from 'child_process'

interface Module {
  name: string
  path: string
  type: 'server' | 'client' | 'shared'
  routes: string[]
  services: string[]
  schemas: string[]
  tests: string[]
  dependencies: string[]
  database?: {
    tables: string[]
    relations: string[]
  }
}

interface APIDependency {
  route: string
  method: string
  path: string
  handler: string
  service: string
  schema: string
  middleware: string[]
  database: string[]
}

interface DevelopmentPath {
  feature: string
  layers: {
    database?: { files: string[]; tables: string[] }
    shared?: { files: string[]; schemas: string[] }
    server?: {
      files: string[]
      routes: string[]
      services: string[]
      middleware: string[]
    }
    client?: { files: string[]; components: string[]; stores: string[] }
  }
  tests: string[]
  guidelines: string[]
}

interface ProjectContext {
  modules: Module[]
  apiDependencies: APIDependency[]
  middleware: string[]
  database: {
    tables: string[]
    migrations: string[]
  }
  rules: string[]
}

const PROJECT_ROOT = process.cwd()

class ProjectAnalyzer {
  private context: ProjectContext = {
    modules: [],
    apiDependencies: [],
    middleware: [],
    database: { tables: [], migrations: [] },
    rules: [],
  }

  analyze(): ProjectContext {
    console.log('🔍 分析项目结构...\n')

    this.scanModules()
    this.scanMiddleware()
    this.scanDatabase()
    this.scanRules()
    this.analyzeAPIDependencies()

    return this.context
  }

  private scanModules(): void {
    const serverModules = this.scanDirectory('src/server/module-*')
    const clientModules = this.scanDirectory('src/client')
    const sharedModules = this.scanDirectory('src/shared/modules/*')

    console.log(`📦 发现 ${serverModules.length} 个服务端模块`)
    console.log(`🎨 发现 ${clientModules.length} 个客户端模块`)
    console.log(`🔗 发现 ${sharedModules.length} 个共享模块\n`)

    for (const modulePath of serverModules) {
      this.context.modules.push(this.analyzeServerModule(modulePath))
    }
  }

  private scanDirectory(pattern: string): string[] {
    const results: string[] = []
    const baseDir = pattern.includes('module-*')
      ? 'src/server'
      : pattern.includes('modules/*')
        ? 'src/shared/modules'
        : 'src/client'

    try {
      const items = readdirSync(join(PROJECT_ROOT, baseDir))
      for (const item of items) {
        const fullPath = join(PROJECT_ROOT, baseDir, item)
        if (statSync(fullPath).isDirectory()) {
          if (pattern.includes('module-*') && item.startsWith('module-')) {
            results.push(fullPath)
          } else if (pattern.includes('modules/*')) {
            results.push(fullPath)
          }
        }
      }
    } catch (error) {}

    return results
  }

  private analyzeServerModule(modulePath: string): Module {
    const moduleName = basename(modulePath).replace('module-', '')

    const module: Module = {
      name: moduleName,
      path: relative(PROJECT_ROOT, modulePath),
      type: 'server',
      routes: this.findFiles(modulePath, 'routes/**/*.ts'),
      services: this.findFiles(modulePath, 'services/**/*.ts'),
      schemas: this.findFiles(modulePath, '**/*.ts').filter(f => f.includes('schema')),
      tests: this.findFiles(modulePath, '__tests__/**/*.ts'),
      dependencies: [],
    }

    const dbPath = join(modulePath, 'db')
    if (existsSync(dbPath)) {
      module.database = {
        tables: this.findFiles(dbPath, '**/*.ts'),
        relations: [],
      }
    }

    return module
  }

  private findFiles(dir: string, pattern: string): string[] {
    const results: string[] = []

    const scan = (currentDir: string) => {
      try {
        const items = readdirSync(currentDir)
        for (const item of items) {
          const fullPath = join(currentDir, item)
          if (statSync(fullPath).isDirectory()) {
            scan(fullPath)
          } else if (item.endsWith('.ts') || item.endsWith('.tsx')) {
            results.push(relative(PROJECT_ROOT, fullPath))
          }
        }
      } catch (error) {}
    }

    scan(dir)
    return results
  }

  private scanMiddleware(): void {
    const middlewarePath = join(PROJECT_ROOT, 'src/server/middleware')
    if (existsSync(middlewarePath)) {
      this.context.middleware = this.findFiles(middlewarePath, '**/*.ts').filter(
        f => !f.includes('__tests__')
      )
    }
    console.log(`🛡️  发现 ${this.context.middleware.length} 个中间件`)
  }

  private scanDatabase(): void {
    const schemaPath = join(PROJECT_ROOT, 'src/server/db/schema')
    const migrationsPath = join(PROJECT_ROOT, 'drizzle')

    if (existsSync(schemaPath)) {
      this.context.database.tables = this.findFiles(schemaPath, '**/*.ts')
    }

    if (existsSync(migrationsPath)) {
      this.context.database.migrations = this.findFiles(migrationsPath, '**/*.sql')
    }

    console.log(`💾 发现 ${this.context.database.tables.length} 个数据库表定义`)
    console.log(`📜 发现 ${this.context.database.migrations.length} 个迁移文件\n`)
  }

  private scanRules(): void {
    const rulesPath = join(PROJECT_ROOT, '.claude/rules')
    if (existsSync(rulesPath)) {
      this.context.rules = this.findFiles(rulesPath, '**/*.md')
    }
    console.log(`📋 发现 ${this.context.rules.length} 个开发规则文件\n`)
  }

  private analyzeAPIDependencies(): void {
    for (const module of this.context.modules) {
      for (const routeFile of module.routes) {
        this.analyzeRouteFile(routeFile, module)
      }
    }
  }

  private analyzeRouteFile(routeFile: string, module: Module): void {
    const fullPath = join(PROJECT_ROOT, routeFile)
    if (!existsSync(fullPath)) return

    const content = readFileSync(fullPath, 'utf-8')

    const routeMatches = content.matchAll(/\.openapi\((\w+),/g)
    for (const match of routeMatches) {
      const routeName = match[1]
      const apiDep: APIDependency = {
        route: routeName,
        method: this.extractMethod(content, routeName),
        path: this.extractPath(content, routeName),
        handler: routeFile,
        service: this.findServiceForRoute(module, routeName),
        schema: this.findSchemaForRoute(module, routeName),
        middleware: this.extractMiddleware(content),
        database: this.extractDatabaseUsage(content),
      }
      this.context.apiDependencies.push(apiDep)
    }
  }

  private extractMethod(content: string, routeName: string): string {
    const regex = new RegExp(`const ${routeName}[^}]+method:\\s*['"](\\w+)['"]`, 's')
    const match = content.match(regex)
    return match ? match[1].toUpperCase() : 'GET'
  }

  private extractPath(content: string, routeName: string): string {
    const regex = new RegExp(`const ${routeName}[^}]+path:\\s*['"]([^'"]+)['"]`, 's')
    const match = content.match(regex)
    return match ? match[1] : '/'
  }

  private findServiceForRoute(module: Module, routeName: string): string {
    const serviceName = module.services.find(s => {
      const content = readFileSync(join(PROJECT_ROOT, s), 'utf-8')
      return content.includes(routeName) || content.includes(basename(routeName, 'Route'))
    })
    return serviceName || ''
  }

  private findSchemaForRoute(module: Module, routeName: string): string {
    const schemaName = module.schemas.find(s => {
      const content = readFileSync(join(PROJECT_ROOT, s), 'utf-8')
      return content.includes(routeName) || content.includes(basename(routeName, 'Route'))
    })
    return schemaName || ''
  }

  private extractMiddleware(content: string): string[] {
    const middleware: string[] = []
    const regex = /\.use\(['"]([^'"]+)['"]/g
    let match
    while ((match = regex.exec(content)) !== null) {
      middleware.push(match[1])
    }
    return middleware
  }

  private extractDatabaseUsage(content: string): string[] {
    const tables: string[] = []
    const regex = /from\((\w+)\)/g
    let match
    while ((match = regex.exec(content)) !== null) {
      tables.push(match[1])
    }
    return tables
  }
}

class DevelopmentPathAnalyzer {
  constructor(private context: ProjectContext) {}

  analyzePath(featureDescription: string): DevelopmentPath {
    const feature = this.extractFeature(featureDescription)

    const path: DevelopmentPath = {
      feature,
      layers: {},
      tests: [],
      guidelines: [],
    }

    const existingModule = this.findExistingModule(feature)

    if (existingModule) {
      path.layers.database = this.analyzeDatabaseLayer(existingModule)
      path.layers.shared = this.analyzeSharedLayer(existingModule)
      path.layers.server = this.analyzeServerLayer(existingModule)
      path.layers.client = this.analyzeClientLayer(existingModule)
      path.tests = this.analyzeTests(existingModule)
    } else {
      path.guidelines = this.generateNewModuleGuidelines(feature)
    }

    path.guidelines.push(...this.extractRelevantRules(feature))

    return path
  }

  private extractFeature(description: string): string {
    const keywords = description.toLowerCase()
    const modulePatterns = [
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

    for (const pattern of modulePatterns) {
      if (pattern.test(keywords)) {
        return pattern.source.toLowerCase()
      }
    }

    return 'unknown'
  }

  private findExistingModule(feature: string): Module | undefined {
    return this.context.modules.find(
      m => m.name.toLowerCase().includes(feature) || feature.includes(m.name.toLowerCase())
    )
  }

  private analyzeDatabaseLayer(module: Module): DevelopmentPath['layers']['database'] {
    if (!module.database) return undefined

    return {
      files: module.database.tables,
      tables: this.extractTableNames(module.database.tables),
    }
  }

  private extractTableNames(files: string[]): string[] {
    const tables: string[] = []
    for (const file of files) {
      const content = readFileSync(join(PROJECT_ROOT, file), 'utf-8')
      const matches = content.matchAll(/export const (\w+) = pgTable\(/g)
      for (const match of matches) {
        tables.push(match[1])
      }
    }
    return tables
  }

  private analyzeSharedLayer(module: Module): DevelopmentPath['layers']['shared'] {
    const sharedPath = join(PROJECT_ROOT, 'src/shared/modules', module.name)
    if (!existsSync(sharedPath)) return undefined

    const files = this.findFiles(sharedPath)
    const schemas = files.filter(f => f.includes('schema'))

    return { files, schemas }
  }

  private analyzeServerLayer(module: Module): DevelopmentPath['layers']['server'] {
    return {
      files: [...module.routes, ...module.services],
      routes: module.routes,
      services: module.services,
      middleware: this.findRelatedMiddleware(module),
    }
  }

  private analyzeClientLayer(module: Module): DevelopmentPath['layers']['client'] {
    const clientPath = join(PROJECT_ROOT, 'src/client')
    const files = this.findFiles(clientPath).filter(f =>
      f.toLowerCase().includes(module.name.toLowerCase())
    )

    return {
      files,
      components: files.filter(f => f.includes('components')),
      stores: files.filter(f => f.includes('stores')),
    }
  }

  private analyzeTests(module: Module): string[] {
    return module.tests
  }

  private findRelatedMiddleware(module: Module): string[] {
    const related: string[] = []
    for (const route of module.routes) {
      const content = readFileSync(join(PROJECT_ROOT, route), 'utf-8')
      if (content.includes('auth')) related.push('auth.ts')
      if (content.includes('captcha')) related.push('captcha.ts')
      if (content.includes('admin')) related.push('auth.ts')
    }
    return [...new Set(related)]
  }

  private generateNewModuleGuidelines(feature: string): string[] {
    return [
      `创建新的模块目录: src/server/module-${feature}/`,
      `创建路由文件: src/server/module-${feature}/routes/${feature}-routes.ts`,
      `创建服务文件: src/server/module-${feature}/services/${feature}-service.ts`,
      `创建共享类型: src/shared/modules/${feature}/schemas.ts`,
      `在 src/server/app.ts 中注册路由`,
      `创建测试文件: src/server/module-${feature}/__tests__/${feature}-routes.test.ts`,
    ]
  }

  private extractRelevantRules(feature: string): string[] {
    const rules: string[] = []

    for (const ruleFile of this.context.rules) {
      const content = readFileSync(join(PROJECT_ROOT, ruleFile), 'utf-8')

      if (feature.includes('api') || feature.includes('route')) {
        if (content.includes('API') || content.includes('路由')) {
          rules.push(ruleFile)
        }
      }

      if (feature.includes('database') || feature.includes('db')) {
        if (content.includes('数据库') || content.includes('Database')) {
          rules.push(ruleFile)
        }
      }

      if (feature.includes('test')) {
        if (content.includes('测试') || content.includes('Test')) {
          rules.push(ruleFile)
        }
      }
    }

    return rules
  }

  private findFiles(dir: string): string[] {
    const results: string[] = []

    const scan = (currentDir: string) => {
      try {
        const items = readdirSync(currentDir)
        for (const item of items) {
          const fullPath = join(currentDir, item)
          if (statSync(fullPath).isDirectory()) {
            scan(fullPath)
          } else if (item.endsWith('.ts') || item.endsWith('.tsx')) {
            results.push(relative(PROJECT_ROOT, fullPath))
          }
        }
      } catch (error) {}
    }

    scan(dir)
    return results
  }
}

class ContextGenerator {
  constructor(private context: ProjectContext) {}

  generateMarkdown(outputPath: string): void {
    const markdown = this.buildMarkdown()
    writeFileSync(outputPath, markdown, 'utf-8')
    console.log(`\n✅ 上下文文件已生成: ${outputPath}\n`)
  }

  private buildMarkdown(): string {
    const lines: string[] = [
      '# 项目开发上下文',
      '',
      '> 此文件由 dev-context-analyzer 自动生成',
      '',
      '## 📦 项目模块',
      '',
    ]

    for (const module of this.context.modules) {
      lines.push(`### ${module.name}`)
      lines.push('')
      lines.push(`- **路径**: \`${module.path}\``)
      lines.push(`- **路由**: ${module.routes.length} 个`)
      lines.push(`- **服务**: ${module.services.length} 个`)
      lines.push(`- **测试**: ${module.tests.length} 个`)
      lines.push('')

      if (module.routes.length > 0) {
        lines.push('**路由文件**:')
        lines.push('')
        for (const route of module.routes) {
          lines.push(`- \`${route}\``)
        }
        lines.push('')
      }

      if (module.services.length > 0) {
        lines.push('**服务文件**:')
        lines.push('')
        for (const service of module.services) {
          lines.push(`- \`${service}\``)
        }
        lines.push('')
      }
    }

    lines.push('## 🛡️ 中间件')
    lines.push('')
    for (const mw of this.context.middleware) {
      lines.push(`- \`${mw}\``)
    }
    lines.push('')

    lines.push('## 💾 数据库')
    lines.push('')
    lines.push('### 表定义')
    lines.push('')
    for (const table of this.context.database.tables) {
      lines.push(`- \`${table}\``)
    }
    lines.push('')

    lines.push('### 迁移文件')
    lines.push('')
    for (const migration of this.context.database.migrations) {
      lines.push(`- \`${migration}\``)
    }
    lines.push('')

    lines.push('## 🔗 API 依赖关系')
    lines.push('')
    for (const api of this.context.apiDependencies) {
      lines.push(`### ${api.method} ${api.path}`)
      lines.push('')
      lines.push(`- **路由**: \`${api.handler}\``)
      if (api.service) lines.push(`- **服务**: \`${api.service}\``)
      if (api.schema) lines.push(`- **Schema**: \`${api.schema}\``)
      if (api.middleware.length > 0) {
        lines.push(`- **中间件**: ${api.middleware.map(m => `\`${m}\``).join(', ')}`)
      }
      if (api.database.length > 0) {
        lines.push(`- **数据库表**: ${api.database.map(t => `\`${t}\``).join(', ')}`)
      }
      lines.push('')
    }

    lines.push('## 📋 开发规则')
    lines.push('')
    for (const rule of this.context.rules) {
      lines.push(`- [${basename(rule)}](${rule})`)
    }
    lines.push('')

    return lines.join('\n')
  }

  generateCompactContext(): string {
    const lines: string[] = [
      '# 项目紧凑上下文（用于 AI 会话）',
      '',
      '## 架构概览',
      '',
      `- **模块数量**: ${this.context.modules.length}`,
      `- **中间件**: ${this.context.middleware.length}`,
      `- **数据库表**: ${this.context.database.tables.length}`,
      `- **API 端点**: ${this.context.apiDependencies.length}`,
      '',
      '## 模块列表',
      '',
    ]

    for (const module of this.context.modules) {
      lines.push(
        `- **${module.name}**: ${module.routes.length} 路由, ${module.services.length} 服务`
      )
    }

    lines.push('')
    lines.push('## 关键文件路径')
    lines.push('')
    lines.push('### 服务端')
    lines.push('```')
    lines.push('src/server/')
    lines.push('├── app.ts                 # 应用入口')
    lines.push('├── middleware/            # 中间件')
    lines.push('├── module-{feature}/      # 业务模块')
    lines.push('│   ├── routes/            # API 路由')
    lines.push('│   ├── services/          # 业务逻辑')
    lines.push('│   └── __tests__/         # 测试')
    lines.push('└── db/schema/             # 数据库表定义')
    lines.push('```')
    lines.push('')
    lines.push('### 客户端')
    lines.push('```')
    lines.push('src/client/')
    lines.push('├── App.tsx                # 应用入口')
    lines.push('├── components/            # UI 组件')
    lines.push('├── stores/                # Zustand 状态')
    lines.push('└── services/              # API 客户端')
    lines.push('```')
    lines.push('')
    lines.push('### 共享类型')
    lines.push('```')
    lines.push('src/shared/')
    lines.push('├── core/                  # 框架层（不可修改）')
    lines.push('└── modules/               # 业务层 Schema')
    lines.push('```')
    lines.push('')

    return lines.join('\n')
  }
}

function printDevelopmentPath(path: DevelopmentPath): void {
  console.log('\n' + '='.repeat(60))
  console.log(`🎯 开发路径分析: ${path.feature}`)
  console.log('='.repeat(60) + '\n')

  if (path.layers.database) {
    console.log('💾 数据库层:')
    console.log(`   文件: ${path.layers.database.files.map(f => basename(f)).join(', ')}`)
    console.log(`   表: ${path.layers.database.tables.join(', ')}`)
    console.log('')
  }

  if (path.layers.shared) {
    console.log('🔗 共享类型层:')
    console.log(`   文件: ${path.layers.shared.files.length} 个`)
    console.log(`   Schema: ${path.layers.shared.schemas.map(f => basename(f)).join(', ')}`)
    console.log('')
  }

  if (path.layers.server) {
    console.log('🖥️  服务端层:')
    console.log(`   路由: ${path.layers.server.routes.map(f => basename(f)).join(', ')}`)
    console.log(`   服务: ${path.layers.server.services.map(f => basename(f)).join(', ')}`)
    console.log(`   中间件: ${path.layers.server.middleware.join(', ') || '无'}`)
    console.log('')
  }

  if (path.layers.client) {
    console.log('🎨 客户端层:')
    console.log(`   组件: ${path.layers.client.components.length} 个`)
    console.log(`   Store: ${path.layers.client.stores.length} 个`)
    console.log('')
  }

  if (path.tests.length > 0) {
    console.log('🧪 相关测试:')
    path.tests.forEach(t => console.log(`   - ${basename(t)}`))
    console.log('')
  }

  if (path.guidelines.length > 0) {
    console.log('📋 开发指引:')
    path.guidelines.forEach((g, i) => console.log(`   ${i + 1}. ${g}`))
    console.log('')
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const featureDescription = args.join(' ')
  const outputPath = join(PROJECT_ROOT, '.dev-context.md')

  const analyzer = new ProjectAnalyzer()
  const context = analyzer.analyze()

  if (featureDescription) {
    console.log('\n' + '='.repeat(60))
    console.log(`🔍 分析开发路径: "${featureDescription}"`)
    console.log('='.repeat(60))

    const pathAnalyzer = new DevelopmentPathAnalyzer(context)
    const devPath = pathAnalyzer.analyzePath(featureDescription)
    printDevelopmentPath(devPath)
  }

  const generator = new ContextGenerator(context)
  generator.generateMarkdown(outputPath)

  const compactContext = generator.generateCompactContext()
  const compactPath = join(PROJECT_ROOT, '.dev-context-compact.md')
  writeFileSync(compactPath, compactContext, 'utf-8')
  console.log(`✅ 紧凑上下文已生成: ${compactPath}\n`)

  console.log('💡 使用方法:')
  console.log('   1. 查看完整上下文: cat .dev-context.md')
  console.log('   2. 查看紧凑上下文: cat .dev-context-compact.md')
  console.log('   3. 分析特定功能: npm run dev:context "我要开发用户管理接口"')
  console.log('   4. 将 .dev-context-compact.md 内容复制到 AI 会话中\n')
}

main()
