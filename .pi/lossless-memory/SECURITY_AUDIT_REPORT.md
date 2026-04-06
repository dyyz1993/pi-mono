# 后端安全审计报告

**审计日期**: 2026-04-06  
**审计范围**: `.pi/lossless-memory/src/server/`  
**严重程度分类**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## 执行摘要

本次审计发现 **17 个安全问题**，其中：
- 🔴 **Critical**: 3 个
- 🟠 **High**: 5 个  
- 🟡 **Medium**: 6 个
- 🟢 **Low**: 3 个

**最严重的问题**：
1. 硬编码的测试认证令牌和密钥
2. 不安全的默认密钥配置
3. SQL 注入风险

---

## 🔴 Critical 级别问题

### 1. 硬编码的测试认证令牌

**位置**: `src/server/utils/auth.ts:26-28`  
**文件**: `src/server/middleware/auth.ts:106-132`

```typescript
// ❌ 硬编码的测试令牌
const mockTokens: Map<string, string> = new Map([
  ['super-admin-token', '1'],
  ['customer-service-token', '2'],
  ['user-token', '3'],
])

// ❌ 硬编码的开发令牌
if (secretKey === 'dev-secret-key-change-in-production') {
  if (token === 'admin-token' || token === 'super-admin-token') {
    return { /* super admin */ }
  }
  if (token === 'customer-service-token') {
    return { /* customer service */ }
  }
  if (token === 'user-token') {
    return { /* user */ }
  }
}
```

**风险**:
- 攻击者可以使用硬编码的令牌获得超级管理员权限
- 生产环境中如果未更改默认密钥，系统完全暴露
- 所有测试令牌都可直接访问生产系统

**修复建议**:
```typescript
// ✅ 使用环境变量和安全的令牌验证
export function verifyToken(token: string, secretKey: string): AuthUser | null {
  // 在生产环境禁止使用测试令牌
  if (process.env.NODE_ENV === 'production') {
    if (token.startsWith('test-') || 
        token === 'admin-token' ||
        token === 'super-admin-token') {
      throw new Error('Test tokens are not allowed in production')
    }
  }

  // 使用 JWT 或数据库验证
  const user = validateTokenFromDatabase(token)
  return user
}
```

---

### 2. 不安全的默认密钥

**位置**: `src/server/middleware/auth.ts:25`  
**文件**: `src/server/utils/file-storage.ts:79`

```typescript
// ❌ 不安全的默认密钥
const defaultSecretKey = 'dev-secret-key-change-in-production'
const secretKey = process.env.FILE_SECRET_KEY || 'default-secret-key-change-in-production'
```

**风险**:
- 如果未设置环境变量，使用弱密钥
- 攻击者可以伪造签名 URL
- 文件访问控制完全失效

**修复建议**:
```typescript
// ✅ 强制要求安全密钥
function getRequiredEnv(key: string, defaultValue?: string): string {
  const value = process.env[key]
  
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Required environment variable ${key} is not set`)
    }
    if (defaultValue) {
      console.warn(`Using default value for ${key}. This should not happen in production!`)
      return defaultValue
    }
    throw new Error(`Required environment variable ${key} is not set`)
  }
  
  return value
}

const secretKey = getRequiredEnv('FILE_SECRET_KEY')
const authSecretKey = getRequiredEnv('AUTH_SECRET_KEY')
```

---

### 3. SQL 查询中的字符串拼接

**位置**: `src/server/modules/lossless-memory/services/lossless-service.ts:100-131`

```typescript
// ⚠️ 潜在的 SQL 注入风险
let sql = 'SELECT * FROM session_index'
const paramsArr: any[] = []

if (params?.projectPath) {
  sql += ' WHERE session_path LIKE ?'  // ✅ 使用参数化查询
  paramsArr.push(`%${params.projectPath}%`)
}

sql += ' ORDER BY last_accessed DESC'

// ⚠️ 另一个例子
let sql = 'SELECT * FROM memory_nodes'
const conditions: string[] = []

