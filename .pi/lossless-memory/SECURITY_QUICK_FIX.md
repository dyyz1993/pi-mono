# 🚨 安全问题快速修复指南

**紧急修复清单** - 请按优先级顺序修复

---

## 🔴 立即修复（Critical - 今天内）

### 1. 移除硬编码令牌

**文件**: `src/server/utils/auth.ts` 和 `src/server/middleware/auth.ts`

```bash
# 删除这些硬编码令牌
'super-admin-token'
'customer-service-token'
'user-token'
'admin-token'
```

**快速修复**:
```typescript
// src/server/middleware/auth.ts
export function authMiddleware(options: AuthMiddlewareOptions = {}): MiddlewareHandler {
  const secretKey = options.secretKey ?? process.env.AUTH_SECRET_KEY
  
  // ✅ 生产环境必须提供密钥
  if (!secretKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET_KEY must be set in production')
    }
    console.warn('⚠️ Using development secret key. DO NOT use in production!')
  }

  return async (c, next) => {
    // ... 原有逻辑
    
    // ✅ 禁止测试令牌在生产环境使用
    if (process.env.NODE_ENV === 'production' && token.startsWith('test-')) {
      throw AuthenticationError.tokenInvalid()
    }
    
    // ... 其他逻辑
  }
}
```

---

### 2. 强制要求环境变量

**文件**: `src/server/config.ts`

```typescript
// ✅ 添加环境变量验证
export function getRequiredEnv(key: string): string {
  const value = process.env[key]
  
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`❌ Required environment variable ${key} is not set`)
    }
    console.warn(`⚠️ ${key} is not set, using development default`)
    return ''
  }
  
  return value
}

export function getAppConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3010', 10),
    security: {
      authSecretKey: getRequiredEnv('AUTH_SECRET_KEY'),
      fileSecretKey: getRequiredEnv('FILE_SECRET_KEY'),
    },
    database: {
      // ... 数据库配置
    }
  }
}
```

**创建 `.env.example`**:
```bash
# 必需的环境变量
AUTH_SECRET_KEY=your-secure-random-string-min-32-chars
FILE_SECRET_KEY=another-secure-random-string-min-32-chars

# 数据库配置
DB_DRIVER=sqlite
SQLITE_PATH=./data/production.db

# 可选
NODE_ENV=production
PORT=3010
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

---

### 3. 修复密码验证

**文件**: `src/server/module-admin/services/admin-service.ts`

```bash
npm install argon2
```

```typescript
import { hash, verify } from 'argon2'

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const user = await db.users.findByUsername(data.username)
  
  // ✅ 恒定时间比较防止时序攻击
  if (!user) {
    await hash('dummy-password-for-timing-attack-prevention')
    throw new Error('Invalid credentials')
  }

  // ✅ 验证哈希密码
  const isValid = await verify(user.passwordHash, data.password)
  
  if (!isValid) {
    throw new Error('Invalid credentials')
  }

  // ✅ 生成 JWT（而不是硬编码令牌）
  const token = generateJWT({
    userId: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 小时
  })
  
  return { user, token }
}

export async function register(data: RegisterRequest): Promise<User> {
  // ✅ 密码强度验证
  if (data.password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }
  
  // ✅ 哈希密码
  const passwordHash = await hash(data.password)
  
  const user = await db.users.create({
    ...data,
    passwordHash,
  })
  
  return user
}
```

---

## 🟠 本周内修复（High）

### 4. 添加速率限制

```bash
npm install hono-rate-limiter
```

```typescript
// src/server/middleware/rate-limit.ts
import { rateLimiter } from 'hono-rate-limiter'

export const globalRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,  // 15 分钟
  max: 100,
  message: { error: 'Too many requests' }
})

export const authRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts' }
})

// src/server/app.ts
import { globalRateLimit, authRateLimit } from './middleware/rate-limit'

app.use('*', globalRateLimit)
app.use('/admin/login', authRateLimit)
app.use('/admin/register', authRateLimit)
```

---

### 5. 修复 CORS 配置

```typescript
// src/server/middleware/cors.ts
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:5173',
]

