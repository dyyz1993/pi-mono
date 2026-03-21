/**
 * WebSocket App E2E Tests
 *
 * Testing WebSocket application functionality with Playwright
 *
 * The dev server is started automatically by global-setup.ts
 * on a random available port.
 */

import { test, expect } from '@playwright/test'

function getBaseUrl(): string {
  return process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3010'
}

/**
 * Cleanup after each test
 * IMPORTANT: Close all browser resources to prevent memory leaks
 */
// Track if we're in a test that needs persistence
const persistenceTestInProgress = false

test.beforeEach(async ({ page }) => {
  // Only cleanup database if we're not in a persistence test
  if (!persistenceTestInProgress) {
    try {
      const response = await page.request.post(`${getBaseUrl()}/api/__test__/cleanup`)
      if (!response.ok) {
        console.warn('Failed to cleanup database:', await response.text())
      }
    } catch (error) {
      console.warn('Error during database cleanup:', error)
    }
  }

  // Clear storage safely
  try {
    await page.evaluate(() => {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch (e) {
        // Ignore security errors for localStorage access
        console.warn('Could not clear storage:', e)
      }
    })
  } catch (error) {
    console.warn('Error clearing storage:', error)
  }

  // Navigate to websocket page
  await page.goto(`${getBaseUrl()}/websocket`)

  // Wait for page to load
  await page.waitForLoadState('load')

  // Wait for network to be idle
  await page.waitForLoadState('networkidle')

  // Wait for the app to render
  await page.waitForSelector('[data-testid="websocket-container"]', { timeout: 25000 })
})

test.afterEach(async ({ page, context }) => {
  // Close all pages in context
  const pages = context.pages()
  for (const p of pages) {
    if (p !== page) {
      await p.close()
    }
  }
})

