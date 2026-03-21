import { describe, it, expect } from 'vitest'
import * as service from '../services/ticket-service'

describe('Admin Ticket Service', () => {
  describe('getTickets', () => {
    it('should return all tickets', () => {
      const result = service.getTickets()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should filter tickets by status', () => {
      const result = service.getTickets({ status: 'open' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(ticket => {
        expect(ticket.status).toBe('open')
      })
    })

    it('should filter tickets by priority', () => {
      const result = service.getTickets({ priority: 'high' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(ticket => {
        expect(ticket.priority).toBe('high')
      })
    })

    it('should filter tickets by category', () => {
      const result = service.getTickets({ category: 'technical' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(ticket => {
        expect(ticket.category).toBe('technical')
      })
    })
  })

  describe('getTicketById', () => {
    it('should return ticket when id exists', () => {
      const allTickets = service.getTickets()
      const firstTicket = allTickets[0]
      const result = service.getTicketById(firstTicket.id)
      expect(result).not.toBeNull()
      expect(result?.id).toBe(firstTicket.id)
    })

    it('should return null for non-existent ticket', () => {
      const result = service.getTicketById('non-existent-ticket-id-xyz')
      expect(result).toBeNull()
    })
  })

  describe('replyTicket', () => {
    it('should add a reply to an existing ticket', () => {
      const allTickets = service.getTickets()
      const ticket = allTickets[0]

      const result = service.replyTicket(ticket.id, 'This is a test reply', 'Support Agent')

      expect(result).not.toBeNull()
      expect(result?.replies.length).toBeGreaterThan(0)

      const lastReply = result?.replies[result.replies.length - 1]
      expect(lastReply?.content).toBe('This is a test reply')
      expect(lastReply?.author).toBe('Support Agent')
    })

    it('should return null for non-existent ticket', () => {
      const result = service.replyTicket('non-existent-ticket-id-xyz', 'Reply', 'Agent')
      expect(result).toBeNull()
    })
  })

  describe('closeTicket', () => {
    it('should close an existing ticket', () => {
      const allTickets = service.getTickets()
      const ticket = allTickets[0]

      const result = service.closeTicket(ticket.id)

      expect(result).not.toBeNull()
      expect(result?.status).toBe('closed')
    })

    it('should return null for non-existent ticket', () => {
      const result = service.closeTicket('non-existent-ticket-id-xyz')
      expect(result).toBeNull()
    })
  })
})
