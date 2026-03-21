/**
 * @framework-baseline 99945e0fd966c3a7
 */

import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { requireHonoChainSyntax } from './eslint-rules/require-hono-chain-syntax.js'
import { requireTypeSafeTestClient } from './eslint-rules/require-type-safe-test-client.js'
import { noAmbiguousFilePaths } from './eslint-rules/no-ambiguous-file-paths.js'
import { noUtilFunctionsInService } from './eslint-rules/no-util-functions-in-service.js'
import { noDirectWsSse } from './eslint-rules/no-direct-ws-sse.js'
import { protectWsSseInterface } from './eslint-rules/protect-ws-sse-interface.js'
import { noBooleanSuccess } from './eslint-rules/no-boolean-success.js'
import { middlewareLocation, noMiddlewareOutsideDir } from './eslint-rules/middleware-location.js'
import { e2eTestLocation, noE2ETestOutsideDir } from './eslint-rules/e2e-test-location.js'
import { layerBoundary } from './eslint-rules/layer-boundary.js'
import { requireResponseHelpers } from './eslint-rules/require-response-helpers.js'
import { noInlineSchema } from './eslint-rules/no-inline-schema.js'
import { enforceValidMethod } from './eslint-rules/enforce-valid-method.js'
import { frameworkProtect } from './eslint-rules/framework-protect.js'
import { preferSharedTypes } from './eslint-rules/prefer-shared-types.js'
import { noTypeAssertionInRpc } from './eslint-rules/no-type-assertion-in-rpc.js'
import { noAnyOnApiclient } from './eslint-rules/no-any-on-apiclient.js'
import { noTypeAssertionOnSharedTypes } from './eslint-rules/no-type-assertion-on-shared-types.js'
import { noDirectFetch } from './eslint-rules/no-direct-fetch.js'
import { flatRoutesServices } from './eslint-rules/flat-routes-services.js'
import { noMiddlewareInRoutes } from './eslint-rules/no-middleware-in-routes.js'
import { noDisableDirectFetch } from './eslint-rules/no-disable-direct-fetch.js'
import { noNewOldServiceNaming } from './eslint-rules/no-new-old-service-naming.js'
import { noDirectZodImportInFileRoutes } from './eslint-rules/no-direct-zod-import-in-file-routes.js'
import { requireFileOpenapiProps } from './eslint-rules/require-file-openapi-props.js'
import { moduleBoundary } from './eslint-rules/module-boundary.js'
import { limitTypeComplexity } from './eslint-rules/limit-type-complexity.js'

const localRules = {
  rules: {
    'require-hono-chain-syntax': requireHonoChainSyntax,
    'require-type-safe-test-client': requireTypeSafeTestClient,
    'no-ambiguous-file-paths': noAmbiguousFilePaths,
    'no-util-functions-in-service': noUtilFunctionsInService,
    'no-direct-ws-sse': noDirectWsSse,
    'protect-ws-sse-interface': protectWsSseInterface,
    'no-boolean-success': noBooleanSuccess,
    'middleware-location': middlewareLocation,
    'no-middleware-outside-dir': noMiddlewareOutsideDir,
    'e2e-test-location': e2eTestLocation,
    'no-e2e-test-outside-dir': noE2ETestOutsideDir,
    'layer-boundary': layerBoundary,
    'require-response-helpers': requireResponseHelpers,
    'no-inline-schema': noInlineSchema,
    'enforce-valid-method': enforceValidMethod,
    'framework-protect': frameworkProtect,
    'prefer-shared-types': preferSharedTypes,
    'no-type-assertion-in-rpc': noTypeAssertionInRpc,
    'no-any-on-apiclient': noAnyOnApiclient,
    'no-type-assertion-on-shared-types': noTypeAssertionOnSharedTypes,
    'no-direct-fetch': noDirectFetch,
    'flat-routes-services': flatRoutesServices,
    'no-middleware-in-routes': noMiddlewareInRoutes,
    'no-disable-direct-fetch': noDisableDirectFetch,
    'no-new-old-service-naming': noNewOldServiceNaming,
    'no-direct-zod-import-in-file-routes': noDirectZodImportInFileRoutes,
    'require-file-openapi-props': requireFileOpenapiProps,
    'module-boundary': moduleBoundary,
    'limit-type-complexity': limitTypeComplexity,
  },
}

