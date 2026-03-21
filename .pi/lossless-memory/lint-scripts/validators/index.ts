/**
 * 通用验证器的类型定义
 */

// ============================================
// TODO/FIXME 验证配置
// ============================================
export interface TodosConfig {
  keywords: string[]
  allowedPattern: RegExp
  ignoreDirs: string[]
  checkDirs: string[]
}

export interface TodoError {
  file: string
  line: number
  keyword: string
  content: string
}

// ============================================
// 敏感信息检测配置
// ============================================
export interface PatternRule {
  pattern: RegExp
  message: string
  excludePattern?: RegExp
}

export interface SensitiveConfig {
  patterns: PatternRule[]
  ignorePatterns?: RegExp[]
  fileExtensions: string[]
  checkDirs: string[]
}

export interface SensitiveError {
  file: string
  line: number
  message: string
  content: string
}

// ============================================
// 导入路径验证配置
// ============================================
export type ModuleName = string

export interface ImportsConfig {
  modules: readonly ModuleName[]
  srcDir: string
  aliases: Record<string, string>
  minCrossModuleDepth: number
  ignoreDirs: string[]
  checkDirs: string[]
}

export interface ImportError {
  file: string
  importPath: string
  suggestion: string
}

// ============================================
// 服务端 RPC 验证配置
// ============================================
export interface ServerRPCConfig {
  checkDirs: string[]
  ignoreDirs: string[]
  requireChainSyntax: boolean
  requireTypeExport: boolean
}

export interface ServerRPCError {
  file: string
  line: number
  message: string
  suggestion: string
}

// ============================================
// 客户端 RPC 验证配置
// ============================================
export interface ClientRPCConfig {
  checkDirs: string[]
  ignoreDirs: string[]
  requireAPIClient: boolean
  forbidDirectFetch: boolean
  forbidDirectWebSocket?: boolean
  forbidDirectEventSource?: boolean
}

export interface ClientRPCError {
  file: string
  line: number
  message: string
  suggestion: string
}

// ============================================
// 目录结构验证配置
// ============================================
export interface DirectoryRule {
  pattern: string
  requiredDir: string
  description?: string
}

export interface ForbiddenLocation {
  pattern: string
  forbiddenDirs: string[]
  message: string
  suggestion: string
}

export interface DirectoryStructureConfig {
  rules: DirectoryRule[]
  forbiddenLocations?: ForbiddenLocation[]
  ignoreDirs: string[]
  allowedRootFiles?: string[]
}

export interface DirectoryError {
  file: string
  expectedDir: string
  actualDir: string
}

export interface ForbiddenError {
  file: string
  message: string
  suggestion: string
}

// ============================================
// 模块测试文件验证配置
// ============================================
export interface RequiredTestFile {
  pattern: string
  description: string
  minAssertions?: number
}

export interface ModuleTestsConfig {
  modulePattern: string
  testsDir: string
  requiredTestFiles: RequiredTestFile[]
  ignoreDirs: string[]
  checkDirs: string[]
}

export interface ModuleTestError {
  module: string
  missingTests: string[]
  suggestion: string
}

// ============================================
// 测试质量验证配置
// ============================================
export interface AssertionRule {
  type: 'min_per_test' | 'error_coverage' | 'edge_case_coverage'
  minCount?: number
  description: string
}

export interface TestQualityConfig {
  minAssertionsPerTest: number
  requireErrorAssertions: boolean
  requireEdgeCaseAssertions: boolean
  errorAssertionPatterns: string[]
  edgeCasePatterns: string[]
  ignoreDirs: string[]
  checkDirs: string[]
}

export interface TestQualityError {
  file: string
  testSuite: string
  testName: string
  issue: string
  suggestion: string
}

export interface TestQualityWarning {
  file: string
  testSuite: string
  testName: string
  assertionCount: number
  suggestion: string
}

// ============================================
// Client 测试覆盖验证配置
// ============================================
export interface ClientTestRule {
  dir: string
  filePattern: string
  testPattern: string
  description: string
}

export interface ClientTestsConfig {
  rules: ClientTestRule[]
  ignoreFiles: string[]
  ignoreDirs: string[]
  checkDirs: string[]
}

export interface ClientTestError {
  file: string
  expectedTest: string
  suggestion: string
}

// ============================================
// Vite 路由配置验证配置
// ============================================
export interface ViteRoutesConfig {
  viteConfigPath: string
  checkDirs: string[]
  ignoreDirs: string[]
}

export interface ViteRouteError {
  file: string
  line: number
  routePath: string
  basename: string | null
  suggestion: string
}

export interface ParsedPattern {
  pattern: string
  isExact: boolean
}

// ============================================
// Markdown 引用路径验证配置
// ============================================
export interface MdRefsConfig {
  ignoreDirs: string[]
  checkDirs: string[]
}

export interface MdRefError {
  file: string
  line: number
  ref: string
  resolvedPath: string
  isGlob: boolean
}

// ============================================
// Console.log 检测配置
// ============================================
export interface ConsoleLogConfig {
  pattern: RegExp
  excludePattern?: RegExp
  ignorePatterns?: RegExp[]
  fileExtensions: string[]
  checkDirs: string[]
}

export interface ConsoleLogError {
  file: string
  line: number
  message: string
  content: string
}
