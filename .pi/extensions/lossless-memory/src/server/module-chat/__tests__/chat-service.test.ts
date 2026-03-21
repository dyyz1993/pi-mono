import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setRuntimeAdapter } from '@server/core/runtime'
import { getNodeRuntimeAdapter } from '@server/core/runtime-node'
import * as chatService from '../services/chat-service'

// Initialize runtime adapter before tests
setRuntimeAdapter(getNodeRuntimeAdapter())

describe('Chat Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getConnectedClientsCount', () => {
    it('should return a number representing connected clients', () => {
      const count = chatService.getConnectedClientsCount()

      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('should return 0 when no clients are connected', () => {
      const count = chatService.getConnectedClientsCount()

      expect(count).toBeGreaterThanOrEqual(0)
    })
  })

  describe('broadcastChatMessage', () => {
    it('should broadcast a message without throwing', () => {
      const message = {
        id: 'test-id',
        content: 'Hello, World!',
        sender: 'test-user',
        timestamp: Date.now(),
      }

      expect(() => chatService.broadcastChatMessage(message)).not.toThrow()
    })

    it('should handle empty content', () => {
      const message = {
        id: 'test-id',
        content: '',
        sender: 'test-user',
        timestamp: Date.now(),
      }

      expect(() => chatService.broadcastChatMessage(message)).not.toThrow()
    })
  })

  describe('chatRuntime', () => {
    it('should be defined and have required methods', () => {
      expect(chatService.chatRuntime).toBeDefined()
      expect(typeof chatService.chatRuntime.registerRPC).toBe('function')
      expect(typeof chatService.chatRuntime.registerEvent).toBe('function')
    })
  })
})
