/**
 * @vitest-environment node
 */
import { describe, it, expect, afterAll } from 'vitest'
import {
  saveFile,
  readFileData,
  deleteFile,
  getFileInfo,
  fileExists,
  getFilePath,
  getPublicFileUrl,
  getPrivateFileUrl,
  generateSignature,
  verifySignature,
  cleanupTempFiles,
  getFileStorageConfig,
  getUploadConfig,
  validateFile,
} from '../../utils/file-storage'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'

describe('File Storage Service', () => {
  const testNamespace = 'test-storage'
  let testFilePath: string

  afterAll(async () => {
    await cleanupTempFiles()
  })

  describe('saveFile', () => {
    it('should save file successfully with valid data', async () => {
      const content = new Uint8Array(Buffer.from('Test file content'))
      const result = await saveFile(testNamespace, {
        name: 'test.txt',
        type: 'text/plain',
        size: content.length,
        data: content.buffer as ArrayBuffer,
      })

      expect(result.filename).toBeDefined()
      expect(result.originalName).toBe('test.txt')
      expect(result.mimeType).toBe('text/plain')
      expect(result.size).toBe(content.length)
      expect(result.path).toContain(testNamespace)
      expect(result.extension).toBe('.txt')

      testFilePath = result.path

      // Cleanup
      await unlink(testFilePath)
    })

    it('should throw error for file exceeding max size', async () => {
      const largeContent = new Uint8Array(11 * 1024 * 1024) // 11MB
      await expect(
        saveFile(testNamespace, {
          name: 'large.txt',
          type: 'text/plain',
          size: largeContent.length,
          data: largeContent.buffer as ArrayBuffer,
        })
      ).rejects.toThrow('File size exceeds maximum allowed size')
    })

    it('should throw error for invalid file type', async () => {
      const content = new Uint8Array(Buffer.from('Test content'))
      await expect(
        saveFile(testNamespace, {
          name: 'test.exe',
          type: 'application/x-msdownload',
          size: content.length,
          data: content.buffer as ArrayBuffer,
        })
      ).rejects.toThrow('File type')
    })

    it('should throw error for invalid file extension', async () => {
      const content = new Uint8Array(Buffer.from('Test content'))
      await expect(
        saveFile(testNamespace, {
          name: 'test.bat',
          type: 'text/plain',
          size: content.length,
          data: content.buffer as ArrayBuffer,
        })
      ).rejects.toThrow('File extension')
    })
  })

  describe('readFileData', () => {
    it('should read file data successfully', async () => {
      const content = new Uint8Array(Buffer.from('Test content for reading'))
      const saved = await saveFile(testNamespace, {
        name: 'readable.txt',
        type: 'text/plain',
        size: content.length,
        data: content.buffer as ArrayBuffer,
      })

      const data = await readFileData(saved.path)
      expect(data.toString()).toBe('Test content for reading')

      // Cleanup
      await unlink(saved.path)
    })

    it('should throw error for non-existent file', async () => {
      await expect(readFileData('/non/existent/file.txt')).rejects.toThrow('File not found')
    })
  })

  describe('deleteFile', () => {
    it('should delete file successfully', async () => {
      const content = new Uint8Array(Buffer.from('Test content'))
      const saved = await saveFile(testNamespace, {
        name: 'deletable.txt',
        type: 'text/plain',
        size: content.length,
        data: content.buffer as ArrayBuffer,
      })

      expect(existsSync(saved.path)).toBe(true)

      const result = await deleteFile(saved.path)
      expect(result).toBe(true)
      expect(existsSync(saved.path)).toBe(false)
    })

    it('should return true for non-existent file', async () => {
      const result = await deleteFile('/non/existent/file.txt')
      expect(result).toBe(true)
    })
  })

  describe('getFileInfo', () => {
    it('should return file info for existing file', async () => {
      const content = new Uint8Array(Buffer.from('Test content'))
      const saved = await saveFile(testNamespace, {
        name: 'info.txt',
        type: 'text/plain',
        size: content.length,
        data: content.buffer as ArrayBuffer,
      })

      const info = await getFileInfo(testNamespace, saved.filename)
      expect(info).not.toBeNull()
      expect(info?.size).toBe(content.length)
      expect(info?.mimeType).toBe('text/plain')
      expect(info?.lastModified).toBeInstanceOf(Date)

      // Cleanup
      await unlink(saved.path)
    })

    it('should return null for non-existent file', async () => {
      const info = await getFileInfo(testNamespace, 'non-existent.txt')
      expect(info).toBeNull()
    })
  })

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const content = new Uint8Array(Buffer.from('Test content'))
      const saved = await saveFile(testNamespace, {
        name: 'exists.txt',
        type: 'text/plain',
        size: content.length,
        data: content.buffer as ArrayBuffer,
      })

      const exists = await fileExists(testNamespace, saved.filename)
      expect(exists).toBe(true)

      // Cleanup
      await unlink(saved.path)
    })

    it('should return false for non-existent file', async () => {
      const exists = await fileExists(testNamespace, 'non-existent.txt')
      expect(exists).toBe(false)
    })
  })

  describe('getFilePath', () => {
    it('should return correct file path', () => {
      const path = getFilePath(testNamespace, 'test.txt')
      expect(path).toContain(testNamespace)
      expect(path).toContain('test.txt')
    })
  })

  describe('getPublicFileUrl', () => {
    it('should return public URL without baseUrl', () => {
      const url = getPublicFileUrl(testNamespace, 'test.txt')
      expect(url).toBe(`/files/public/${testNamespace}/test.txt`)
    })

    it('should return public URL with baseUrl', () => {
      const url = getPublicFileUrl(testNamespace, 'test.txt', 'https://example.com')
      expect(url).toBe(`https://example.com/files/public/${testNamespace}/test.txt`)
    })
  })

  describe('getPrivateFileUrl', () => {
    it('should return private URL with expiry and signature', () => {
      const { url, expiry } = getPrivateFileUrl(testNamespace, 'test.txt', 3600)
      expect(url).toContain(`/files/private/${testNamespace}/test.txt`)
      expect(url).toContain('expiry=')
      expect(url).toContain('signature=')
      expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000))
    })

    it('should use default expiry when not specified', () => {
      const { url, expiry } = getPrivateFileUrl(testNamespace, 'test.txt')
      expect(url).toContain('expiry=')
      expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000))
    })
  })

  describe('generateSignature and verifySignature', () => {
    it('should generate and verify valid signature', () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const signature = generateSignature(testNamespace, 'test.txt', expiry)

      expect(signature).toBeDefined()
      expect(signature.length).toBeGreaterThan(0)

      const isValid = verifySignature(testNamespace, 'test.txt', expiry, signature)
      expect(isValid).toBe(true)
    })

    it('should reject invalid signature', () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const isValid = verifySignature(testNamespace, 'test.txt', expiry, 'invalid-signature')
      expect(isValid).toBe(false)
    })

    it('should reject signature with different parameters', () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const signature = generateSignature(testNamespace, 'test.txt', expiry)

      const isValid = verifySignature(testNamespace, 'other.txt', expiry, signature)
      expect(isValid).toBe(false)
    })
  })

  describe('getFileStorageConfig', () => {
    it('should return default config', () => {
      const config = getFileStorageConfig()
      expect(config.baseDir).toBeDefined()
      expect(config.tempDir).toBeDefined()
      expect(config.tempFileTTL).toBeDefined()
      expect(config.privateUrlExpiry).toBeDefined()
      expect(config.secretKey).toBeDefined()
    })
  })

  describe('getUploadConfig', () => {
    it('should return upload config with namespace', () => {
      const config = getUploadConfig(testNamespace)
      expect(config.uploadDir).toContain(testNamespace)
      expect(config.maxFileSize).toBe(10 * 1024 * 1024)
      expect(config.allowedMimeTypes).toBeDefined()
      expect(config.allowedExtensions).toBeDefined()
    })

    it('should allow config overrides', () => {
      const config = getUploadConfig(testNamespace, {
        maxFileSize: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg'],
      })
      expect(config.maxFileSize).toBe(5 * 1024 * 1024)
      expect(config.allowedMimeTypes).toEqual(['image/jpeg'])
    })
  })

  describe('validateFile', () => {
    it('should validate valid file', () => {
      const config = getUploadConfig(testNamespace)
      const result = validateFile({ name: 'test.jpg', type: 'image/jpeg', size: 1024 }, config)
      expect(result.valid).toBe(true)
    })

    it('should reject file exceeding max size', () => {
      const config = getUploadConfig(testNamespace)
      const result = validateFile(
        { name: 'test.jpg', type: 'image/jpeg', size: 100 * 1024 * 1024 },
        config
      )
      expect(result.valid).toBe(false)
      expect(result.error).toContain('File size exceeds')
    })

    it('should reject file with invalid mime type', () => {
      const config = getUploadConfig(testNamespace)
      const result = validateFile(
        { name: 'test.exe', type: 'application/x-msdownload', size: 1024 },
        config
      )
      expect(result.valid).toBe(false)
      expect(result.error).toContain('File type')
    })

    it('should reject file with invalid extension', () => {
      const config = getUploadConfig(testNamespace)
      const result = validateFile({ name: 'test.bat', type: 'text/plain', size: 1024 }, config)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('File extension')
    })
  })

  describe('cleanupTempFiles', () => {
    it('should cleanup expired temp files', async () => {
      const result = await cleanupTempFiles()
      expect(result).toHaveProperty('deleted')
      expect(result).toHaveProperty('errors')
      expect(typeof result.deleted).toBe('number')
      expect(typeof result.errors).toBe('number')
    })
  })
})
