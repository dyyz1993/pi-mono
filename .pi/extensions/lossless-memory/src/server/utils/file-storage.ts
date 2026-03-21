import { mkdir, writeFile, unlink, stat, readdir, rm, readFile } from 'fs/promises'
import { join, extname } from 'path'
import { existsSync } from 'fs'
import { randomUUID, createHmac, timingSafeEqual } from 'crypto'
import { isCloudflare } from './env'

export interface FileUploadConfig {
  uploadDir: string
  maxFileSize: number
  allowedMimeTypes: string[]
  allowedExtensions: string[]
}

export interface UploadedFile {
  filename: string
  originalName: string
  mimeType: string
  size: number
  path: string
  extension: string
}

export interface FileStorageConfig {
  baseDir: string
  tempDir: string
  tempFileTTL: number
  privateUrlExpiry: number
  secretKey: string
}

export interface FileAccessOptions {
  isPrivate?: boolean
  expirySeconds?: number
}

export interface SignedUrlParams {
  namespace: string
  filename: string
  expiry: number
  signature: string
}

const DEFAULT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const DEFAULT_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.csv',
  '.json',
  '.xlsx',
  '.docx',
]

let storageConfig: FileStorageConfig | null = null

export function getFileStorageConfig(): FileStorageConfig {
  if (storageConfig) return storageConfig

  const baseDir = process.env.FILE_STORAGE_PATH || join(process.cwd(), 'uploads')
  const tempDir = process.env.FILE_TEMP_PATH || join(baseDir, 'temp')
  const tempFileTTL = parseInt(process.env.FILE_TEMP_TTL || '3600000', 10)
  const privateUrlExpiry = parseInt(process.env.FILE_PRIVATE_URL_EXPIRY || '3600', 10)
  const secretKey = process.env.FILE_SECRET_KEY || 'default-secret-key-change-in-production'

  storageConfig = {
    baseDir,
    tempDir,
    tempFileTTL,
    privateUrlExpiry,
    secretKey,
  }

  return storageConfig
}

export function getUploadConfig(
  namespace: string,
  overrides?: Partial<FileUploadConfig>
): FileUploadConfig {
  const config = getFileStorageConfig()

  return {
    uploadDir: join(config.baseDir, namespace),
    maxFileSize: overrides?.maxFileSize ?? 10 * 1024 * 1024,
    allowedMimeTypes: overrides?.allowedMimeTypes ?? DEFAULT_MIME_TYPES,
    allowedExtensions: overrides?.allowedExtensions ?? DEFAULT_EXTENSIONS,
  }
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

export function validateFile(
  file: { name: string; type: string; size: number },
  config: FileUploadConfig
): { valid: boolean; error?: string } {
  if (file.size > config.maxFileSize) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${config.maxFileSize} bytes`,
    }
  }

  if (!config.allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type "${file.type}" is not allowed`,
    }
  }

  const ext = extname(file.name).toLowerCase()
  if (!config.allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `File extension "${ext}" is not allowed`,
    }
  }

  return { valid: true }
}

export async function saveFile(
  namespace: string,
  file: { name: string; type: string; size: number; data: ArrayBuffer },
  configOverrides?: Partial<FileUploadConfig>
): Promise<UploadedFile> {
  if (isCloudflare) {
    throw new Error(
      'Local file storage is not supported in Cloudflare environment. Use R2 or other cloud storage.'
    )
  }

  const config = getUploadConfig(namespace, configOverrides)

  const validation = validateFile(file, config)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  await ensureDir(config.uploadDir)

  const ext = extname(file.name).toLowerCase()
  const filename = `${randomUUID()}${ext}`
  const filePath = join(config.uploadDir, filename)

  await writeFile(filePath, Buffer.from(file.data))

  return {
    filename,
    originalName: file.name,
    mimeType: file.type,
    size: file.size,
    path: filePath,
    extension: ext,
  }
}

export async function saveToTemp(
  file: { name: string; type: string; size: number; data: ArrayBuffer },
  configOverrides?: Partial<FileUploadConfig>
): Promise<UploadedFile> {
  if (isCloudflare) {
    throw new Error(
      'Local file storage is not supported in Cloudflare environment. Use R2 or other cloud storage.'
    )
  }

  const config = getFileStorageConfig()
  const uploadConfig = getUploadConfig('temp', configOverrides)

  const validation = validateFile(file, uploadConfig)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  await ensureDir(config.tempDir)

  const ext = extname(file.name).toLowerCase()
  const filename = `${randomUUID()}${ext}`
  const filePath = join(config.tempDir, filename)

  await writeFile(filePath, Buffer.from(file.data))

  return {
    filename,
    originalName: file.name,
    mimeType: file.type,
    size: file.size,
    path: filePath,
    extension: ext,
  }
}

export async function readFileData(filePath: string): Promise<Buffer> {
  if (isCloudflare) {
    throw new Error('Local file storage is not supported in Cloudflare environment.')
  }

  if (!existsSync(filePath)) {
    throw new Error('File not found')
  }

  return readFile(filePath)
}

export async function getFileStream(filePath: string): Promise<ReadableStream> {
  if (isCloudflare) {
    throw new Error('Local file storage is not supported in Cloudflare environment.')
  }

  if (!existsSync(filePath)) {
    throw new Error('File not found')
  }

  const file = await readFile(filePath)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(file)
      controller.close()
    },
  })
}

