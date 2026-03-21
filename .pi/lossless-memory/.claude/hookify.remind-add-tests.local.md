---
name: remind-add-tests
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: src/(client|server)/.*\.(ts|tsx)$
  - field: file_path
    operator: not_contains
    pattern: __tests__
  - field: file_path
    operator: not_contains
    pattern: .test.
  - field: file_path
    operator: not_contains
    pattern: .spec.
---

📝 **新文件创建提醒：添加测试**

检测到创建了新的源代码文件，请记得添加对应的测试文件。

## 📂 测试文件位置规则

### 客户端测试

| 源文件位置                    | 测试文件位置                                 | 示例                                                 |
| ----------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `src/client/stores/*.ts`      | `src/client/stores/__tests__/*.test.ts`      | `todoStore.ts` → `__tests__/todoStore.test.ts`       |
| `src/client/services/*.ts`    | `src/client/services/__tests__/*.test.ts`    | `apiClient.ts` → `__tests__/apiClient.test.ts`       |
| `src/client/hooks/*.ts`       | `src/client/hooks/__tests__/*.test.ts`       | `useWebSocket.ts` → `__tests__/useWebSocket.test.ts` |
| `src/client/components/*.tsx` | `src/client/components/__tests__/*.test.tsx` | `App.tsx` → `__tests__/App.test.tsx`                 |

### 服务端测试

| 源文件位置                          | 测试文件位置                              | 示例                                                 |
| ----------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `src/server/module-*/services/*.ts` | `src/server/module-*/__tests__/*.test.ts` | `todo-service.ts` → `__tests__/todo-service.test.ts` |
| `src/server/module-*/routes/*.ts`   | `src/server/module-*/__tests__/*.test.ts` | `todos-routes.ts` → `__tests__/todos-route.test.ts`  |
| `src/server/utils/*.ts`             | `src/server/utils/__tests__/*.test.ts`    | `logger.ts` → `__tests__/logger.test.ts`             |

### 集成测试

| 测试类型     | 文件位置                                     | 用途                     |
| ------------ | -------------------------------------------- | ------------------------ |
| API 集成测试 | `src/server/__tests__/integration/*.test.ts` | 测试完整的 API 流程      |
| E2E 测试     | `e2e/*.spec.ts`                              | 端到端测试（Playwright） |

## 📝 测试文件模板

### Store 测试模板

```typescript
// src/client/stores/__tests__/xxxStore.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useXxxStore } from '../xxxStore'

describe('XxxStore', () => {
  beforeEach(() => {
    // 重置 store 状态
    useXxxStore.setState({ ...initialState })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('应当正确初始化', () => {
    const store = useXxxStore.getState()
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('应当正确执行操作', async () => {
    const { action } = useXxxStore.getState()
    await action({ title: 'Test' })

    const store = useXxxStore.getState()
    expect(store.items).toHaveLength(1)
    expect(store.items[0].title).toBe('Test')
  })
})
```

### Service 测试模板

```typescript
// src/server/module-*/__tests__/xxx-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { XxxService } from '../services/xxx-service'

describe('XxxService', () => {
  let service: XxxService

  beforeEach(() => {
    service = new XxxService()
  })

  afterEach(() => {
    // 清理资源
  })

  it('应当正确执行业务逻辑', async () => {
    const result = await service.doSomething({ param: 'value' })

    expect(result.id).toBeGreaterThan(0)
    expect(result.param).toBe('value')
    expect(result.createdAt).toBeInstanceOf(Date)
  })
})
```

### API Route 测试模板

```typescript
// src/server/module-*/__tests__/xxx-routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import app from '../app'

describe('Xxx Routes', () => {
  beforeEach(async () => {
    // 初始化测试数据
  })

  it('GET /api/xxx 应当返回列表', async () => {
    const res = await app.request('/api/xxx')
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toBeInstanceOf(Array)
    expect(json.data[0].id).toBeDefined()
  })

  it('POST /api/xxx 应当创建新记录', async () => {
    const res = await app.request('/api/xxx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.title).toBe('Test')
  })
})
```

### Component 测试模板

```typescript
// src/client/components/__tests__/Xxx.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Xxx } from '../Xxx';

describe('Xxx Component', () => {
  it('应当正确渲染', () => {
    render(<Xxx title="Test" />);

    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('应当响应交互', async () => {
    const user = userEvent.setup();
    render(<Xxx />);

    await user.click(screen.getByRole('button'));
    expect(screen.getByText('Clicked')).toBeInTheDocument();
  });
});
```

## 🧪 运行测试

```bash
# 运行相关测试（智能测试）
npm run test:smart:staged

# 运行所有测试
npm run test:all

# 运行特定文件的测试
npm run test -- xxxStore.test.ts

# 监听模式
npm run test

# 查看覆盖率
npm run test:coverage
```

## ✅ 测试规范检查清单

- [ ] 测试文件放在正确的 `__tests__/` 目录
- [ ] 测试文件命名为 `*.test.ts` 或 `*.test.tsx`
- [ ] 使用 `beforeEach` 和 `afterEach` 管理测试状态
- [ ] 每个测试包含 2-3 个具体断言
- [ ] 验证具体的业务值，而非简单的 true/false
- [ ] 测试覆盖率 > 80%

## 📚 参考文档

详细测试规范请查看：[Testing 规范](./rules/60-testing-standards.md)

**记住：新功能必须有对应的测试！**
