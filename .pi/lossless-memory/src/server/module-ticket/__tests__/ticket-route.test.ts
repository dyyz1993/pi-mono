import { describe, it, expect } from 'vitest'
import { createTestClient } from '../../test-utils/test-client'

describe('Ticket Routes', () => {
  const authHeaders = { Authorization: 'Bearer admin-token' }

  describe('GET /api/tickets', () => {
    it('should return list of tickets', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api['tickets'].$get()
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(Array.isArray(data.data)).toBe(true)
      }
    })
  })

  describe('GET /api/tickets/:id', () => {
    it('should return 404 for non-existent ticket', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api['tickets'][':id'].$get({
        param: { id: 'non-existent' },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/tickets', () => {
    it('should create a new ticket', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })
      const res = await client.api['tickets'].$post({
        json: {
          customerName: 'Test Customer',
          customerEmail: 'test@example.com',
          subject: 'Test Subject',
          description: 'Test Description',
          category: 'technical',
          priority: 'medium',
        },
      })
      expect(res.status).toBe(201)

      const data = await res.json()
      expect(data.success).toBe(true)
      if (data.success) {
        expect(data.data.id).toBeDefined()
        expect(data.data.subject).toBe('Test Subject')
      }
    })
  })

  describe('PUT /api/tickets/:id', () => {
    it('should update a ticket', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const createRes = await client.api['tickets'].$post({
        json: {
          customerName: 'Update Test',
          customerEmail: 'update@example.com',
          subject: 'Update Subject',
          description: 'Update Description',
          category: 'technical',
          priority: 'medium',
        },
      })
      const createData = await createRes.json()
      const ticketId = createData.success ? createData.data.id : ''

      const res = await client.api['tickets'][':id'].$put({
        param: { id: ticketId },
        json: { status: 'in_progress', assignedTo: 'Agent Smith' },
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })

  describe('DELETE /api/tickets/:id', () => {
    it('should delete a ticket', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const createRes = await client.api['tickets'].$post({
        json: {
          customerName: 'Delete Test',
          customerEmail: 'delete@example.com',
          subject: 'Delete Subject',
          description: 'Delete Description',
          category: 'technical',
          priority: 'medium',
        },
      })
      const createData = await createRes.json()
      const ticketId = createData.success ? createData.data.id : ''

      const res = await client.api['tickets'][':id'].$delete({
        param: { id: ticketId },
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })

  describe('POST /api/tickets/:id/reply', () => {
    it('should reply to a ticket', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const createRes = await client.api['tickets'].$post({
        json: {
          customerName: 'Reply Test',
          customerEmail: 'reply@example.com',
          subject: 'Reply Subject',
          description: 'Reply Description',
          category: 'technical',
          priority: 'medium',
        },
      })
      const createData = await createRes.json()
      const ticketId = createData.success ? createData.data.id : ''

      const res = await client.api['tickets'][':id'].reply.$post({
        param: { id: ticketId },
        json: { content: 'This is a reply', author: 'Support Agent' },
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })

  describe('PUT /api/tickets/:id/close', () => {
    it('should close a ticket', async () => {
      const client = createTestClient(undefined, { headers: authHeaders })

      const createRes = await client.api['tickets'].$post({
        json: {
          customerName: 'Close Test',
          customerEmail: 'close@example.com',
          subject: 'Close Subject',
          description: 'Close Description',
          category: 'technical',
          priority: 'medium',
        },
      })
      const createData = await createRes.json()
      const ticketId = createData.success ? createData.data.id : ''

      const res = await client.api['tickets'][':id'].close.$put({
        param: { id: ticketId },
      })
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })
})
