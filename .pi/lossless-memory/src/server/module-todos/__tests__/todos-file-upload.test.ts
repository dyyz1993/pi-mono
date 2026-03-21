import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApp } from '../../app'
import { getRawClient, getDb } from '../../db'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

/**
 * @vitest-environment node
 */

const testUploadDir = join(process.cwd(), 'uploads', 'todos')

interface UploadResponse {
  success: boolean
  data?: {
    id: number
    originalName: string
    mimeType: string
    size: number
    todoId: number
    fileName: string
    path: string
  }
  error?: string
}

describe('Todo File Upload API', () => {
  const app = createApp()

  beforeAll(async () => {
    await setupTestDatabase()
    const db = await getDb()
    expect(db).toBeDefined()
    if (!existsSync(testUploadDir)) {
      await mkdir(testUploadDir, { recursive: true })
    }
  }, 30000)

  afterAll(async () => {
    await cleanupTestDatabase()
    if (existsSync(testUploadDir)) {
      await rm(testUploadDir, { recursive: true, force: true })
    }
  })

  beforeEach(async () => {
    const client = await getRawClient()
    if (client && 'execute' in client) {
      await client.execute('DELETE FROM todo_attachments')
      await client.execute('DELETE FROM todos')
    }
  })

  async function createTestTodo(title: string = 'Test Todo'): Promise<number> {
    const client = await getRawClient()
    if (client && 'execute' in client) {
      const now = Date.now()
      await client.execute({
        sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        args: [title, 'pending', now, now],
      })
      const result = await client.execute('SELECT id FROM todos WHERE title = ?', [title])
      return (result.rows[0] as unknown as { id: number }).id
    }
    throw new Error('Failed to create test todo')
  }

  describe('POST /api/todos/:id/attachments', () => {
    it('should upload a text file successfully', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob(['Hello, this is a test file content'], { type: 'text/plain' })
      formData.append('file', blob, 'test.txt')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as UploadResponse
      expect(data.success).toBe(true)
      expect(data.data?.originalName).toBe('test.txt')
      expect(data.data?.mimeType).toBe('text/plain')
      expect(data.data?.todoId).toBe(todoId)
      expect(data.data?.size).toBeGreaterThan(0)
      expect(data.data?.fileName).toBeDefined()
      expect(data.data?.path).toBeDefined()
    }, 10000)

    it('should upload an image file successfully', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob(['fake image data'], { type: 'image/png' })
      formData.append('file', blob, 'image.png')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as UploadResponse
      expect(data.success).toBe(true)
      expect(data.data?.originalName).toBe('image.png')
      expect(data.data?.mimeType).toBe('image/png')
      expect(data.data?.todoId).toBe(todoId)
    }, 10000)

    it('should reject upload to non-existent todo', async () => {
      const formData = new FormData()
      const blob = new Blob(['test'], { type: 'text/plain' })
      formData.append('file', blob, 'test.txt')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request('/api/todos/99999/attachments', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(404)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    }, 10000)

    it('should reject upload without file', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    }, 10000)

    it('should reject disallowed file type', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob(['executable'], { type: 'application/x-executable' })
      formData.append('file', blob, 'malware.exe')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    }, 10000)
  })

  describe('GET /api/todos/:id/attachments', () => {
    it('should return empty array for todo without attachments', async () => {
      const todoId = await createTestTodo()

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const listRes = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'GET',
      })

      expect(listRes.status).toBe(200)
      const listData = (await listRes.json()) as { success: boolean; data: unknown[] }
      expect(listData.success).toBe(true)
      expect(listData.data).toEqual([])
      expect(listData.data.length).toBe(0)
    }, 10000)

    it('should return 404 for non-existent todo', async () => {
      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const listRes = await app.request('/api/todos/99999/attachments', {
        method: 'GET',
      })

      expect(listRes.status).toBe(404)
      const data = (await listRes.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    }, 10000)
  })

  describe('DELETE /api/todos/:todoId/attachments/:attachmentId', () => {
    it('should return 404 for non-existent attachment', async () => {
      const todoId = await createTestTodo()

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments/99999`, {
        method: 'DELETE',
      })

      expect(res.status).toBe(404)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    }, 10000)
  })

  describe('Error Scenarios', () => {
    it('should handle invalid todo id format', async () => {
      const formData = new FormData()
      const blob = new Blob(['test'], { type: 'text/plain' })
      formData.append('file', blob, 'test.txt')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request('/api/todos/invalid-id/attachments', {
        method: 'POST',
        body: formData,
      })

      // Invalid ID format returns error status
      expect(res.status).toBeGreaterThanOrEqual(400)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    }, 10000)

    it('should reject file exceeding size limit', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const largeContent = 'x'.repeat(11 * 1024 * 1024) // 11MB
      const blob = new Blob([largeContent], { type: 'text/plain' })
      formData.append('file', blob, 'large.txt')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
      expect(data.error?.toLowerCase()).toContain('size')
    }, 10000)

    it('should reject unsupported file extension', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob(['script'], { type: 'text/plain' })
      formData.append('file', blob, 'script.bat')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
      expect(data.error?.toLowerCase()).toContain('extension')
    }, 10000)

    it('should handle empty file upload', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob([], { type: 'text/plain' })
      formData.append('file', blob, 'empty.txt')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as UploadResponse
      expect(data.success).toBe(true)
      expect(data.data?.size).toBe(0)
    }, 10000)

    it('should handle special characters in filename', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob(['test content'], { type: 'text/plain' })
      formData.append('file', blob, 'file with spaces (1).txt')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as UploadResponse
      expect(data.success).toBe(true)
      expect(data.data?.originalName).toBe('file with spaces (1).txt')
    }, 10000)

    it('should handle unicode filename', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob(['测试内容'], { type: 'text/plain' })
      formData.append('file', blob, '测试文件.txt')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(201)
      const data = (await res.json()) as UploadResponse
      expect(data.success).toBe(true)
      expect(data.data?.originalName).toBe('测试文件.txt')
    }, 10000)

    it('should reject request without file', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      // No file appended

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    }, 10000)

    it('should reject request to non-existent todo endpoint', async () => {
      const formData = new FormData()
      const blob = new Blob(['test'], { type: 'text/plain' })
      formData.append('file', blob, 'test.txt')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request('/api/todos/99999/attachments', {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(404)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    }, 10000)

    it('should handle very long filename', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob(['test'], { type: 'text/plain' })
      const longName = 'a'.repeat(200) + '.txt'
      formData.append('file', blob, longName)

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      // Should either succeed or fail gracefully
      expect([201, 400]).toContain(res.status)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(typeof data.success).toBe('boolean')
    }, 10000)

    it('should reject file with no extension', async () => {
      const todoId = await createTestTodo()

      const formData = new FormData()
      const blob = new Blob(['test content'], { type: 'application/octet-stream' })
      formData.append('file', blob, 'noextension')

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        body: formData,
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as { success: boolean; error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toBeDefined()
    }, 10000)

    it('should reject request with wrong HTTP method', async () => {
      const todoId = await createTestTodo()

      // eslint-disable-next-line local-rules/require-type-safe-test-client
      const res = await app.request(`/api/todos/${todoId}/attachments`, {
        method: 'PUT',
      })

      // Hono returns 404 for undefined routes, not 405
      expect([404, 405]).toContain(res.status)
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    }, 10000)
  })
})
