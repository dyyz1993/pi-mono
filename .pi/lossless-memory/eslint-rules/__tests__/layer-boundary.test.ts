import { RuleTester } from 'eslint'
import { layerBoundary } from '../layer-boundary.js'

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
})

// 测试1: 业务层导入框架内部文件应该报错
ruleTester.run('layer-boundary - import framework internal files', layerBoundary, {
  valid: [],
  invalid: [
    {
      code: `import { WSClientImpl } from '@shared/core/ws-client'`,
      filename: '/project/src/shared/modules/chat/index.ts',
      errors: [{ messageId: 'importFrameworkInternal' }],
    },
    {
      code: `import { SSEClientImpl } from '@shared/core/sse-client'`,
      filename: '/project/src/server/module-chat/services/chat.ts',
      errors: [{ messageId: 'importFrameworkInternal' }],
    },
    {
      code: `import { runtime } from '@server/core/runtime'`,
      filename: '/project/src/client/stores/chatStore.ts',
      errors: [{ messageId: 'importFrameworkInternal' }],
    },
  ],
})

// 测试2: 业务层导入框架层需要注释
ruleTester.run('layer-boundary - import framework without comment', layerBoundary, {
  valid: [],
  invalid: [
    {
      code: `import { createTypedRuntime } from '@server/core/typed-runtime'`,
      filename: '/project/src/server/module-chat/services/chat.ts',
      errors: [{ messageId: 'missingFrameworkImportComment' }],
    },
  ],
})

// 测试3: 业务层导入框架层带注释应该通过
ruleTester.run('layer-boundary - import framework with comment', layerBoundary, {
  valid: [
    {
      code: `// @framework-import 用于创建类型安全的 WebSocket runtime
import { createTypedRuntime } from '@server/core/typed-runtime'`,
      filename: '/project/src/server/module-chat/services/chat.ts',
    },
  ],
  invalid: [],
})

// 测试4: 业务层修改框架层代码应该报错
ruleTester.run('layer-boundary - modify framework code', layerBoundary, {
  valid: [],
  invalid: [
    {
      code: `runtime.registerRPC('echo', handler)`,
      filename: '/project/src/server/module-chat/services/chat.ts',
      errors: [{ messageId: 'modifyFrameworkCode' }],
    },
    {
      code: `runtime.broadcast('notification', data)`,
      filename: '/project/src/client/stores/chatStore.ts',
      errors: [{ messageId: 'modifyFrameworkCode' }],
    },
  ],
})

// 测试5: 业务层修改框架层代码带注释应该通过
ruleTester.run('layer-boundary - modify framework with comment', layerBoundary, {
  valid: [
    {
      code: `// @framework-allow-modification 注册 Chat RPC 处理器
runtime.registerRPC('echo', handler)`,
      filename: '/project/src/server/module-chat/services/chat.ts',
    },
  ],
  invalid: [],
})

// 测试6: 框架层文件不受限制
ruleTester.run('layer-boundary - framework files', layerBoundary, {
  valid: [
    {
      code: `import { runtime } from './runtime'
runtime.registerRPC('test', handler)`,
      filename: '/project/src/server/core/typed-runtime.ts',
    },
    {
      code: `export class WSClientImpl {}`,
      filename: '/project/src/shared/core/ws-client.ts',
    },
  ],
  invalid: [],
})

console.log('✅ All layer-boundary tests passed!')