if (params?.sessionId) {
  conditions.push('session_id = ?')  // ✅ 使用参数化查询
  paramsArr.push(params.sessionId)
}

if (conditions.length > 0) {
  sql += ' WHERE ' + conditions.join(' AND ')
}
```

**风险**:
- 虽然使用了参数化查询，但字符串拼接模式增加了出错风险
- 如果未来有人修改代码不小心直接拼接用户输入，会导致 SQL 注入

**修复建议**:
```typescript
// ✅ 使用查询构建器或 ORM
import { db } from './db'
import { eq, like, and, desc } from 'drizzle-orm'

export function getSessions(params?: { projectPath?: string }) {
  const conditions = []
  
  if (params?.projectPath) {
    conditions.push(like(sessionIndex.session_path, `%${params.projectPath}%`))
  }
  
  const query = db
    .select()
    .from(sessionIndex)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sessionIndex.last_accessed))
  
  return query
}
```

---

## 🟠 High 级别问题

### 4. 缺少速率限制

**位置**: 整个 API 层

**问题**:
- 没有实现速率限制中间件
- 攻击者可以暴力破解认证
- DoS 攻击风险

**修复建议**:
```typescript
import { rateLimiter } from 'hono-rate-limiter'

app.use('*', rateLimiter({
  windowMs: 15 * 60 * 1000,  // 15 分钟
  max: 100,  // 每个 IP 最多 100 请求
  message: { error: 'Too many requests, please try again later.' }
}))

// 对敏感端点更严格的限制
app.use('/admin/login', rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,  // 每个 IP 最多 5 次登录尝试
}))
```

---

### 5. CORS 配置过于宽松

**位置**: `src/server/middleware/cors.ts:14`

```typescript
// ❌ 允许所有来源
const defaultCorsOptions = {
  origin: ['*'],
  credentials: true,
}
```

**风险**:
- 允许任何域名访问 API
- CSRF 攻击风险
- 敏感数据可能被恶意网站获取

**修复建议**:
```typescript
// ✅ 白名单模式
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'https://yourdomain.com',
  'https://app.yourdomain.com',
]

export function corsMiddleware(options: CorsOptions = {}): MiddlewareHandler {
  const mergedOptions = {
    origin: (origin: string) => {
      if (process.env.NODE_ENV === 'development') return origin
      return allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }

  return cors(mergedOptions as never)
}
```

---

### 6. 文件上传安全检查不足

**位置**: `src/server/utils/file-storage.ts`

**问题**:
- 只检查 MIME 类型和扩展名，容易被绕过
- 没有文件内容验证
- 没有病毒扫描
- 临时文件清理机制可能失败

**修复建议**:
```typescript
import { createReadStream } from 'fs'
import { pipeline } from 'stream/promises'
import { createHash } from 'crypto'

// ✅ 增强的文件验证
export async function validateFileContent(
  filePath: string,
  expectedMimeType: string
): Promise<boolean> {
  // 1. 检查文件魔数（文件签名）
  const buffer = Buffer.alloc(32)
  const fd = await open(filePath, 'r')
  await fd.read(buffer, 0, 32, 0)
  await fd.close()

  const magicNumbers = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
  }

  const expected = magicNumbers[expectedMimeType]
  if (expected && !expected.every((byte, i) => buffer[i] === byte)) {
    return false
  }

  // 2. 扫描病毒（集成 ClamAV 或类似服务）
  // const isClean = await scanForViruses(filePath)
  // if (!isClean) return false

  return true
}

