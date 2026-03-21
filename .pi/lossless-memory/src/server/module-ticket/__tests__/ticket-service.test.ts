import { describe, it, expect, beforeEach } from 'vitest'
import * as service from '../services/ticket-service'
import type { CreateTicketInput, UpdateTicketInput, ReplyTicketInput } from '@shared/modules/ticket'

describe('Ticket Service', () => {
  const createdTicketIds: string[] = []

  beforeEach(async () => {
    const result = await service.getTickets()
    for (const ticket of result) {
      if (createdTicketIds.includes(ticket.id)) {
        await service.deleteTicket(ticket.id)
      }
    }
    createdTicketIds.length = 0
  })

  describe('getTickets', () => {
    it('should return all tickets', async () => {
      const result = await service.getTickets()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should filter tickets by status', async () => {
      const result = await service.getTickets({ status: 'open' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(ticket => {
        expect(ticket.status).toBe('open')
      })
    })
  })

  describe('getTicketById', () => {
    it('should return a ticket by id', async () => {
      const data: CreateTicketInput = {
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        subject: 'Test Subject',
        description: 'Test Description',
        category: 'technical',
        priority: 'medium',
      }
      const created = await service.createTicket(data)
      createdTicketIds.push(created.id)
      const result = await service.getTicketById(created.id)
      expect(result).not.toBeNull()
      expect(result?.id).toBe(created.id)
    })

    it('should return null for non-existent ticket', async () => {
      const result = await service.getTicketById('non-existent-ticket-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('createTicket', () => {
    it('should create a new ticket', async () => {
      const data: CreateTicketInput = {
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        subject: 'Test Subject',
        description: 'Test Description',
        category: 'technical',
        priority: 'medium',
      }
      const result = await service.createTicket(data)
      createdTicketIds.push(result.id)
      expect(result).toMatchObject({
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        subject: 'Test Subject',
        description: 'Test Description',
        category: 'technical',
        priority: 'medium',
        status: 'open',
      })
      expect(result.id).toBeDefined()
    })
  })

  describe('updateTicket', () => {
    it('should update an existing ticket', async () => {
      const data: CreateTicketInput = {
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        subject: 'Test Subject',
        description: 'Test Description',
        category: 'technical',
        priority: 'medium',
      }
      const created = await service.createTicket(data)
      createdTicketIds.push(created.id)

      const updateData: UpdateTicketInput = {
        status: 'in_progress',
        assignedTo: 'Agent Smith',
      }
      const result = await service.updateTicket(created.id, updateData)
      expect(result).not.toBeNull()
      expect(result?.status).toBe('in_progress')
      expect(result?.assignedTo).toBe('Agent Smith')
    })

    it('should return null for non-existent ticket', async () => {
      const result = await service.updateTicket('non-existent-ticket-id-xyz', {})
      expect(result).toBeNull()
    })
  })

  describe('deleteTicket', () => {
    it('should delete an existing ticket', async () => {
      const data: CreateTicketInput = {
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        subject: 'Test Subject',
        description: 'Test Description',
        category: 'technical',
        priority: 'medium',
      }
      const created = await service.createTicket(data)

      const result = await service.deleteTicket(created.id)
      expect(result.message).toBe('工单已删除')

      const deleted = await service.getTicketById(created.id)
      expect(deleted).toBeNull()
    })

    it('should return false for non-existent ticket', async () => {
      const result = await service.deleteTicket('non-existent-ticket-id-xyz')
      expect(result.message).toBe('工单不存在')
    })
  })

  describe('replyTicket', () => {
    it('should add a reply to an existing ticket', async () => {
      const data: CreateTicketInput = {
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        subject: 'Test Subject',
        description: 'Test Description',
        category: 'technical',
        priority: 'medium',
      }
      const created = await service.createTicket(data)
      createdTicketIds.push(created.id)

      const replyData: ReplyTicketInput = {
        content: 'This is a test reply',
        author: 'Support Agent',
      }
      const result = await service.replyTicket(created.id, replyData)
      expect(result).not.toBeNull()
      expect(result?.replies.length).toBe(1)
      expect(result?.replies[0].content).toBe('This is a test reply')
    })

    it('should return null for non-existent ticket', async () => {
      const replyData: ReplyTicketInput = {
        content: 'This is a test reply',
        author: 'Support Agent',
      }
      const result = await service.replyTicket('non-existent-ticket-id-xyz', replyData)
      expect(result).toBeNull()
    })
  })

  describe('closeTicket', () => {
    it('should close an existing ticket', async () => {
      const data: CreateTicketInput = {
        customerName: 'Test Customer',
        customerEmail: 'test@example.com',
        subject: 'Test Subject',
        description: 'Test Description',
        category: 'technical',
        priority: 'medium',
      }
      const created = await service.createTicket(data)
      createdTicketIds.push(created.id)

      const result = await service.closeTicket(created.id)
      expect(result).not.toBeNull()
      expect(result?.status).toBe('closed')
    })

    it('should return null for non-existent ticket', async () => {
      const result = await service.closeTicket('non-existent-ticket-id-xyz')
      expect(result).toBeNull()
    })
  })
})