export function corsMiddleware(options: CorsOptions = {}): MiddlewareHandler {
  return cors({
    origin: (origin) => {
      // 开发环境允许所有
      if (process.env.NODE_ENV === 'development') {
        return origin
      }
      
      // 生产环境白名单
      return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
}
```

---

### 6. 添加安全响应头

```bash
npm install hono-secure-headers
```

```typescript
// src/server/app.ts
import { secureHeaders } from 'hono-secure-headers'

app.use('*', secureHeaders())

// 或手动添加
app.use('*', async (c, next) => {
  await next()
  
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('X-XSS-Protection', '1; mode=block')
  
  if (process.env.NODE_ENV === 'production') {
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
})
```

---

### 7. 增强文件上传验证

```typescript
// src/server/utils/file-storage.ts
export function validateFile(
  file: { name: string; type: string; size: number },
  config: FileUploadConfig
): { valid: boolean; error?: string } {
  // ✅ 文件大小检查
  if (file.size > config.maxFileSize) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${config.maxFileSize} bytes`,
    }
  }

  // ✅ MIME 类型白名单
  if (!config.allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type "${file.type}" is not allowed`,
    }
  }

  // ✅ 扩展名白名单
  const ext = extname(file.name).toLowerCase()
  if (!config.allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `File extension "${ext}" is not allowed`,
    }
  }

  // ✅ 文件名安全检查
  if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
    return {
      valid: false,
      error: 'Invalid filename',
    }
  }

  return { valid: true }
}

// ✅ 添加文件内容验证
export async function validateFileContent(
  filePath: string,
  mimeType: string
): Promise<boolean> {
  const fd = await open(filePath, 'r')
  const buffer = Buffer.alloc(8)
  await fd.read(buffer, 0, 8, 0)
  await fd.close()

  // 文件魔数检查
  const magicNumbers = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
  }

  const expected = magicNumbers[mimeType]
  if (expected && !expected.every((byte, i) => buffer[i] === byte)) {
    return false
  }

  return true
}
```

---

## 🟡 两周内修复（Medium）

### 8. 实现审计日志

```typescript
// src/server/utils/audit-log.ts
import { db } from './db'

export async function auditLog(
  action: string,
  userId: string,
  details: Record<string, any>,
  request: Request
) {
  await db.auditLogs.create({
    action,
    userId,
    ipAddress: request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    timestamp: new Date(),
    details: JSON.stringify(details),
  })
}

// 使用示例
app.post('/admin/users', authMiddleware(), async (c) => {
  const user = c.get('authUser')
  const data = await c.req.json()
  
  const newUser = await createUser(data)
  
  await auditLog('user.create', user.id, {
    newUserId: newUser.id,
    username: newUser.username,
  }, c.req.raw)
  
  return c.json({ success: true, user: newUser })
})
```

---

### 9. 改进错误处理

```typescript
// src/server/utils/app-error.ts
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
    public code?: string
  ) {
    super(message)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, true, 'VALIDATION_ERROR')
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, true, 'AUTHENTICATION_ERROR')
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, true, 'AUTHORIZATION_ERROR')
  }
}

// src/server/middleware/error-handler.ts
export function errorHandlerMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    try {
      await next()
    } catch (error) {
      const isDev = process.env.NODE_ENV === 'development'
      
      if (error instanceof AppError) {
        return c.json({
          error: error.message,
          code: error.code,
          ...(isDev && { stack: error.stack })
        }, error.statusCode)
      }

      // 未预期的错误
      console.error('Unexpected error:', error)
      
      return c.json({
        error: isDev 
          ? (error as Error).message 
          : 'Internal server error',
        ...(isDev && { stack: (error as Error).stack })
      }, 500)
    }
  }
}
```

---

### 10. 添加健康检查端点

```typescript
// src/server/routes/health.ts
import { Hono } from 'hono'

const health = new Hono()

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  })
})

health.get('/health/ready', async (c) => {
  const checks = {
    database: false,
    // redis: false, // 如果使用 Redis
  }

  try {
    // 检查数据库连接
    await db.execute('SELECT 1')
    checks.database = true
  } catch (error) {
    console.error('Database health check failed:', error)
  }

  const healthy = Object.values(checks).every(v => v)

  return c.json({
    status: healthy ? 'ready' : 'unhealthy',
    checks,
  }, healthy ? 200 : 503)
})

health.get('/health/live', (c) => {
  return c.json({ status: 'alive' })
})

export default health

// src/server/app.ts
import health from './routes/health'
app.route('/', health)
```

---

## 检查清单

修复完成后，请验证：

- [ ] 所有硬编码令牌已移除
- [ ] 环境变量已配置且必需
- [ ] 密码使用 bcrypt/argon2 哈希
- [ ] 速率限制已启用
- [ ] CORS 使用白名单
- [ ] 安全响应头已添加
- [ ] 文件上传验证已增强
- [ ] 审计日志已实现
- [ ] 错误处理已改进
- [ ] 健康检查端点已添加
- [ ] 所有测试通过
- [ ] 生产环境已重新部署

---

**重要**: 修复完成后，请运行以下命令验证：

```bash
# 运行测试
npm test

# 运行安全审计
npm audit

# 检查环境变量
node -e "console.log(process.env.AUTH_SECRET_KEY ? '✅ AUTH_SECRET_KEY set' : '❌ AUTH_SECRET_KEY missing')"

# 启动生产环境前验证
NODE_ENV=production npm run build
NODE_ENV=production npm run start
```