// ✅ 文件名安全处理
export function sanitizeFilename(filename: string): string {
  // 移除路径遍历字符
  const sanitized = filename.replace(/\.\./g, '')
  
  // 移除特殊字符
  return sanitized.replace(/[^a-zA-Z0-9._-]/g, '_')
}
```

---

### 7. 环境变量敏感信息泄露

**位置**: `src/server/config.ts`

```typescript
// ⚠️ 敏感配置直接使用环境变量，没有验证
mysqlPassword: typeof process !== 'undefined' ? process.env.MYSQL_PASSWORD || '' : undefined,
secretKey: process.env.FILE_SECRET_KEY || 'default-secret-key-change-in-production',
```

**问题**:
- 默认值为空或弱密钥
- 没有配置验证
- 可能意外暴露在生产环境中

**修复建议**:
```typescript
// ✅ 配置验证和类型安全
import { z } from 'zod'

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']),
  port: z.number().min(1024).max(65535),
  database: z.object({
    driver: z.enum(['sqlite', 'mysql']),
    sqlitePath: z.string().optional(),
    mysql: z.object({
      host: z.string(),
      port: z.number(),
      user: z.string(),
      password: z.string().min(8),
      database: z.string(),
    }).optional(),
  }),
  security: z.object({
    authSecretKey: z.string().min(32),
    fileSecretKey: z.string().min(32),
  }),
})

export function getConfig() {
  const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3010', 10),
    database: {
      driver: process.env.DB_DRIVER || 'sqlite',
      // ...
    },
    security: {
      authSecretKey: process.env.AUTH_SECRET_KEY || '',
      fileSecretKey: process.env.FILE_SECRET_KEY || '',
    },
  }

  // 生产环境必须提供所有必需配置
  if (config.nodeEnv === 'production') {
    const result = ConfigSchema.safeParse(config)
    if (!result.success) {
      throw new Error(`Invalid configuration: ${result.error.message}`)
    }
    return result.data
  }

  return config
}
```

---

### 8. 缺少安全响应头

**位置**: `src/server/entries/node.ts`

**问题**:
- 缺少 Helmet 等安全头中间件
- 没有 CSP (Content Security Policy)
- 没有 HSTS (HTTP Strict Transport Security)
- 没有 X-Frame-Options, X-Content-Type-Options 等

**修复建议**:
```typescript
import { secureHeaders } from 'hono/secure-headers'

app.use('*', secureHeaders())

// 或者自定义安全头
app.use('*', async (c, next) => {
  await next()
  
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('X-XSS-Protection', '1; mode=block')
  c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.res.headers.set('Content-Security-Policy', "default-src 'self'")
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
})
```

---

## 🟡 Medium 级别问题

### 9. 密码验证逻辑过于简单

**位置**: `src/server/module-admin/services/admin-service.ts:220-221`

```typescript
// ❌ 不安全的密码验证
if (data.password !== '123456') {
  throw new Error('Invalid password')
}
```

**问题**:
- 硬编码的测试密码
- 没有使用 bcrypt 或 argon2 哈希
- 没有密码强度验证

**修复建议**:
```typescript
import { hash, verify } from 'argon2'

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const user = await db.users.findByUsername(data.username)
  
  if (!user) {
    // 使用恒定时间比较防止时序攻击
    await hash('dummy password for timing')
    throw new Error('Invalid credentials')
  }

  // 验证哈希密码
  const isValid = await verify(user.passwordHash, data.password)
  
  if (!isValid) {
    throw new Error('Invalid credentials')
  }

  // 生成安全的 JWT 令牌
  const token = generateSecureJWT(user)
  
  return { user, token }
}
```

---

### 10. 错误消息泄露信息

**位置**: 多个文件

```typescript
// ⚠️ 泄露敏感信息
throw new Error(`Database connection failed: ${error.message}`)
throw new Error(`File not found: ${filePath}`)
```

**问题**:
- 错误消息包含内部实现细节
- 可能泄露文件路径、数据库结构等
- 帮助攻击者了解系统架构

**修复建议**:
```typescript
// ✅ 生产环境使用通用错误消息
class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number,
    public isOperational: boolean = true
  ) {
    super(message)
  }
}

