# 验证码拦截器测试指南

## 🚀 快速开始

### 1. 启动开发服务器

```bash
npm run dev
```

### 2. 访问测试页面

打开浏览器访问：`http://localhost:5173/admin/test-captcha`

## 📋 测试场景

### 场景 1: 正常请求（无拦截）

**测试按钮**: ✅ 测试正常请求（无拦截）

**预期行为**:

- 请求成功返回数据
- 不触发任何拦截
- 显示系统统计数据

**验证点**:

- ✅ 请求成功
- ✅ 无验证码弹窗
- ✅ 返回正常数据

---

### 场景 2: 403 验证码拦截

**测试按钮**: 🔐 测试 403 验证码拦截

**预期行为**:

1. 发送请求
2. 服务端返回 403 状态码
3. 自动弹出验证码弹窗
4. 用户完成验证码
5. 自动重试原请求
6. 返回成功数据

**验证点**:

- ✅ 验证码弹窗自动显示
- ✅ 验证码图片正确加载
- ✅ 输入验证码后请求自动重试
- ✅ 请求成功返回

**测试步骤**:

1. 点击按钮
2. 观察验证码弹窗出现
3. 输入验证码（测试环境可输入任意值）
4. 点击提交
5. 观察请求自动重试并成功

---

### 场景 3: 429 限流验证码

**测试按钮**: ⏱️ 测试 429 限流验证码

**预期行为**:

1. 发送请求
2. 服务端返回 429 状态码（请求过于频繁）
3. 自动弹出验证码弹窗
4. 用户完成验证码
5. 自动重试原请求
6. 返回成功数据

**验证点**:

- ✅ 验证码弹窗显示"请求过于频繁"提示
- ✅ 验证码验证流程正常
- ✅ 请求重试成功

---

### 场景 4: 401 未授权（跳转登录）

**测试按钮**: 🚫 测试 401 未授权（跳转登录）

**预期行为**:

1. 发送请求
2. 服务端返回 401 状态码
3. 自动清除登录态
4. 跳转到登录页

**验证点**:

- ✅ 自动清除 token
- ✅ 自动跳转到 `/admin/login`
- ✅ 显示提示消息

**注意**: 此测试会清除当前登录状态，需要重新登录

---

### 场景 5: 并发请求测试

**测试按钮**: 🔄 测试并发请求（验证码期间排队）

**预期行为**:

1. 同时发送 3 个请求
2. 第一个请求触发 403，显示验证码
3. 其他 2 个请求自动排队等待
4. 用户完成验证码
5. 所有排队的请求自动重试
6. 全部请求成功返回

**验证点**:

- ✅ 只显示一个验证码弹窗
- ✅ 所有请求自动排队
- ✅ 验证成功后所有请求自动重试
- ✅ 所有请求都返回成功

**测试步骤**:

1. 点击按钮
2. 观察只有一个验证码弹窗
3. 完成验证码
4. 观察所有 3 个请求都成功

---

## 🎯 验证码弹窗功能

### 图片验证码（默认）

**功能**:

- 显示验证码图片
- 点击图片刷新验证码
- 输入框输入验证码
- 提交验证

**测试**:

1. 点击验证码图片可刷新
2. 输入验证码
3. 点击提交按钮
4. 观察验证结果

### iframe 验证码（可选）

**配置方式**:

```typescript
// 在 requestInterceptor.ts 中修改
const success = await this.callbacks.onShowCaptcha({
  type: 'iframe', // 改为 iframe
  captchaUrl: '/api/captcha-iframe',
})
```

**功能**:

- 嵌入第三方验证码页面
- 自动监听验证成功消息
- 自动关闭弹窗

---

## 🐛 调试技巧

### 1. 查看请求队列

在浏览器控制台输入：

```javascript
// 查看当前拦截器状态
console.log('Pending requests:', window.__INTERCEPTOR_DEBUG__)
```

### 2. 模拟验证码成功

在浏览器控制台输入：

```javascript
// 直接触发验证成功
window.postMessage('CAPTCHA_SUCCESS', '*')
```

### 3. 查看网络请求

打开浏览器开发者工具 → Network 标签：

- 观察请求状态码
- 观察请求重试
- 观察请求头中的 Authorization

---

## 📊 测试检查清单

### 基础功能

- [ ] 正常请求不触发拦截
- [ ] 403 触发验证码弹窗
- [ ] 429 触发验证码弹窗
- [ ] 401 跳转登录页
- [ ] 验证码图片可刷新
- [ ] 验证码输入后可提交

### 高级功能

- [ ] 并发请求自动排队
- [ ] 验证成功后自动重试
- [ ] 所有排队请求都成功
- [ ] 验证码弹窗只显示一次

### 边界情况

- [ ] 验证码取消后请求失败
- [ ] 网络错误正确处理
- [ ] 超时请求正确处理
- [ ] 重复点击按钮防抖

---

## 🔧 自定义测试

### 修改服务端响应

编辑 `src/server/module-admin/routes/admin-routes.ts`:

```typescript
// 修改 403 测试接口
.get('/admin/test-captcha-403', async c => {
  // 自定义返回数据
  return c.json({
    success: false,
    error: '自定义错误消息',
    data: { custom: 'field' }
  }, 403)
})
```

### 修改验证码类型

编辑 `src/admin/services/requestInterceptor.ts`:

```typescript
// 修改验证码配置
const success = await this.callbacks.onShowCaptcha({
  type: 'iframe', // 或 'image'
  captchaUrl: '/custom-captcha-url',
})
```

### 添加自定义状态码

编辑 `src/admin/services/requestInterceptor.ts`:

```typescript
private shouldShowCaptcha(response: Response): boolean {
  return response.status === 403 ||
         response.status === 429 ||
         response.status === 418  // 添加自定义状态码
}
```

---

## 📝 常见问题

### Q: 验证码图片加载失败？

**A**: 检查服务端验证码接口是否正常：

```bash
curl http://localhost:5173/api/captcha
```

### Q: 验证码提交后没有反应？

**A**: 检查验证码验证接口：

```bash
curl -X POST http://localhost:5173/api/verify-captcha \
  -H "Content-Type: application/json" \
  -d '{"code":"test"}'
```

### Q: 并发请求没有排队？

**A**: 确保拦截器状态正确：

```javascript
// 在控制台检查
console.log(useCaptchaStore.getState())
```

### Q: 401 没有跳转登录页？

**A**: 检查路由配置和 token 存储：

```javascript
// 检查 token
localStorage.getItem('admin-storage')
```

---

## 🎉 测试完成

完成所有测试后，你的验证码拦截器已经可以正常工作了！

**下一步**:

1. 在实际业务中使用
2. 根据需求调整配置
3. 添加更多自定义功能
