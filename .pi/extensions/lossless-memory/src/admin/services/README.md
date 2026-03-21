# 请求拦截器使用说明

## 功能特性

✅ **统一拦截**：自动拦截所有 HTTP 请求  
✅ **登录态处理**：401 状态码自动跳转登录页  
✅ **验证码处理**：403/429 状态码自动弹出验证码  
✅ **请求阻塞**：验证码显示期间，所有请求自动排队等待  
✅ **请求重放**：验证成功后自动重试所有失败的请求  
✅ **灵活扩展**：支持 iframe、图片验证码等多种形式

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    请求流程                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  客户端请求 ──→ 拦截器 ──→ 检查验证码状态              │
│                    │                   │                │
│                    │                   ├─ 显示中 ─→ 排队│
│                    │                   │                │
│                    │                   └─ 正常 ─→ 发送  │
│                    │                                    │
│                    └─→ 响应处理                         │
│                         ├─ 401 ─→ 跳转登录             │
│                         ├─ 403/429 ─→ 显示验证码       │
│                         │              ↓                │
│                         │         验证成功 ─→ 重放请求  │
│                         └─ 其他 ─→ 返回响应             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 核心文件

### 1. RequestInterceptor (`src/admin/services/requestInterceptor.ts`)

拦截器核心类，负责：

- 请求拦截和重试
- 验证码状态管理
- 请求队列管理

### 2. CaptchaStore (`src/admin/stores/captchaStore.ts`)

验证码状态管理，使用 Zustand：

- 控制验证码弹窗显示/隐藏
- 管理验证码类型（iframe/image）
- 处理验证结果

### 3. CaptchaModal (`src/admin/components/CaptchaModal.tsx`)

验证码弹窗组件：

- 支持图片验证码
- 支持 iframe 验证码
- 自动刷新验证码

### 4. ApiClient (`src/admin/services/apiClient.ts`)

API 客户端配置：

- 集成拦截器
- 自动添加认证 token
- 处理登录态

## 使用示例

### 基本使用

```typescript
import { apiClient } from '@/admin/services/apiClient'

// 普通请求 - 自动处理拦截
const response = await apiClient.api.users.$get()
const data = await response.json()

// POST 请求 - 自动处理拦截
const result = await apiClient.api.users.$post({
  json: { name: 'John', email: 'john@example.com' },
})
```

### 自定义验证码类型

```typescript
// 在 requestInterceptor.ts 中修改
private async handleCaptcha(retryRequest: () => Promise<Response>): Promise<Response> {
  // 自定义验证码类型
  const success = await this.callbacks.onShowCaptcha({
    type: 'iframe',  // 或 'image'
    captchaUrl: '/api/custom-captcha',
  })
  // ...
}
```

### 服务端验证码接口

```typescript
// 服务端 - 生成验证码
app.get('/api/captcha', c => {
  const captcha = generateCaptcha()
  // 存储到 session 或 redis
  await storeCaptcha(captcha.id, captcha.code)

  return c.json({
    id: captcha.id,
    image: captcha.imageBase64,
  })
})

// 服务端 - 验证验证码
app.post('/api/verify-captcha', async c => {
  const { code } = await c.req.json()

  // 验证逻辑
  const isValid = await verifyCaptcha(code)

  if (isValid) {
    return c.json({ success: true })
  } else {
    return c.json({ success: false, error: '验证码错误' }, 400)
  }
})
```

## 工作流程

### 1. 正常请求

```
请求 → 添加 Token → 发送 → 返回响应
```

### 2. 401 未授权

```
请求 → 添加 Token → 发送 → 401 响应
                              ↓
                        清除 Token
                              ↓
                        跳转登录页
```

### 3. 403/429 需要验证码

```
请求 A → 添加 Token → 发送 → 403 响应
                              ↓
                        显示验证码弹窗
                              ↓
请求 B → 排队等待 ──────────┐
请求 C → 排队等待 ──────────┤
                              ↓
                        用户完成验证
                              ↓
                        重放请求 A
                              ↓
                        处理队列（重放 B、C）
```

## 配置选项

### 拦截器配置

```typescript
interface InterceptorCallbacks {
  // 401 状态码回调
  onShowLogin: () => void

  // 显示验证码回调
  onShowCaptcha: (config: { type: 'iframe' | 'image'; captchaUrl?: string }) => Promise<boolean>
}
```

### 验证码状态

```typescript
interface CaptchaState {
  isOpen: boolean // 是否显示
  type: 'iframe' | 'image' // 验证码类型
  captchaUrl: string // 验证码 URL
  resolveCaptcha: Function // 验证结果回调

  show: (options) => Promise<boolean> // 显示验证码
  resolve: (success: boolean) => void // 验证结果
  close: () => void // 关闭弹窗
}
```

## 注意事项

1. **请求幂等性**：确保重放的请求是幂等的（GET 请求天然幂等）
2. **请求超时**：长时间阻塞可能导致请求超时，建议设置合理的超时时间
3. **并发控制**：大量并发请求可能影响性能，建议控制并发数量
4. **验证码安全**：验证码应该有时效性，避免被重复使用

## 扩展功能

### 添加自定义状态码处理

```typescript
// 在 requestInterceptor.ts 中
private async handleResponseStatus(
  response: Response,
  retryRequest: () => Promise<Response>
): Promise<Response> {
  // 添加自定义状态码处理
  if (response.status === 429) {
    // 限流处理
    return this.handleRateLimit(retryRequest)
  }

  if (response.status === 503) {
    // 服务不可用处理
    return this.handleServiceUnavailable()
  }

  // ...
}
```

### 添加请求日志

```typescript
// 在 requestInterceptor.ts 中
async intercept(url: string, init: RequestInit): Promise<Response> {
  const startTime = Date.now()

  console.log(`[Request] ${init.method} ${url}`)

  try {
    const response = await request()
    const duration = Date.now() - startTime

    console.log(`[Response] ${response.status} ${url} (${duration}ms)`)

    return response
  } catch (error) {
    console.error(`[Error] ${url}`, error)
    throw error
  }
}
```

## 测试

```bash
# 运行测试
npm test

# 测试覆盖率
npm run test:coverage
```

## 相关文档

- [Hono Client 文档](https://hono.dev/docs/guides/rpc)
- [Zustand 状态管理](https://zustand-demo.pmnd.rs/)
- [Ant Design Modal](https://ant.design/components/modal)