export async function deleteFile(filePath: string): Promise<boolean> {
  if (isCloudflare) {
    throw new Error('Local file storage is not supported in Cloudflare environment.')
  }

  try {
    if (existsSync(filePath)) {
      await unlink(filePath)
    }
    return true
  } catch {
    return false
  }
}

export async function moveFile(sourcePath: string, namespace: string): Promise<string> {
  if (isCloudflare) {
    throw new Error('Local file storage is not supported in Cloudflare environment.')
  }

  const config = getUploadConfig(namespace)
  await ensureDir(config.uploadDir)

  const filename = sourcePath.split('/').pop() || randomUUID()
  const destPath = join(config.uploadDir, filename)

  const { rename } = await import('fs/promises')
  await rename(sourcePath, destPath)

  return destPath
}

export async function cleanupTempFiles(): Promise<{ deleted: number; errors: number }> {
  if (isCloudflare) {
    return { deleted: 0, errors: 0 }
  }

  const config = getFileStorageConfig()
  let deleted = 0
  let errors = 0

  if (!existsSync(config.tempDir)) {
    return { deleted, errors }
  }

  const files = await readdir(config.tempDir)
  const now = Date.now()

  for (const file of files) {
    const filePath = join(config.tempDir, file)
    try {
      const fileStat = await stat(filePath)
      const fileAge = now - fileStat.mtimeMs

      if (fileAge > config.tempFileTTL) {
        await unlink(filePath)
        deleted++
      }
    } catch {
      errors++
    }
  }

  return { deleted, errors }
}

export async function clearNamespace(
  namespace: string
): Promise<{ deleted: number; errors: number }> {
  if (isCloudflare) {
    return { deleted: 0, errors: 0 }
  }

  const config = getUploadConfig(namespace)
  let deleted = 0
  let errors = 0

  if (!existsSync(config.uploadDir)) {
    return { deleted, errors }
  }

  try {
    await rm(config.uploadDir, { recursive: true })
    deleted = 1
  } catch {
    errors = 1
  }

  return { deleted, errors }
}

export function getFilePath(namespace: string, filename: string): string {
  const config = getFileStorageConfig()
  return join(config.baseDir, namespace, filename)
}

export function getPublicFileUrl(namespace: string, filename: string, baseUrl?: string): string {
  if (baseUrl) {
    return `${baseUrl}/files/public/${namespace}/${filename}`
  }
  return `/files/public/${namespace}/${filename}`
}

export function getPublicFilePath(namespace: string, filename: string): string {
  return `/files/public/${namespace}/${filename}`
}

export function generateSignature(namespace: string, filename: string, expiry: number): string {
  const config = getFileStorageConfig()
  const data = `${namespace}:${filename}:${expiry}`
  return createHmac('sha256', config.secretKey).update(data).digest('hex')
}

export function verifySignature(
  namespace: string,
  filename: string,
  expiry: number,
  signature: string
): boolean {
  const expectedSignature = generateSignature(namespace, filename, expiry)
  try {
    const sigBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')
    return sigBuffer.length === expectedBuffer.length && timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return false
  }
}

export function getPrivateFileUrl(
  namespace: string,
  filename: string,
  expirySeconds?: number,
  baseUrl?: string
): { url: string; expiry: number } {
  const config = getFileStorageConfig()
  const expiry = Math.floor(Date.now() / 1000) + (expirySeconds || config.privateUrlExpiry)
  const signature = generateSignature(namespace, filename, expiry)

  const url = baseUrl
    ? `${baseUrl}/files/private/${namespace}/${filename}?expiry=${expiry}&signature=${signature}`
    : `/files/private/${namespace}/${filename}?expiry=${expiry}&signature=${signature}`

  return { url, expiry }
}

export function parseSignedUrl(path: string): SignedUrlParams | null {
  const match = path.match(/\/files\/private\/([^/]+)\/(.+)$/)
  if (!match) return null

  return {
    namespace: match[1],
    filename: match[2],
    expiry: 0,
    signature: '',
  }
}

export function getFileUrl(
  namespace: string,
  filename: string,
  options?: FileAccessOptions,
  baseUrl?: string
): { url: string; isPrivate: boolean; expiry?: number } {
  if (options?.isPrivate) {
    const { url, expiry } = getPrivateFileUrl(namespace, filename, options.expirySeconds, baseUrl)
    return { url, isPrivate: true, expiry }
  }
  return { url: getPublicFileUrl(namespace, filename, baseUrl), isPrivate: false }
}

export async function fileExists(namespace: string, filename: string): Promise<boolean> {
  const filePath = getFilePath(namespace, filename)
  return existsSync(filePath)
}

export async function getFileInfo(
  namespace: string,
  filename: string
): Promise<{ size: number; mimeType: string; lastModified: Date } | null> {
  const filePath = getFilePath(namespace, filename)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const stats = await stat(filePath)
    const ext = extname(filename).toLowerCase()

    const mimeTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }

    return {
      size: stats.size,
      mimeType: mimeTypeMap[ext] || 'application/octet-stream',
      lastModified: stats.mtime,
    }
  } catch {
    return null
  }
}
