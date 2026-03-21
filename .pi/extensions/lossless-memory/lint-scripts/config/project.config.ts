/**
 * 项目特定的验证配置
 *
 * 这个文件包含所有项目特定的配置参数
 * 通用验证脚本将读取这些配置执行检测
 */

import type {
  TodosConfig,
  SensitiveConfig,
  ImportsConfig,
  ServerRPCConfig,
  ClientRPCConfig,
  DirectoryStructureConfig,
  ModuleTestsConfig,
  TestQualityConfig,
  ClientTestsConfig,
  MdRefsConfig,
} from '../validators/index.js'

// ============================================
// TODO/FIXME 验证配置
// ============================================
export const todosConfig: TodosConfig = {
  // 需要检测的关键词
  keywords: ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG'],

  // 允许的模式（例如 @author 表示已归属）
  allowedPattern: /@(\w+)/,

  // 忽略的目录
  ignoreDirs: ['node_modules', 'dist', '__tests__', '.git', 'coverage'],

  // 检查的目录
  checkDirs: ['src', 'lint-scripts'],
}

// ============================================
// 敏感信息检测配置
// ============================================
export const sensitiveConfig: SensitiveConfig = {
  // 敏感信息模式列表
  patterns: [
    // API Keys
    {
      pattern: /API[_-]?KEY\s*[:=]\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/i,
      message: 'API Key detected',
      excludePattern: /process\.env\./,
    },
    {
      pattern: /GEMINI[_-]?API[_-]?KEY\s*[:=]\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/i,
      message: 'Gemini API Key detected',
      excludePattern: /process\.env\./,
    },
    // Passwords
    {
      pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/i,
      message: 'Hardcoded password detected',
    },
    {
      pattern: /passwd\s*[:=]\s*['"][^'"]{8,}['"]/i,
      message: 'Hardcoded password detected',
    },
    // Tokens
    {
      pattern: /token\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
      message: 'Hardcoded token detected',
      excludePattern: /process\.env\.|authToken|csrfToken/,
    },
    // Secret
    {
      pattern: /secret\s*[:=]\s*['"][a-zA-Z0-9_-]{10,}['"]/i,
      message: 'Hardcoded secret detected',
      excludePattern: /process\.env\.|jwtSecret/,
    },
    // .env 文件引用
    {
      pattern: /['"`]\.env(?:\.\w+)?['"`]/,
      message: '.env file reference in string literal',
      excludePattern: /\.env\.example|config\.ts/,
    },
  ],

  // 忽略的文件模式
  ignorePatterns: [
    /node_modules/,
    /dist/,
    /\.git/,
    /coverage/,
    /\.env\.example$/,
    /__tests__/,
    /lint-scripts\/(validate|config|watch-validator|test-validators-unit|test-tracker|test-history|post-commit-track|smart-test|dev-server|TESTING|README|quick-test|DIRECTORY_RULES|framework|check-refs)/,
    /server\/config\.ts/,
    /server\/utils\/logger\.ts/,
    /admin\/services\/(README|TESTING)\.md/,
  ],

  // 检查的文件扩展名
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md'],

  // 检查的目录
  checkDirs: ['src', 'lint-scripts'],
}

// ============================================
// 导入路径验证配置
// ============================================
export const importsConfig: ImportsConfig = {
  // 项目模块定义
  modules: ['shared', 'client', 'server'] as const,

  // 源代码目录
  srcDir: 'src',

  // 路径别名映射
  aliases: {
    shared: '@shared',
    client: '@client',
    server: '@server',
  },

  // ⭐ 触发跨模块检测的最小相对深度
  // ../ = 1 (允许，同模块内)
  // ../../ = 2 (禁止，跨模块)
  minCrossModuleDepth: 2,

  // 忽略的目录
  ignoreDirs: ['node_modules', 'dist', '.git', 'build'],

  // 检查的目录
  checkDirs: ['src', 'scripts'],
}

// ============================================
// 服务端 RPC 验证配置
// ============================================
export const serverRPCConfig: ServerRPCConfig = {
  checkDirs: ['src/server'],
  ignoreDirs: ['node_modules', 'dist', '__tests__'],
  requireChainSyntax: true,
  requireTypeExport: true,
}

// ============================================
// 客户端 RPC 验证配置
// ============================================
export const clientRPCConfig: ClientRPCConfig = {
  checkDirs: ['src/client'],
  ignoreDirs: ['node_modules', 'dist', '__tests__'],
  requireAPIClient: true,
  forbidDirectFetch: true,
  forbidDirectWebSocket: true,
  forbidDirectEventSource: true,
}

// ============================================
// 目录结构验证配置
// ============================================
export const directoryStructureConfig: DirectoryStructureConfig = {
  rules: [
    {
      pattern: '*routes*.ts',
      requiredDir: 'routes',
      description: 'Route files must be in routes/ directory',
    },
    {
      pattern: '*service*.ts',
      requiredDir: 'services',
      description: 'Service files must be in services/ directory',
    },
    {
      pattern: '*.test.ts',
      requiredDir: '__tests__',
      description: 'Test files must be in __tests__/ directory',
    },
    {
      pattern: '*.spec.ts',
      requiredDir: 'e2e',
      description: 'E2E test files must be in e2e/ directory',
    },
  ],
  forbiddenLocations: [
    {
      pattern: '*.test.ts',
      forbiddenDirs: ['src/server', 'src/client'],
      message: 'Unit test files should not be in source directories',
      suggestion: 'Move to __tests__/ directory within the module',
    },
    {
      pattern: '*.spec.ts',
      forbiddenDirs: ['src'],
      message: 'E2E test files should not be in src/ directory',
      suggestion: 'Move to e2e/ directory at project root',
    },
    {
      pattern: '*example*.ts',
      forbiddenDirs: ['src'],
      message: 'Example files should not be in src/ directory',
      suggestion: 'Move to examples/ directory at project root or docs/examples/',
    },
    {
      pattern: '*demo*.ts',
      forbiddenDirs: ['src'],
      message: 'Demo files should not be in src/ directory',
      suggestion: 'Move to demos/ directory at project root or docs/demos/',
    },
    {
      pattern: '*script*.ts',
      forbiddenDirs: ['src'],
      message: 'Script files should not be in src/ directory',
      suggestion: 'Move to scripts/ directory at project root',
    },
  ],
  ignoreDirs: ['node_modules', 'dist', '.git', 'build', 'coverage', 'drizzle', 'patches'],
  allowedRootFiles: [
    '*.config.ts',
    '*.config.js',
    '*.setup.ts',
    'vite-env.d.ts',
    'vite-plugins.ts',
  ],
}

// ============================================
// 模块测试文件验证配置
// ============================================
export const moduleTestsConfig: ModuleTestsConfig = {
  modulePattern: 'module-*',
  testsDir: '__tests__',
  requiredTestFiles: [
    {
      pattern: '*-service.test.ts',
      description: 'Service layer tests',
      minAssertions: 5,
    },
    {
      pattern: '*-route*.test.ts',
      description: 'Route/API tests',
      minAssertions: 5,
    },
  ],
  ignoreDirs: ['node_modules', 'dist', '.git', 'build', 'coverage'],
  checkDirs: ['src/server'],
}

// ============================================
// 测试质量验证配置
// ============================================
export const testQualityConfig: TestQualityConfig = {
  minAssertionsPerTest: 2,
  requireErrorAssertions: true,
  requireEdgeCaseAssertions: false,
  errorAssertionPatterns: [
    'toBe\\(400\\)',
    'toBe\\(401\\)',
    'toBe\\(403\\)',
    'toBe\\(404\\)',
    'toBe\\(500\\)',
    'toBe\\(false\\)',
    'toBeNull\\(\\)',
    'toBeUndefined\\(\\)',
    'toBeFalsy\\(\\)',
    'rejects',
    'toThrow',
  ],
  edgeCasePatterns: [
    'empty',
    'null',
    'undefined',
    'max',
    'min',
    'boundary',
    'edge',
    'invalid',
    'missing',
  ],
  ignoreDirs: ['node_modules', 'dist', '.git', 'build', 'coverage'],
  checkDirs: ['src/server', 'src/client'],
}

// ============================================
// Client 测试覆盖验证配置
// ============================================
export const clientTestsConfig: ClientTestsConfig = {
  rules: [
    {
      dir: 'src/client/components',
      filePattern: '*.tsx',
      testPattern: '{name}.test.tsx',
      description: 'Component tests',
    },
    {
      dir: 'src/client/pages',
      filePattern: '*.tsx',
      testPattern: '{name}.test.tsx',
      description: 'Page tests',
    },
  ],
  ignoreFiles: ['src/client/components/index.ts', 'src/client/pages/index.ts'],
  ignoreDirs: [
    'node_modules',
    'dist',
    '.git',
    'build',
    'coverage',
    '__tests__',
    'stores',
    'hooks',
    'services',
  ],
  checkDirs: ['src/client'],
}

// ============================================
// Markdown 引用路径验证配置
// ============================================
export const mdRefsConfig: MdRefsConfig = {
  ignoreDirs: ['node_modules', 'dist', '.git', 'build', 'coverage'],
  checkDirs: ['.', 'src'],
}

// ============================================
// Console.log 检测配置
// ============================================
export const consoleLogConfig: ConsoleLogConfig = {
  pattern: /console\.(log|debug)\(/,
  excludePattern: /\/\/.*console\.|logger\./,
  ignorePatterns: [
    /node_modules/,
    /dist/,
    /.git/,
    /coverage/,
    /__tests__/,
    /lint-scripts/,
    /server\/utils\/logger\.ts/,
  ],
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  checkDirs: ['src/server'],
}

// ============================================
// 统一导出
// ============================================
export const projectConfig = {
  todos: todosConfig,
  sensitive: sensitiveConfig,
  imports: importsConfig,
  serverRPC: serverRPCConfig,
  clientRPC: clientRPCConfig,
  directory: directoryStructureConfig,
  moduleTests: moduleTestsConfig,
  testQuality: testQualityConfig,
  clientTests: clientTestsConfig,
  mdRefs: mdRefsConfig,
  consoleLog: consoleLogConfig,
} as const

export default projectConfig
