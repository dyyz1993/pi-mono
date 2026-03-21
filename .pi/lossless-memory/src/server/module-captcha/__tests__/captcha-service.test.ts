import { describe, it, expect } from 'vitest'
import { generateCaptcha, verifyCaptcha } from '../services/captcha-service'

describe('Captcha Service', () => {
  describe('generateCaptcha', () => {
    it('should generate captcha with id and image', async () => {
      const result = generateCaptcha()

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.image).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(typeof result.image).toBe('string')
    })

    it('should generate unique ids', async () => {
      const result1 = generateCaptcha()
      const result2 = generateCaptcha()

      expect(result1.id).not.toBe(result2.id)
      expect(result1.id.length).toBeGreaterThan(0)
      expect(result2.id.length).toBeGreaterThan(0)
    })
  })

  describe('verifyCaptcha', () => {
    it('should return false for non-existent id', async () => {
      const isValid = verifyCaptcha('non-existent-id', '123456')
      expect(isValid).toBe(false)
      expect(typeof isValid).toBe('boolean')
    })

    it('should return false for wrong code', async () => {
      const { id } = generateCaptcha()
      const isValid = verifyCaptcha(id, 'wrong-code')
      expect(isValid).toBe(false)
      expect(typeof isValid).toBe('boolean')
    })

    it('should return false for empty code', async () => {
      const { id } = generateCaptcha()
      const isValid = verifyCaptcha(id, '')
      expect(isValid).toBe(false)
      expect(typeof isValid).toBe('boolean')
    })

    it('should return false for empty id', async () => {
      const isValid = verifyCaptcha('', '123456')
      expect(isValid).toBe(false)
      expect(typeof isValid).toBe('boolean')
    })
  })
})
