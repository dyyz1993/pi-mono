import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '.env.test') })

const browserExecutablePath = process.env.PLAYWRIGHT_TEST_BROWSER_EXECUTABLE_PATH

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30 * 1000,
  expect: { timeout: 5 * 1000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 3,
  globalSetup: join(__dirname, 'tests', 'e2e', 'global-setup.ts'),
  globalTeardown: join(__dirname, 'tests', 'e2e', 'global-teardown.ts'),
  reporter: [
    ['html', { outputFolder: 'playwright-report/html', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list'],
  ],
  outputDir: 'playwright-artifacts',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: process.env.PLAYWRIGHT_TEST_BROWSER_TYPE || 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(browserExecutablePath
          ? { launchOptions: { executablePath: browserExecutablePath } }
          : {}),
      },
    },
  ],
})
