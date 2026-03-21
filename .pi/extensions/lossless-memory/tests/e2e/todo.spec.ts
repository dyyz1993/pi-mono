/**
 * Todo App E2E Tests
 *
 * Testing Todo application functionality with Playwright
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

test.describe('Todo App', () => {
  /**
   * Test 1: Page Load
   */
  test.describe('Page Load', () => {
    test('should load homepage successfully', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for the app to render
      await page.waitForSelector('[data-testid="app-container"]', { timeout: 25000 })

      // Verify main container is visible
      await expect(page.locator('[data-testid="app-container"]')).toBeVisible()
    })

    test('should display empty state when no todos', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for the app to render
      await page.waitForSelector('[data-testid="app-container"]', { timeout: 25000 })

      // Wait for empty state to appear
      await page.waitForSelector('[data-testid="empty-state"]', { timeout: 25000 })

      // Verify empty state message
      await expect(page.locator('[data-testid="empty-state"]')).toBeVisible()
    })
  })

  /**
   * Test 2: Create Todo
   */
  test.describe('Create Todo', () => {
    test('should create a new todo with title only', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Fill in todo title with specific value
      await page.fill('[data-testid="todo-title-input"]', 'Buy groceries')

      // Submit form
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify todo is created with specific data
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(1)
      await expect(
        page.locator('[data-testid="todo-item"] [data-testid="todo-item-title"]').first()
      ).toHaveText('Buy groceries')

      // Verify todo has correct status
      await expect(
        page.locator('[data-testid="todo-item"]').first().locator('[data-testid="todo-status"]')
      ).toHaveValue('pending')
    })

    test('should create a new todo with title and description', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Fill in both title and description
      await page.fill('[data-testid="todo-title-input"]', 'Clean house')
      await page.fill('[data-testid="todo-description-input"]', 'Clean living room and kitchen')

      // Submit form
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify todo is created
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(1)
      await expect(
        page.locator('[data-testid="todo-item"] [data-testid="todo-item-title"]').first()
      ).toHaveText('Clean house')
    })

    test('should clear input after creating todo', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Fill and submit
      await page.fill('[data-testid="todo-title-input"]', 'Test todo')
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify input is cleared
      await expect(page.locator('[data-testid="todo-title-input"]')).toHaveValue('')
    })

    test('should not create empty todo', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Get initial todo count
      const initialCount = await page.locator('[data-testid="todo-item"]').count()

      // Verify add todo button is disabled when input is empty
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeDisabled()

      // Verify no new todo was created
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(initialCount)
    })
  })

  /**
   * Test 3: Update Todo Status
   */
  test.describe('Update Todo', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Create a test todo
      await page.fill('[data-testid="todo-title-input"]', 'Test Todo')
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')
    })

    test('should change todo status to completed', async ({ page }) => {
      // Change status via select element
      await page.selectOption('[data-testid="todo-status"]', 'completed')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify status changed to completed
      await expect(
        page.locator('[data-testid="todo-item"]').first().locator('[data-testid="todo-status"]')
      ).toHaveValue('completed')
    })

    test('should change todo status back to pending', async ({ page }) => {
      // Change to completed first
      await page.selectOption('[data-testid="todo-status"]', 'completed')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Change back to pending
      await page.selectOption('[data-testid="todo-status"]', 'pending')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify status is back to pending
      await expect(
        page.locator('[data-testid="todo-item"]').first().locator('[data-testid="todo-status"]')
      ).toHaveValue('pending')
    })
  })

  /**
   * Test 4: Delete Todo
   */
  test.describe('Delete Todo', () => {
    test('should delete a todo', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Create a test todo
      await page.fill('[data-testid="todo-title-input"]', 'Todo to delete')
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify todo was created
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(1)

      // Click delete button
      await page.click('[data-testid="todo-item"] [data-testid="delete-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify todo is deleted
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(0)

      // Verify empty state is shown
      await expect(page.locator('[data-testid="empty-state"]')).toBeVisible()
    })
  })

  /**
   * Test 5: Filter Todos
   */
  test.describe('Filter Todos', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Create multiple todos with different statuses
      await page.fill('[data-testid="todo-title-input"]', 'Todo 1')
      // Wait for input to be processed
      await page.waitForTimeout(500)
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeEnabled()
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for form to reset
      await page.waitForTimeout(500)
      await page.fill('[data-testid="todo-title-input"]', 'Todo 2')
      // Wait for input to be processed
      await page.waitForTimeout(500)
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeEnabled()
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Mark first todo as completed
      await page.selectOption('[data-testid="todo-item"] [data-testid="todo-status"]', 'completed')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')
    })

    test('should filter to show only pending todos', async ({ page }) => {
      // Click filter to show pending only
      await page.click('[data-testid="filter-pending"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify only pending todos are shown
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(1)
    })

    test('should filter to show only completed todos', async ({ page }) => {
      // Click filter to show completed only
      await page.click('[data-testid="filter-completed"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify only completed todos are shown
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(1)
    })

    test('should show all todos when filter is reset', async ({ page }) => {
      // Filter to completed
      await page.click('[data-testid="filter-completed"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Reset filter to all
      await page.click('[data-testid="filter-all"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify all todos are shown
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(2)
    })
  })

  /**
   * Test 6: Multiple Todos
   */
  test.describe('Multiple Todos', () => {
    test('should display multiple todos in correct order', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Create multiple todos
      await page.fill('[data-testid="todo-title-input"]', 'First todo')
      // Wait for input to be processed
      await page.waitForTimeout(500)
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeEnabled()
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for form to reset
      await page.waitForTimeout(500)
      await page.fill('[data-testid="todo-title-input"]', 'Second todo')
      // Wait for input to be processed
      await page.waitForTimeout(500)
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeEnabled()
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for form to reset
      await page.waitForTimeout(500)
      await page.fill('[data-testid="todo-title-input"]', 'Third todo')
      // Wait for input to be processed
      await page.waitForTimeout(500)
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeEnabled()
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify all todos are displayed
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(3)

      // Verify order (newest first)
      await expect(
        page.locator('[data-testid="todo-item"] [data-testid="todo-item-title"]').nth(0)
      ).toHaveText('Third todo')
      await expect(
        page.locator('[data-testid="todo-item"] [data-testid="todo-item-title"]').nth(1)
      ).toHaveText('Second todo')
      await expect(
        page.locator('[data-testid="todo-item"] [data-testid="todo-item-title"]').nth(2)
      ).toHaveText('First todo')
    })

    test('should display todo count', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Create multiple todos
      await page.fill('[data-testid="todo-title-input"]', 'Todo 1')
      // Wait for input to be processed
      await page.waitForTimeout(500)
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeEnabled()
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for form to reset
      await page.waitForTimeout(500)
      await page.fill('[data-testid="todo-title-input"]', 'Todo 2')
      // Wait for input to be processed
      await page.waitForTimeout(500)
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeEnabled()
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify todo count
      await expect(page.locator('[data-testid="todo-count"]')).toHaveText(/Total:2/)
    })
  })

  /**
   * Test 7: Persistence
   */
  test.describe('Persistence', () => {
    test('should persist todos across page reloads', async ({ page, browser }) => {
      // Cleanup database first
      try {
        const response = await page.request.post(`${getBaseUrl()}/api/__test__/cleanup`)
        if (!response.ok) {
          console.warn('Failed to cleanup database:', await response.text())
        }
      } catch (error) {
        console.warn('Error during database cleanup:', error)
      }

      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Wait for app to render
      await page.waitForSelector('[data-testid="todo-form"]', { timeout: 15000 })

      // Create a todo
      await page.fill('[data-testid="todo-title-input"]', 'Persistent todo')
      await expect(page.locator('[data-testid="add-todo-button"]')).toBeEnabled()
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Verify todo was created
      await expect(page.locator('[data-testid="todo-item"]')).toHaveCount(1)

      // Create a new browser context to simulate a fresh session
      const newContext = await browser.newContext()
      const newPage = await newContext.newPage()

      try {
        // Navigate to homepage in the new context
        await newPage.goto(getBaseUrl())

        // Wait for page to load
        await newPage.waitForLoadState('load')

        // Wait for network to be idle
        await newPage.waitForLoadState('networkidle')

        // Wait for app to render
        await newPage.waitForSelector('[data-testid="todo-item"]', { timeout: 15000 })

        // Verify todo still exists
        await expect(newPage.locator('[data-testid="todo-item"]')).toHaveCount(1)
        await expect(
          newPage.locator('[data-testid="todo-item"] [data-testid="todo-item-title"]').first()
        ).toHaveText('Persistent todo')
      } finally {
        // Cleanup
        await newContext.close()
      }
    })
  })

  /**
   * Test 8: Navigation
   */
  test.describe('Navigation', () => {
    test('should filter todos correctly', async ({ page }) => {
      // Navigate to homepage
      await page.goto(getBaseUrl())

      // Wait for page to load
      await page.waitForLoadState('load')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Create some todos
      await page.fill('[data-testid="todo-title-input"]', 'Todo 1')
      await page.click('[data-testid="add-todo-button"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Navigate to completed filter
      await page.click('[data-testid="filter-completed"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')

      // Navigate back to all
      await page.click('[data-testid="filter-all"]')

      // Wait for network to be idle
      await page.waitForLoadState('networkidle')
    })
  })
})

/**
 * IMPORTANT: Resource Cleanup Notes
 *
 * Playwright automatically handles cleanup at the end of each test:
 * - All pages in the context are closed
 * - Browser contexts are closed
 * - The browser is closed after all tests complete
 *
 * However, for long-running tests or custom scenarios:
 * 1. Always use test.afterEach() for test-specific cleanup
 * 2. Store page/browser references for explicit cleanup if needed
 * 3. Use try/finally blocks to ensure cleanup even on test failure
 *
 * Example of explicit cleanup:
 *
 * test.afterEach(async ({ page, context }) => {
 *   // Close all pages in context
 *   const pages = context.pages();
 *   for (const p of pages) {
 *     await p.close().catch(() => {});
 *   }
 *
 *   // Clear storage
 *   await page.evaluate(() => {
 *     localStorage.clear();
 *     sessionStorage.clear();
 *   });
 * });
 */