export default tseslint.config(
  { ignores: ['dist', '.pi', 'lint-scripts', 'e2e', 'scripts'] },
  {
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        browser: true,
        es2020: true,
        node: true,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'local-rules': localRules,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/prefer-ts-expect-error': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'local-rules/no-ambiguous-file-paths': 'error',
      'local-rules/no-direct-ws-sse': 'error',
    },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: {
      'no-console': 'error',
      'local-rules/require-hono-chain-syntax': 'error',
      'local-rules/no-util-functions-in-service': 'warn',
      'local-rules/no-boolean-success': 'error',
      'local-rules/no-middleware-outside-dir': 'error',
      'local-rules/require-response-helpers': 'error',
      'local-rules/no-inline-schema': 'error',
      'local-rules/enforce-valid-method': 'error',
      'local-rules/flat-routes-services': 'error',
      'local-rules/no-middleware-in-routes': 'error',
      'local-rules/no-new-old-service-naming': 'error',
      'local-rules/limit-type-complexity': ['warn', { maxRouteChainLength: 15 }],
    },
  },
  {
    files: ['src/server/middleware/**/*.ts'],
    ignores: ['src/server/middleware/index.ts'],
    rules: {
      'local-rules/middleware-location': 'error',
    },
  },
  {
    files: [
      'src/client/**/*.ts',
      'src/client/**/*.tsx',
      'src/admin/**/*.ts',
      'src/admin/**/*.tsx',
      'src/cli/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
      'local-rules/prefer-shared-types': ['warn', { similarityThreshold: 0.6 }],
      'local-rules/no-type-assertion-in-rpc': 'error',
      'local-rules/no-direct-fetch': 'error',
      'local-rules/no-any-on-apiclient': 'error',
      'local-rules/no-type-assertion-on-shared-types': 'error',
      'local-rules/no-disable-direct-fetch': 'error',
      'local-rules/module-boundary': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.ts'],
    rules: {
      'no-console': 'off',
      'local-rules/require-type-safe-test-client': 'error',
      'local-rules/require-hono-chain-syntax': 'off',
    },
  },
  {
    files: ['src/server/module-file/routes/file-routes.ts'],
    rules: {
      'local-rules/no-direct-zod-import-in-file-routes': 'error',
    },
  },
  {
    files: ['src/shared/modules/**/schemas.ts'],
    rules: {
      'local-rules/require-file-openapi-props': 'error',
    },
  },
  {
    files: ['src/shared/core/ws-client.ts', 'src/shared/core/sse-client.ts'],
    rules: {
      'local-rules/protect-ws-sse-interface': 'error',
    },
  },
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      'local-rules/e2e-test-location': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'local-rules/no-e2e-test-outside-dir': 'error',
    },
  },
  {
    files: [
      'src/shared/modules/**/*.ts',
      'src/server/module-*/services/**/*.ts',
      'src/server/module-*/routes/*.ts',
      'src/client/stores/**/*.ts',
      'src/client/pages/**/*.tsx',
    ],
    ignores: [
      '**/__tests__/**/*.ts',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/routes/index.ts',
      'src/client/services/apiClient.ts',
      'src/server/module-chat/routes/chat-routes.ts',
      'src/server/module-chat/services/chat-service.ts',
      'src/server/module-notifications/routes/notification-routes.ts',
    ],
    rules: {
      'local-rules/layer-boundary': 'error',
    },
  },
  {
    files: [
      'src/shared/core/**/*.ts',
      'src/server/core/**/*.ts',
      'src/server/entries/**/*.ts',
      'src/server/test-utils/**/*.ts',
      'src/server/index.ts',
      'src/client/services/**/*.ts',
      'eslint-rules/**/*.js',
      'eslint.config.js',
      'patches/**/*',
    ],
    plugins: {
      'local-rules': localRules,
    },
    rules: {
      'local-rules/framework-protect': 'error',
    },
  }
)
