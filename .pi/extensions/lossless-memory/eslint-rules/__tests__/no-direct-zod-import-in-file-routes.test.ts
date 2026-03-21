import { RuleTester } from 'eslint'
import { noDirectZodImportInFileRoutes } from '../no-direct-zod-import-in-file-routes.js'

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
})

ruleTester.run('no-direct-zod-import-in-file-routes', noDirectZodImportInFileRoutes, {
  valid: [
    // 正确的导入方式 - 从 @hono/zod-openapi 导入 z
    {
      code: "import { z } from '@hono/zod-openapi'",
      filename: 'src/server/module-file/routes/file-routes.ts',
    },
    // 其他文件不受限制
    {
      code: "import { z } from '@hono/zod-openapi'",
      filename: 'src/server/other-file.ts',
    },
    // file-routes.ts 中从 zod 导入其他内容（非 z）是允许的
    {
      code: "import { ZodType } from 'zod'",
      filename: 'src/server/module-file/routes/file-routes.ts',
    },
  ],
  invalid: [
    // 错误：直接从 zod 导入 z
    {
      code: "import { z } from 'zod'",
      filename: 'src/server/module-file/routes/file-routes.ts',
      errors: [{ messageId: 'noDirectZodImport' }],
    },
    // 错误：混合导入中包含 z
    {
      code: "import { z, ZodType } from 'zod'",
      filename: 'src/server/module-file/routes/file-routes.ts',
      errors: [{ messageId: 'noDirectZodImport' }],
    },
  ],
})

console.log('All tests passed!')