export function handleError(error: unknown, c: Context) {
  const isDev = process.env.NODE_ENV === 'development'
  
  if (error instanceof AppError) {
    return c.json({
      error: error.message,
      ...(isDev && { stack: error.stack })
    }, error.statusCode)
  }

  // 未预期的错误，记录详细信息但返回通用消息
  console.error('Unexpected error:', error)
  
  return c.json({
    error: isDev 
      ? (error as Error).message 
      : 'An unexpected error occurred'
  }, 500)
}
```

---

### 11. 会话管理不安全

**位置**: `src/server/utils/auth.ts`

**问题**:
- 令牌没有过期时间
- 没有令牌撤销机制
- 令牌存储在内存中（重启丢失）

**修复建议**:
```typescript
import { sign, verify } from 'jsonwebtoken'

interface TokenPayload {
  userId: string
  role: Role
  iat: number
  exp: number
}

export function generateToken(user: User): string {
  const payload: TokenPayload = {
    userId: user.id,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // 24 小时
  }
  
  return sign(payload, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
  })
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const payload = verify(token, process.env.JWT_SECRET!) as TokenPayload
    
    // 检查令牌是否在黑名单中
    if (await isTokenRevoked(token)) {
      return null
    }
    
    return payload
  } catch {
    return null
  }
}

// 令牌撤销机制（使用 Redis）
export async function revokeToken(token: string): Promise<void> {
  const decoded = verify(token, process.env.JWT_SECRET!) as TokenPayload
  const ttl = decoded.exp - Math.floor(Date.now() / 1000)
  
  await redis.setex(`revoked:${token}`, ttl, '1')
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  return await redis.exists(`revoked:${token}`)
}
```

---

### 12. 缺少输入验证

**位置**: 多个路由文件

**问题**:
- 部分端点缺少请求验证
- 使用 `any` 类型
- Zod schema 不够严格

**修复建议**:
```typescript
import { z } from 'zod'

// ✅ 严格的输入验证
const CreateUserSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and dashes'),
  
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must be at most 255 characters'),
  
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be at most 100 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  
  role: z.enum(['user', 'admin', 'customer_service']),
})

app.post('/users', async (c) => {
  try {
    const data = CreateUserSchema.parse(await c.req.json())
    // ... 处理逻辑
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation failed', details: error.errors }, 400)
    }
    throw error
  }
})
```

---

### 13. 数据库连接字符串硬编码

**位置**: `src/server/modules/lossless-memory/services/lossless-service.ts:17`

```typescript
// ⚠️ 硬编码的数据库路径
const DB_PATH = join(homedir(), '.pi/agent/lossless-memory.db')
```

**问题**:
- 数据库路径不可配置
- 多实例部署时可能冲突
- 没有考虑不同环境的路径

**修复建议**:
```typescript
// ✅ 可配置的数据库路径
export function getDatabasePath(): string {
  const envPath = process.env.LOSSLESS_DB_PATH
  
  if (envPath) {
    return envPath
  }
  
  // 根据环境选择不同路径
  const nodeEnv = process.env.NODE_ENV || 'development'
  
  if (nodeEnv === 'test') {
    return join(process.cwd(), 'test.db')
  }
  
  if (nodeEnv === 'production') {
    return process.env.PRODUCTION_DB_PATH || '/var/data/lossless-memory.db'
  }
  
  return join(homedir(), '.pi/agent/lossless-memory.db')
}
```

---

### 14. 日志记录不足

**位置**: 整个应用

**问题**:
- 缺少审计日志
- 敏感操作没有记录
- 没有日志轮转和归档策略

**修复建议**:
```typescript
import { logger } from './logger'

// ✅ 审计日志
export async function auditLog(
  action: string,
  userId: string,
  details: Record<string, any>,
  request: Request
) {
  await db.auditLogs.create({
    action,
    userId,
    ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    timestamp: new Date(),
    details: JSON.stringify(details),
  })
}