test.describe('WebSocket App', () => {
  /**
   * Test 1: Page Load
   */
  test.describe('Page Load', () => {
    test('should load websocket page successfully', async ({ page }) => {
      // Verify main container is visible
      await expect(page.locator('[data-testid="websocket-container"]')).toBeVisible()

      // Verify page title
      await expect(page.locator('h1')).toHaveText('WebSocket Demo')
    })

    test('should display empty state when no messages', async ({ page }) => {
      // Wait for empty state to appear
      await page.waitForSelector('[data-testid="empty-state"]', { timeout: 25000 })

      // Verify empty state message
      await expect(page.locator('[data-testid="empty-state"]')).toBeVisible()
    })
  })

  /**
   * Test 2: WebSocket Connection
   */
  test.describe('WebSocket Connection', () => {
    test('should connect to WebSocket', async ({ page }) => {
      // Click connect button
      await page.click('[data-testid="connect-ws-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for WebSocket connected status
      await page.waitForSelector('[data-testid="ws-status-open"]', { timeout: 10000 })

      // Verify WebSocket is connected
      await expect(page.locator('[data-testid="ws-status-open"]')).toBeVisible()
    })

    test('should disconnect from WebSocket', async ({ page }) => {
      // First connect
      await page.click('[data-testid="connect-ws-button"]')
      await page.waitForLoadState('networkidle')
      await page.waitForSelector('[data-testid="ws-status-open"]', { timeout: 10000 })

      // Then disconnect
      await page.click('[data-testid="disconnect-ws-button"]')
      await page.waitForLoadState('networkidle')

      // Wait for WebSocket disconnected status
      await page.waitForSelector('[data-testid="ws-status-closed"]', { timeout: 10000 })

      // Verify WebSocket is disconnected
      await expect(page.locator('[data-testid="ws-status-closed"]')).toBeVisible()
    })
  })

  /**
   * Test 3: Send Messages
   */
  test.describe('Send Messages', () => {
    test.beforeEach(async ({ page }) => {
      // Connect to WebSocket
      await page.click('[data-testid="connect-ws-button"]')
      await page.waitForLoadState('networkidle')
      await page.waitForSelector('[data-testid="ws-status-open"]', { timeout: 10000 })
    })

    test('should send echo message', async ({ page }) => {
      // Fill in message
      await page.fill('[data-testid="ws-message-input"]', 'Hello WebSocket')
      await page.selectOption('[data-testid="ws-message-type-select"]', 'echo')

      // Send message
      await page.click('[data-testid="send-message-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for message to appear
      await page.waitForSelector('[data-testid="message-item"]', { timeout: 5000 })

      // Verify message is displayed
      await expect(page.locator('[data-testid="message-item"]')).toHaveCount(2) // Connected message + echo message
    })

    test('should send ping message', async ({ page }) => {
      // Select ping type
      await page.selectOption('[data-testid="ws-message-type-select"]', 'ping')

      // Send message
      await page.click('[data-testid="send-message-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for message to appear
      await page.waitForSelector('[data-testid="message-item"]', { timeout: 5000 })

      // Verify message is displayed
      await expect(page.locator('[data-testid="message-item"]')).toHaveCount(2) // Connected message + ping/pong messages
    })

    test('should send broadcast message', async ({ page }) => {
      // Fill in message
      await page.fill('[data-testid="ws-message-input"]', 'Broadcast message')
      await page.selectOption('[data-testid="ws-message-type-select"]', 'broadcast')

      // Send message
      await page.click('[data-testid="send-message-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for message to appear
      await page.waitForSelector('[data-testid="message-item"]', { timeout: 5000 })

      // Verify message is displayed
      await expect(page.locator('[data-testid="message-item"]')).toHaveCount(2) // Connected message + broadcast message
    })

    test('should send notification message', async ({ page }) => {
      // Fill in message
      await page.fill('[data-testid="ws-message-input"]', 'Notification message')
      await page.selectOption('[data-testid="ws-message-type-select"]', 'notification')

      // Send message
      await page.click('[data-testid="send-message-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for message to appear
      await page.waitForSelector('[data-testid="message-item"]', { timeout: 5000 })

      // Verify message is displayed
      await expect(page.locator('[data-testid="message-item"]')).toHaveCount(2) // Connected message + notification message
    })

    test('should clear input after sending message', async ({ page }) => {
      // Fill and send
      await page.fill('[data-testid="ws-message-input"]', 'Test message')
      await page.selectOption('[data-testid="ws-message-type-select"]', 'echo')
      await page.click('[data-testid="send-message-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify input is cleared
      await expect(page.locator('[data-testid="ws-message-input"]')).toHaveValue('')
    })

    test('should not send empty message', async ({ page }) => {
      // Get initial message count
      const initialCount = await page.locator('[data-testid="message-item"]').count()

      // Try to send empty message
      await page.selectOption('[data-testid="ws-message-type-select"]', 'echo')
      await page.click('[data-testid="send-message-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify no new message was sent
      await expect(page.locator('[data-testid="message-item"]')).toHaveCount(initialCount)
    })
  })

  /**
   * Test 4: Clear Messages
   */
  test.describe('Clear Messages', () => {
    test.beforeEach(async ({ page }) => {
      // Connect to WebSocket
      await page.click('[data-testid="connect-ws-button"]')
      await page.waitForLoadState('networkidle')
      await page.waitForSelector('[data-testid="ws-status-open"]', { timeout: 10000 })

      // Send a message
      await page.fill('[data-testid="ws-message-input"]', 'Test message')
      await page.selectOption('[data-testid="ws-message-type-select"]', 'echo')
      await page.click('[data-testid="send-message-button"]')
      await page.waitForLoadState('networkidle')
      await page.waitForSelector('[data-testid="message-item"]', { timeout: 5000 })
    })

    test('should clear all messages', async ({ page }) => {
      // Click clear button
      await page.click('[data-testid="clear-messages-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify messages are cleared
      await expect(page.locator('[data-testid="message-item"]')).toHaveCount(0)

      // Verify empty state is shown
      await expect(page.locator('[data-testid="empty-state"]')).toBeVisible()
    })
  })

  /**
   * Test 5: Multiple Messages
   */
  test.describe('Multiple Messages', () => {
    test.beforeEach(async ({ page }) => {
      // Connect to WebSocket
      await page.click('[data-testid="connect-ws-button"]')
      await page.waitForLoadState('networkidle')
      await page.waitForSelector('[data-testid="ws-status-open"]', { timeout: 10000 })
    })

    test('should display multiple messages', async ({ page }) => {
      // Send multiple messages
      await page.fill('[data-testid="ws-message-input"]', 'Message 1')
      await page.selectOption('[data-testid="ws-message-type-select"]', 'echo')
      await page.click('[data-testid="send-message-button"]')
      await page.waitForLoadState('networkidle')

      // Wait for message to appear
      await page.waitForSelector('[data-testid="message-item"]', { timeout: 5000 })

      // Send another message
      await page.fill('[data-testid="ws-message-input"]', 'Message 2')
      await page.click('[data-testid="send-message-button"]')
      await page.waitForLoadState('networkidle')

      // Wait for message to appear
      await page.waitForSelector('[data-testid="message-item"]', { timeout: 5000 })

      // Verify all messages are displayed
      await expect(page.locator('[data-testid="message-item"]')).toHaveCount(4) // Connected message + 2 echo requests + 2 echo responses
    })

    test('should display message count', async ({ page }) => {
      // Send multiple messages
      await page.fill('[data-testid="ws-message-input"]', 'Message 1')
      await page.selectOption('[data-testid="ws-message-type-select"]', 'echo')
      await page.click('[data-testid="send-message-button"]')
      await page.waitForLoadState('networkidle')

      // Wait for message to appear
      await page.waitForSelector('[data-testid="message-item"]', { timeout: 5000 })

      // Verify message count
      await expect(page.locator('[data-testid="message-count"]')).toHaveText(/Messages \(2\)/)
    })
  })

  /**
   * Test 6: WebSocket Status
   */
  test.describe('WebSocket Status', () => {
    test('should show connecting status when connecting', async ({ page }) => {
      // Click connect button
      await page.click('[data-testid="connect-ws-button"]')

      // Wait for connecting status
      await page.waitForSelector('[data-testid="ws-status-connecting"]', { timeout: 5000 })

      // Verify connecting status is shown
      await expect(page.locator('[data-testid="ws-status-connecting"]')).toBeVisible()
    })

    test('should show open status when connected', async ({ page }) => {
      // Click connect button
      await page.click('[data-testid="connect-ws-button"]')

      // Wait for open status
      await page.waitForSelector('[data-testid="ws-status-open"]', { timeout: 10000 })

      // Verify open status is shown
      await expect(page.locator('[data-testid="ws-status-open"]')).toBeVisible()
    })

    test('should show closed status when disconnected', async ({ page }) => {
      // First connect
      await page.click('[data-testid="connect-ws-button"]')
      await page.waitForLoadState('networkidle')
      await page.waitForSelector('[data-testid="ws-status-open"]', { timeout: 10000 })

      // Then disconnect
      await page.click('[data-testid="disconnect-ws-button"]')
      await page.waitForLoadState('networkidle')

      // Wait for closed status
      await page.waitForSelector('[data-testid="ws-status-closed"]', { timeout: 10000 })

      // Verify closed status is shown
      await expect(page.locator('[data-testid="ws-status-closed"]')).toBeVisible()
    })
  })
})
