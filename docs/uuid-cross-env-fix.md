# UUID 工具函数 - 跨环境兼容性修复

## 问题

错误日志显示：
```
crypto.randomUUID is not a function
```

这个错误发生在某些环境（如 IDE 扩展、浏览器构建）中，原因是：
1. 代码混用了 `crypto.randomUUID()` (Node.js) 和其他方式
2. 在不支持的环境中调用此 API 导致运行时错误

## 解决方案

创建了跨环境兼容的 UUID 工具函数，采用**条件检查 + 降级方案**：

### 核心工具函数

**`packages/coding-agent/src/utils/uuid.ts`**
```typescript
export function generateUUID(): string {
	// 优先使用 crypto.randomUUID() (Node.js 15.6.0+ 和现代浏览器)
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}

	// 降级方案：生成 UUID 格式的随机字符串
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

export function generateShortId(prefix = ""): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

export function generateOAuthState(): string {
	return generateUUID();
}
```

**`packages/web-ui/src/utils/uuid.ts`** - 浏览器版本（相同逻辑）

### 修改的文件

1. **创建工具函数**
   - `packages/coding-agent/src/utils/uuid.ts`
   - `packages/web-ui/src/utils/uuid.ts`

2. **更新使用位置**
   - `packages/coding-agent/src/modes/interactive/interactive-mode.ts` - 剪贴板文件名
   - `packages/coding-agent/src/modes/rpc/rpc-mode.ts` - RPC 请求 ID
   - `packages/web-ui/src/dialogs/CustomProviderDialog.ts` - 自定义提供者 ID
   - `packages/web-ui/example/src/main.ts` - 会话 ID
   - `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/index.ts` - OAuth 状态

3. **导出工具函数**
   - `packages/coding-agent/src/index.ts` - 导出给扩展使用
   - `packages/web-ui/src/index.ts` - 导出给示例使用

4. **添加测试**
   - `packages/coding-agent/test/uuid-utils.test.ts` - 13 个测试用例

## 优势

✅ **跨环境兼容** - Node.js 和浏览器都能工作
✅ **优雅降级** - 当 crypto.randomUUID() 不可用时自动降级
✅ **不破坏构建** - 不使用顶层导入，避免浏览器/Vite 构建问题
✅ **易于测试** - 所有 UUID 生成逻辑集中在一个地方
✅ **类型安全** - 明确的 TypeScript 类型定义

## 为什么不使用 `globalThis.crypto.randomUUID()`

之前的尝试直接改为 `globalThis.crypto.randomUUID()` 是**错误的**，因为：
1. ❌ 代码风格奇怪，在前端代码中直接暴露全局 API
2. ❌ 没有处理 API 不可用的情况
3. ❌ 仍然可能在某些环境中失败

正确的做法是**封装在工具函数中**，提供条件检查和降级方案。

## 参考

此方案参考了 `packages/ai/src/providers/openai-codex-responses.ts` 中的实现：
```typescript
function createCodexRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `codex_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
```

注释也明确说明：
```typescript
// NEVER convert to top-level runtime imports - breaks browser/Vite builds (web-ui)
```

## 测试结果

✅ 13/13 测试通过
```
✓ generateUUID() should generate valid UUID format
✓ generateUUID() should generate unique UUIDs
✓ generateUUID() should generate 36-character strings
✓ generateUUID() should work consistently across multiple calls
✓ generateShortId() should generate unique short IDs
✓ generateShortId() should support custom prefix
✓ generateShortId() should generate shorter than UUIDs
✓ generateOAuthState() should generate unique OAuth states
✓ generateOAuthState() should generate UUID-like strings
✓ integration with actual usage should work with clipboard file naming pattern
✓ integration with actual usage should work with RPC request IDs
✓ integration with actual usage should work with custom provider IDs
✓ integration with actual usage should work with OAuth state parameters
```
