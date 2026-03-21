/**
 * @vitest-environment node
 */
/* eslint-disable local-rules/require-type-safe-test-client */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApp } from '../../app'
import { saveFile, generateSignature, cleanupTempFiles } from '../../utils/file-storage'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'

describe('File Routes', () => {
  const app = createApp()
  const testNamespace = 'test-files'
  let testFilename: string
  let testFilePath: string

  beforeAll(async () => {
    // Create a test file
    const testContent = new Uint8Array(Buffer.from('Hello, this is a test file content'))
    const result = await saveFile(testNamespace, {
      name: 'test.txt',
      type: 'text/plain',
      size: testContent.length,
      data: testContent.buffer as ArrayBuffer,
    })
    testFilename = result.filename
    testFilePath = result.path
  })

  afterAll(async () => {
    // Cleanup test file
    if (existsSync(testFilePath)) {
      await unlink(testFilePath)
    }
    await cleanupTempFiles()
  })

  describe('GET /files/public/:namespace/:filename', () => {
    it('should serve public file successfully', async () => {
      const res = await app.request(`/files/public/${testNamespace}/${testFilename}`)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/plain')
      expect(res.headers.get('cache-control')).toContain('public')

      const body = await res.text()
      expect(body).toBe('Hello, this is a test file content')
    })

    it('should return 404 for non-existent file', async () => {
      const res = await app.request(`/files/public/${testNamespace}/non-existent-file.txt`)

      expect(res.status).toBe(404)
      const data = (await res.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toBe('File not found')
    })

    it('should return 404 for non-existent namespace', async () => {
      const res = await app.request('/files/public/non-existent-namespace/file.txt')

      expect(res.status).toBe(404)
    })
  })

  describe('GET /files/private/:namespace/:filename', () => {
    it('should serve private file with valid signature', async () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const signature = generateSignature(testNamespace, testFilename, expiry)

      const res = await app.request(
        `/files/private/${testNamespace}/${testFilename}?expiry=${expiry}&signature=${signature}`
      )

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/plain')
      expect(res.headers.get('cache-control')).toBe('private, no-store')

      const body = await res.text()
      expect(body).toBe('Hello, this is a test file content')
    })

    it('should return 403 for expired signature', async () => {
      const expiry = Math.floor(Date.now() / 1000) - 3600 // Expired
      const signature = generateSignature(testNamespace, testFilename, expiry)

      const res = await app.request(
        `/files/private/${testNamespace}/${testFilename}?expiry=${expiry}&signature=${signature}`
      )

      expect(res.status).toBe(403)
      const data = (await res.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toBe('URL has expired')
    })

    it('should return 403 for invalid signature', async () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const invalidSignature = 'invalid-signature'

      const res = await app.request(
        `/files/private/${testNamespace}/${testFilename}?expiry=${expiry}&signature=${invalidSignature}`
      )

      expect(res.status).toBe(403)
      const data = (await res.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toBe('Invalid signature')
    })

    it('should return 404 for non-existent file with valid signature', async () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const signature = generateSignature(testNamespace, 'non-existent.txt', expiry)

      const res = await app.request(
        `/files/private/${testNamespace}/non-existent.txt?expiry=${expiry}&signature=${signature}`
      )

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/generate-url', () => {
    it('should generate public URL', async () => {
      const res = await app.request('/api/generate-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: testNamespace,
          filename: testFilename,
          isPrivate: false,
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; data: { url: string } }
      expect(data.success).toBe(true)
      expect(data.data.url).toContain(`/files/public/${testNamespace}/${testFilename}`)
    })

    it('should generate private URL with expiry', async () => {
      const res = await app.request('/api/generate-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: testNamespace,
          filename: testFilename,
          isPrivate: true,
          expirySeconds: 7200,
        }),
      })

      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; data: { url: string; expiry: number } }
      expect(data.success).toBe(true)
      expect(data.data.url).toContain(`/files/private/${testNamespace}/${testFilename}`)
      expect(data.data.url).toContain('expiry=')
      expect(data.data.url).toContain('signature=')
      expect(data.data.expiry).toBeGreaterThan(Math.floor(Date.now() / 1000))
    })

    it('should return 404 for non-existent file', async () => {
      const res = await app.request('/api/generate-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: testNamespace,
          filename: 'non-existent.txt',
          isPrivate: false,
        }),
      })

      expect(res.status).toBe(404)
      const data = (await res.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toBe('File not found')
    })

    it('should return 400 for invalid request body', async () => {
      const res = await app.request('/api/generate-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invalidField: 'test',
        }),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('HEAD /files/public/:namespace/:filename', () => {
    it('should return file metadata for existing file', async () => {
      const res = await app.request(`/files/public/${testNamespace}/${testFilename}`, {
        method: 'HEAD',
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/plain')
      expect(res.headers.get('content-length')).toBeDefined()
      expect(res.headers.get('last-modified')).toBeDefined()
    })

    it('should return 404 for non-existent file', async () => {
      const res = await app.request('/files/public/non-existent/file.txt', {
        method: 'HEAD',
      })

      expect(res.status).toBe(404)
    })
  })

  describe('HEAD /files/private/:namespace/:filename', () => {
    it('should return file metadata with valid signature', async () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const signature = generateSignature(testNamespace, testFilename, expiry)

      const res = await app.request(
        `/files/private/${testNamespace}/${testFilename}?expiry=${expiry}&signature=${signature}`,
        {
          method: 'HEAD',
        }
      )

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/plain')
      expect(res.headers.get('content-length')).toBeDefined()
    })

    it('should return 403 for expired signature', async () => {
      const expiry = Math.floor(Date.now() / 1000) - 3600
      const signature = generateSignature(testNamespace, testFilename, expiry)

      const res = await app.request(
        `/files/private/${testNamespace}/${testFilename}?expiry=${expiry}&signature=${signature}`,
        {
          method: 'HEAD',
        }
      )

      expect(res.status).toBe(403)
    })
  })

  describe('File types and headers', () => {
    it('should set correct content-type for image files', async () => {
      // Create a test image file
      const imageContent = new Uint8Array(Buffer.from('fake-image-content'))
      const imageResult = await saveFile(testNamespace, {
        name: 'test.png',
        type: 'image/png',
        size: imageContent.length,
        data: imageContent.buffer as ArrayBuffer,
      })

      const res = await app.request(`/files/public/${testNamespace}/${imageResult.filename}`)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')

      // Cleanup
      await unlink(imageResult.path)
    })

    it('should set correct content-type for PDF files', async () => {
      // Create a test PDF file
      const pdfContent = new Uint8Array(Buffer.from('%PDF-1.4 fake pdf content'))
      const pdfResult = await saveFile(testNamespace, {
        name: 'test.pdf',
        type: 'application/pdf',
        size: pdfContent.length,
        data: pdfContent.buffer as ArrayBuffer,
      })

      const res = await app.request(`/files/public/${testNamespace}/${pdfResult.filename}`)

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/pdf')

      // Cleanup
      await unlink(pdfResult.path)
    })
  })
})