// 敏感操作记录
app.post('/admin/users', authMiddleware(), async (c) => {
  const user = c.get('authUser')
  const data = await c.req.json()
  
  logger.info('User creation attempt', {
    userId: user.id,
    newUserUsername: data.username,
    ipAddress: c.req.header('x-forwarded-for'),
  })
  
  // ... 创建用户逻辑
  
  await auditLog('user.create', user.id, { newUserId: newUser.id }, c.req.raw)
  
  return c.json({ success: true })
})
```

---

## 🟢 Low 级别问题

### 15. 依赖项版本检查

**位置**: `package.json`

**问题**:
- 部分依赖可能有已知漏洞
- 需要定期运行 `npm audit`

**修复建议**:
```bash
# 运行安全审计
npm audit

# 自动修复
npm audit fix

# 检查过时的依赖
npm outdated

# 使用 Snyk 或 Dependabot 自动监控
```

---

### 16. 缺少 API 文档认证说明

**位置**: OpenAPI schemas

**问题**:
- OpenAPI 文档没有完整的认证说明
- 部分端点缺少安全配置

**修复建议**:
```typescript
// ✅ OpenAPI 安全配置
const securitySchemes = {
  Bearer: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT Authorization header using the Bearer scheme',
  },
}

const app = new OpenAPIHono({
  openapi: {
    security: [{ Bearer: [] }],
    components: {
      securitySchemes,
    },
  },
})
```

---

### 17. 缺少健康检查端点

**位置**: `src/server/app.ts`

**问题**:
- 没有健康检查端点
- 负载均衡器无法判断服务状态

**修复建议**:
```typescript
// ✅ 健康检查
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  })
})

app.get('/health/ready', async (c) => {
  // 检查数据库连接
  const dbHealthy = await checkDatabaseConnection()
  
  // 检查外部服务
  const redisHealthy = await checkRedisConnection()
  
  const healthy = dbHealthy && redisHealthy
  
  return c.json({
    status: healthy ? 'ready' : 'unhealthy',
    checks: {
      database: dbHealthy,
      redis: redisHealthy,
    },
  }, healthy ? 200 : 503)
})

app.get('/health/live', (c) => {
  // 简单的存活检查
  return c.json({ status: 'alive' })
})
```

---

## 总结与建议优先级

### 立即修复 (Critical - 1-3 天内)
1. ✅ 移除所有硬编码的测试令牌和默认密钥
2. ✅ 实现环境变量验证机制
3. ✅ 修复 SQL 查询模式，使用 ORM 或查询构建器

### 高优先级 (High - 1 周内)
4. ✅ 实现速率限制
5. ✅ 修复 CORS 配置，使用白名单
6. ✅ 增强文件上传验证
7. ✅ 添加配置验证
8. ✅ 添加安全响应头

### 中优先级 (Medium - 2 周内)
9. ✅ 使用 bcrypt/argon2 哈希密码
10. ✅ 改进错误处理，避免信息泄露
11. ✅ 实现安全的会话管理（JWT + 撤销机制）
12. ✅ 加强输入验证
13. ✅ 配置化数据库路径
14. ✅ 实现审计日志

### 低优先级 (Low - 1 个月内)
15. ✅ 定期运行依赖项安全审计
16. ✅ 完善 API 文档
17. ✅ 添加健康检查端点

---

## 额外建议

### 1. 安全开发流程
- 建立 Code Review 制度，特别关注安全问题
- 使用 pre-commit hook 运行安全检查
- 定期进行安全培训

### 2. 监控和告警
- 实现异常登录检测
- 监控 API 调用频率
- 设置安全事件告警

### 3. 渗透测试
- 定期进行渗透测试
- 使用自动化安全扫描工具
- 建立 Bug Bounty 程序

### 4. 合规性
- 如果处理用户数据，考虑 GDPR、CCPA 等合规要求
- 实现数据加密（静态和传输）
- 建立数据保留和删除策略

---

**审计人**: Claude (subagent: reviewer)  
**审计时间**: 2026-04-06  
**下次审计**: 建议 3 个月后复审
