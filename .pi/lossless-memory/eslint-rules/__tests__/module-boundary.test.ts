import { RuleTester } from 'eslint'
import { moduleBoundary } from '../module-boundary'

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
  },
})

describe('module-boundary', () => {
  ruleTester.run('module-boundary', moduleBoundary, {
    valid: [
      {
        filename: '/project/src/client/components/Test.tsx',
        code: `import { something } from '@shared/core'`,
      },
      {
        filename: '/project/src/client/components/Test.tsx',
        code: `import { something } from './local'`,
      },
      {
        filename: '/project/src/cli/index.ts',
        code: `import { something } from '@shared/core'`,
      },
      {
        filename: '/project/src/admin/pages/Test.tsx',
        code: `import { something } from '@shared/core'`,
      },
      {
        filename: '/project/src/client/components/Test.tsx',
        code: `import { something } from '../components/AuthButton'`,
      },
    ],
    invalid: [
      {
        filename: '/project/src/client/components/Test.tsx',
        code: `import { something } from '../../admin/someFile'`,
        errors: [
          {
            messageId: 'directCrossModuleImport',
            data: { fromModule: 'client', toModule: 'admin' },
          },
        ],
      },
      {
        filename: '/project/src/client/components/Test.tsx',
        code: `import { something } from '../../cli/someFile'`,
        errors: [
          {
            messageId: 'directCrossModuleImport',
            data: { fromModule: 'client', toModule: 'cli' },
          },
        ],
      },
      {
        filename: '/project/src/admin/pages/Test.tsx',
        code: `import { something } from '../../client/someFile'`,
        errors: [
          {
            messageId: 'directCrossModuleImport',
            data: { fromModule: 'admin', toModule: 'client' },
          },
        ],
      },
      {
        filename: '/project/src/cli/index.ts',
        code: `import { something } from '../admin/someFile'`,
        errors: [
          {
            messageId: 'directCrossModuleImport',
            data: { fromModule: 'cli', toModule: 'admin' },
          },
        ],
      },
    ],
  })
})
