import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'
import { getRawClient, getDb } from '../../db'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Todo Routes - Business Logic Tests', () => {
  const authHeaders = { Authorization: 'Bearer admin-token' }

  beforeAll(async () => {
    await setupTestDatabase()
    const db = await getDb()
    expect(db).toBeDefined()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  beforeEach(async () => {
    await cleanupTestDatabase()
  })

  afterEach(async () => {
    await cleanupTestDatabase()
  })

  describe('Invalid Parameter Tests - Zod Validation', () => {
    it('should reject POST with empty title', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post(
        {
          json: { title: '' },
        },
        { headers: authHeaders }
      )

      expect(res.status).toBe(400)
    })

    it('should reject POST with missing title', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post(
        {
          json: {} as { title: string },
        },
        { headers: authHeaders }
      )

      expect(res.status).toBe(400)
    })

    it('should reject POST with title longer than 255 characters', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post(
        {
          json: { title: 'a'.repeat(256) },
        },
        { headers: authHeaders }
      )

      expect(res.status).toBe(400)
    })

    it('should reject PUT with invalid status', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const createRes = await client.api.todos.$post(
        {
          json: { title: 'Test Todo' },
        },
        { headers: authHeaders }
      )
      const createData = await createRes.json()
      expect(createData.success).toBe(true)

      if (createData.success) {
        const res = await client.api.todos[':id'].$put(
          {
            param: { id: String(createData.data.id) },
            json: { status: 'invalid_status' as 'pending' },
          },
          { headers: authHeaders }
        )

        expect(res.status).toBe(400)
      }
    })

    it('should reject PUT with empty title', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const createRes = await client.api.todos.$post(
        {
          json: { title: 'Test Todo' },
        },
        { headers: authHeaders }
      )
      const createData = await createRes.json()
      expect(createData.success).toBe(true)

      if (createData.success) {
        const res = await client.api.todos[':id'].$put(
          {
            param: { id: String(createData.data.id) },
            json: { title: '' },
          },
          { headers: authHeaders }
        )

        expect(res.status).toBe(400)
      }
    })

    it('should reject PUT with title longer than 255 characters', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const createRes = await client.api.todos.$post(
        {
          json: { title: 'Test Todo' },
        },
        { headers: authHeaders }
      )
      const createData = await createRes.json()
      expect(createData.success).toBe(true)

      if (createData.success) {
        const res = await client.api.todos[':id'].$put(
          {
            param: { id: String(createData.data.id) },
            json: { title: 'a'.repeat(256) },
          },
          { headers: authHeaders }
        )

        expect(res.status).toBe(400)
      }
    })

    it('should return 500 for GET with non-numeric id (parseInt returns NaN)', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$get(
        {
          param: { id: 'not-a-number' },
        },
        { headers: authHeaders }
      )

      expect(res.status).toBe(500)
    })

    it('should return 500 for DELETE with non-numeric id (parseInt returns NaN)', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$delete(
        {
          param: { id: 'not-a-number' },
        },
        { headers: authHeaders }
      )

      expect(res.status).toBe(500)
    })
  })

  describe('Todo Creation Business Logic', () => {
    it('should create todo with default status "pending"', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post({
        json: { title: 'Test Todo' },
      })

      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.status).toBe('pending')
      }
    })

    it('should create todo with description', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post({
        json: {
          title: 'Test Todo',
          description: 'This is a detailed description',
        },
      })

      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.description).toBe('This is a detailed description')
      }
    })

    it('should create todo without description (optional field)', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post({
        json: { title: 'No Description Todo' },
      })

      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.description).toBeUndefined()
      }
    })

    it('should generate unique id for each todo', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res1 = await client.api.todos.$post({
        json: { title: 'Todo 1' },
      })
      const res2 = await client.api.todos.$post({
        json: { title: 'Todo 2' },
      })

      const data1 = await res1.json()
      const data2 = await res2.json()

      expect(data1.success).toBe(true)
      expect(data2.success).toBe(true)
      if (data1.success && data2.success) {
        expect(data1.data.id).not.toBe(data2.data.id)
      }
    })

    it('should set createdAt and updatedAt timestamps', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post({
        json: { title: 'Timestamped Todo' },
      })

      const data = await res.json()

      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.createdAt).toBeDefined()
        expect(data.data.updatedAt).toBeDefined()
        expect(data.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
        expect(data.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      }
    })

    it('should reject title longer than max length', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$post({
        json: { title: 'a'.repeat(256) },
      })

      expect(res.status).toBe(400)
    })
  })

  describe('Todo Update Business Logic', () => {
    async function createTestTodo(title: string = 'Test Todo') {
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

    it('should update title', async () => {
      const todoId = await createTestTodo()
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$put({
        param: { id: String(todoId) },
        json: { title: 'Updated Title' },
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.title).toBe('Updated Title')
        expect(data.data.status).toBe('pending')
      }
    })

    it('should update status from pending to completed', async () => {
      const todoId = await createTestTodo()
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$put({
        param: { id: String(todoId) },
        json: { status: 'completed' },
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.status).toBe('completed')
      }
    })

    it('should update status from completed to pending', async () => {
      const rawClient = await getRawClient()
      if (rawClient && 'execute' in rawClient) {
        const now = Date.now()
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Completed Todo', 'completed', now, now],
        })
        const result = await rawClient.execute('SELECT id FROM todos WHERE title = ?', [
          'Completed Todo',
        ])
        const todoId = (result.rows[0] as unknown as { id: number }).id

        const client = createTestClient(undefined, { headers: authHeaders })
        const res = await client.api.todos[':id'].$put({
          param: { id: String(todoId) },
          json: { status: 'pending' },
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.success).toBe(true)
        if (data.success) {
          expect(data.data.status).toBe('pending')
        }
      }
    })

    it('should update updatedAt timestamp on any change', async () => {
      const rawClient = await getRawClient()
      if (rawClient && 'execute' in rawClient) {
        const now = Date.now()
        await rawClient.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Old Todo', 'pending', now - 10000, now - 10000],
        })
        const result = await rawClient.execute('SELECT id, updated_at FROM todos WHERE title = ?', [
          'Old Todo',
        ])
        const row = result.rows[0] as unknown as { id: number; updated_at: number }
        const originalUpdatedAt = row.updated_at

        const client = createTestClient(undefined, { headers: authHeaders })
        await new Promise(resolve => setTimeout(resolve, 100))

        const res = await client.api.todos[':id'].$put({
          param: { id: String(row.id) },
          json: { title: 'Updated Todo' },
        })

        const data = await res.json()
        expect(data.success).toBe(true)
        if (data.success) {
          expect(data.data.updatedAt).not.toBe(originalUpdatedAt)
          expect(new Date(data.data.updatedAt).getTime()).toBeGreaterThan(originalUpdatedAt)
        }
      }
    })

    it('should update multiple fields at once', async () => {
      const todoId = await createTestTodo()
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$put({
        param: { id: String(todoId) },
        json: {
          title: 'Multi Update',
          description: 'New description',
          status: 'completed',
        },
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.title).toBe('Multi Update')
        expect(data.data.description).toBe('New description')
        expect(data.data.status).toBe('completed')
      }
    })

    it('should reject invalid status value', async () => {
      const todoId = await createTestTodo()
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$put({
        param: { id: String(todoId) },
        json: { status: 'invalid_status' as 'pending' },
      })

      expect(res.status).toBe(400)
    })

    it('should return 404 when updating non-existent todo', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$put({
        param: { id: '99999' },
        json: { title: 'Updated' },
      })

      expect(res.status).toBe(404)
    })
  })

  describe('Todo List Business Logic', () => {
    async function createMultipleTodos(count: number) {
      const client = await getRawClient()
      if (client && 'execute' in client) {
        for (let i = 0; i < count; i++) {
          const now = Date.now() + i
          await client.execute({
            sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
            args: [`Todo ${i + 1}`, i % 2 === 0 ? 'pending' : 'completed', now, now],
          })
        }
      }
    }

    it('should return todos ordered by createdAt descending', async () => {
      await createMultipleTodos(3)
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$get(undefined, { headers: authHeaders })
      const data = await res.json()

      expect(data.success).toBe(true)
      if (data.success && Array.isArray(data.data)) {
        expect(data.data).toHaveLength(3)
        const timestamps = data.data.map((t: { createdAt: string }) =>
          new Date(t.createdAt).getTime()
        )
        for (let i = 0; i < timestamps.length - 1; i++) {
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1])
        }
      }
    })

    it('should return empty array when no todos exist', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos.$get(undefined, { headers: authHeaders })
      const data = await res.json()

      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data).toEqual([])
      }
    })
  })

  describe('Todo Delete Business Logic', () => {
    async function createTestTodo(title: string = 'To Delete') {
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

    it('should delete existing todo', async () => {
      const todoId = await createTestTodo()
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$delete({
        param: { id: String(todoId) },
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.id).toBe(todoId)
      }
    })

    it('should return 404 when deleting non-existent todo', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const res = await client.api.todos[':id'].$delete({
        param: { id: '99999' },
      })

      expect(res.status).toBe(404)
    })

    it('should not be able to get deleted todo', async () => {
      const todoId = await createTestTodo()
      const client = createTestClient(undefined, { headers: authHeaders })

      await client.api.todos[':id'].$delete({
        param: { id: String(todoId) },
      })

      const res = await client.api.todos[':id'].$get({
        param: { id: String(todoId) },
      })

      expect(res.status).toBe(404)
    })

    it('should not be able to update deleted todo', async () => {
      const todoId = await createTestTodo()
      const client = createTestClient(undefined, { headers: authHeaders })

      await client.api.todos[':id'].$delete({
        param: { id: String(todoId) },
      })

      const res = await client.api.todos[':id'].$put({
        param: { id: String(todoId) },
        json: { title: 'Updated' },
      })

      expect(res.status).toBe(404)
    })
  })

  describe('Todo Get By ID Business Logic', () => {
    it('should return todo with all fields', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const createRes = await client.api.todos.$post({
        json: {
          title: 'Full Todo',
          description: 'Full description',
        },
      })

      const createData = await createRes.json()
      expect(createData.success).toBe(true)
      if (createData.success) {
        const todoId = createData.data.id

        const getRes = await client.api.todos[':id'].$get({
          param: { id: String(todoId) },
        })

        const getData = await getRes.json()
        expect(getData.success).toBe(true)
        if (getData.success) {
          expect(getData.data.id).toBe(todoId)
          expect(getData.data.title).toBe('Full Todo')
          expect(getData.data.description).toBe('Full description')
          expect(getData.data.status).toBe('pending')
          expect(getData.data.createdAt).toBeDefined()
          expect(getData.data.updatedAt).toBeDefined()
        }
      }
    })
  })
})
