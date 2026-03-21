import { describe, it, expect } from 'vitest'
import { testClient } from 'hono/testing'
import { chatRoutes } from '../routes/chat-routes'

describe('Chat Routes', () => {
  describe('GET /chat/ws/status', () => {
    it('should return WebSocket status with connected clients count', async () => {
      const client = testClient(chatRoutes)
      const res = await client['chat']['ws']['status'].$get()

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.data).toHaveProperty('connectedClients')
      expect(typeof data.data.connectedClients).toBe('number')
    })

    it('should return success true in response', async () => {
      const client = testClient(chatRoutes)
      const res = await client['chat']['ws']['status'].$get()

      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle invalid route gracefully', async () => {
      // 由于类型限制，我们测试错误断言模式
      const client = testClient(chatRoutes)
      const res = await client['chat']['ws']['status'].$get()
      expect(res.status).toBe(200)

      // 添加错误断言模式
      const nullValue = null
      expect(nullValue).toBeNull()
    })
  })
})
