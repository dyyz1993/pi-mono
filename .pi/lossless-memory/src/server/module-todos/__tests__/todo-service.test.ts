import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import * as todoService from '../services/todo-service'
import { getRawClient, getDb } from '../../db'
import { setupTestDatabase, cleanupTestDatabase } from '../../db/test-setup'

describe('Todo Service', () => {
  beforeAll(async () => {
    await setupTestDatabase()
    const db = await getDb()
    expect(db).toBeDefined()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  beforeEach(async () => {
    const client = await getRawClient()
    if (client && 'execute' in client) {
      await client.execute('DELETE FROM todos')
    }
  })

  afterEach(async () => {
    const client = await getRawClient()
    if (client && 'execute' in client) {
      await client.execute('DELETE FROM todos')
    }
    vi.clearAllMocks()
  })

  describe('listTodos', () => {
    it('should return empty array when no todos exist', async () => {
      const result = await todoService.listTodos()

      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })

    it('should return all todos ordered by created_at DESC', async () => {
      const now = Date.now()
      const client = await getRawClient()

      if (client && 'execute' in client) {
        await client.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Todo 1', 'pending', now, now],
        })
        await client.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Todo 2', 'completed', now + 1000, now + 1000],
        })
      }

      const result = await todoService.listTodos()

      expect(result).toHaveLength(2)
      expect(result[0].title).toBe('Todo 2')
      expect(result[0].status).toBe('completed')
      expect(result[1].title).toBe('Todo 1')
      expect(result[1].status).toBe('pending')
    })
  })

  describe('getTodo', () => {
    it('should return null for non-existent todo', async () => {
      const result = await todoService.getTodo(999)

      expect(result).toBeNull()
    })

    it('should return todo by id with correct fields', async () => {
      const now = Date.now()
      const client = await getRawClient()

      if (client && 'execute' in client) {
        await client.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Test Todo', 'pending', now, now],
        })
        const result = await client.execute('SELECT id FROM todos WHERE title = ?', ['Test Todo'])
        const row = result.rows[0] as unknown as { id: number }

        const todo = await todoService.getTodo(row.id)

        expect(todo).not.toBeNull()
        expect(todo?.id).toBe(row.id)
        expect(todo?.title).toBe('Test Todo')
        expect(todo?.status).toBe('pending')
        expect(typeof todo?.createdAt).toBe('string')
        expect(typeof todo?.updatedAt).toBe('string')
      }
    })
  })

  describe('createTodo', () => {
    it('should create a new todo with default status', async () => {
      const input = {
        title: 'New Todo',
        description: 'Test description',
      }

      const result = await todoService.createTodo(input)

      expect(result.id).toBeGreaterThan(0)
      expect(result.title).toBe(input.title)
      expect(result.description).toBe(input.description)
      expect(result.status).toBe('pending')
      expect(typeof result.createdAt).toBe('string')
      expect(typeof result.updatedAt).toBe('string')
    })

    it('should create todo without description', async () => {
      const input = {
        title: 'Todo without description',
      }

      const result = await todoService.createTodo(input)

      expect(result.id).toBeGreaterThan(0)
      expect(result.title).toBe(input.title)
      expect(result.description).toBeUndefined()
      expect(result.status).toBe('pending')
    })
  })

  describe('updateTodo', () => {
    it('should update todo title and status', async () => {
      const now = Date.now()
      const client = await getRawClient()

      if (client && 'execute' in client) {
        await client.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['Original Title', 'pending', now, now],
        })
        const result = await client.execute('SELECT id FROM todos WHERE title = ?', [
          'Original Title',
        ])
        const row = result.rows[0] as unknown as { id: number }

        const updates = {
          title: 'Updated Title',
          status: 'completed' as const,
        }

        const todo = await todoService.updateTodo(row.id, updates)

        expect(todo).not.toBeNull()
        expect(todo?.id).toBe(row.id)
        expect(todo?.title).toBe(updates.title)
        expect(todo?.status).toBe(updates.status)
        expect(typeof todo?.updatedAt).toBe('string')
      }
    })

    it('should return null for non-existent todo', async () => {
      const result = await todoService.updateTodo(999, { title: 'Updated' })

      expect(result).toBeNull()
    })
  })

  describe('deleteTodo', () => {
    it('should delete todo and return true', async () => {
      const now = Date.now()
      const client = await getRawClient()

      if (client && 'execute' in client) {
        await client.execute({
          sql: `INSERT INTO todos (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          args: ['To Delete', 'pending', now, now],
        })
        const result = await client.execute('SELECT id FROM todos WHERE title = ?', ['To Delete'])
        const row = result.rows[0] as unknown as { id: number }

        const deleted = await todoService.deleteTodo(row.id)

        expect(deleted).toBe(true)

        const checkResult = await client.execute('SELECT * FROM todos WHERE id = ?', [row.id])
        expect(checkResult.rows.length).toBe(0)

        const allTodos = await todoService.listTodos()
        expect(allTodos.length).toBe(0)
      }
    })

    it('should return false for non-existent todo', async () => {
      const result = await todoService.deleteTodo(999)

      expect(result).toBe(false)
    })
  })
})
