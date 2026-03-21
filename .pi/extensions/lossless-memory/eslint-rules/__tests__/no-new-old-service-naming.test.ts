import { RuleTester } from 'eslint'
import { noNewOldServiceNaming } from '../no-new-old-service-naming.js'

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
})

ruleTester.run('no-new-old-service-naming', noNewOldServiceNaming, {
  valid: [
    // 合法的版本号命名
    {
      code: 'const service = {}',
      filename: 'permission-service-V1.ts',
    },
    {
      code: 'const service = {}',
      filename: 'user-service-V2.ts',
    },
    {
      code: 'const service = {}',
      filename: 'order-service-V10.ts',
    },
    // 正常的命名
    {
      code: 'const newUser = {}',
      filename: 'user-service.ts',
    },
    {
      code: 'const renewed = true',
      filename: 'order-service.ts',
    },
  ],
  invalid: [
    // 文件名包含 -new
    {
      code: 'const service = {}',
      filename: 'permission-service-new.ts',
      errors: [{ messageId: 'noNewOldInFilename' }],
    },
    // 文件名包含 -old
    {
      code: 'const service = {}',
      filename: 'permission-service-old.ts',
      errors: [{ messageId: 'noNewOldInFilename' }],
    },
    // 文件名包含 .new.
    {
      code: 'const service = {}',
      filename: 'permission.new.service.ts',
      errors: [{ messageId: 'noNewOldInFilename' }],
    },
    // 代码中包含 干new
    {
      code: 'const pattern = "干new"',
      filename: 'service.ts',
      errors: [{ messageId: 'noNewOldInContent' }],
    },
    // 代码中包含 干old
    {
      code: 'const pattern = "干old"',
      filename: 'service.ts',
      errors: [{ messageId: 'noNewOldInContent' }],
    },
    // 标识符包含 _old
    {
      code: 'const service_old = {}',
      filename: 'test.ts',
      errors: [{ messageId: 'noNewOldSuffix' }],
    },
  ],
})

console.log('All tests passed!')
