import { createRoute, z } from '@hono/zod-openapi'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  getFilePath,
  readFileData,
  getFileInfo,
  verifySignature,
  getPublicFileUrl,
  getPrivateFileUrl,
} from '../../utils/file-storage'
import { successResponse, errorResponse, success } from '../../utils/route-helpers'
import {
  FileDownloadSchema,
  PrivateFileQuerySchema,
  GenerateUrlRequestSchema,
  FileUrlResponseSchema,
} from '@shared/schemas'

const FileContentSchema = z.any()

const publicFileRoute = createRoute({
  method: 'get',
  path: '/public/{namespace}/{filename}',
  tags: ['files'],
  request: {
    params: FileDownloadSchema,
  },
  responses: {
    200: {
      description: 'File content',
      content: {
        'application/octet-stream': {
          schema: FileContentSchema,
        },
      },
    },
    404: errorResponse('File not found'),
  },
})

const privateFileRoute = createRoute({
  method: 'get',
  path: '/private/{namespace}/{filename}',
  tags: ['files'],
  request: {
    params: FileDownloadSchema,
    query: PrivateFileQuerySchema,
  },
  responses: {
    200: {
      description: 'File content',
      content: {
        'application/octet-stream': {
          schema: FileContentSchema,
        },
      },
    },
    403: errorResponse('Invalid or expired signature'),
    404: errorResponse('File not found'),
  },
})

const generateUrlRoute = createRoute({
  method: 'post',
  path: '/generate-url',
  tags: ['files'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: GenerateUrlRequestSchema,
        },
      },
    },
  },
  responses: {
    200: successResponse(FileUrlResponseSchema, 'URL generated successfully'),
    400: errorResponse('Invalid request'),
    404: errorResponse('File not found'),
  },
})

const checkFileRoute = createRoute({
  method: 'head',
  path: '/public/{namespace}/{filename}',
  tags: ['files'],
  request: {
    params: FileDownloadSchema,
  },
  responses: {
    200: {
      description: 'File exists',
      content: {
        'application/octet-stream': {
          schema: z.null(),
        },
      },
    },
    404: errorResponse('File not found'),
  },
})

const checkPrivateFileRoute = createRoute({
  method: 'head',
  path: '/private/{namespace}/{filename}',
  tags: ['files'],
  request: {
    params: FileDownloadSchema,
    query: PrivateFileQuerySchema,
  },
  responses: {
    200: {
      description: 'File exists',
      content: {
        'application/octet-stream': {
          schema: z.null(),
        },
      },
    },
    403: errorResponse('Invalid or expired signature'),
    404: errorResponse('File not found'),
  },
})

export const fileRoutes = new OpenAPIHono()
  .openapi(publicFileRoute, async c => {
    const { namespace, filename } = c.req.valid('param')

    const fileInfo = await getFileInfo(namespace, filename)
    if (!fileInfo) {
      return c.json({ success: false, error: 'File not found' }, 404)
    }

    const filePath = getFilePath(namespace, filename)
    const fileData = await readFileData(filePath)

    c.header('Content-Type', fileInfo.mimeType)
    c.header('Content-Length', fileInfo.size.toString())
    c.header('Content-Disposition', `inline; filename="${filename}"`)
    c.header('Cache-Control', 'public, max-age=31536000')
    c.header('Last-Modified', fileInfo.lastModified.toUTCString())

    return c.body(fileData as unknown as ReadableStream)
  })
  .openapi(privateFileRoute, async c => {
    const { namespace, filename } = c.req.valid('param')
    const { expiry, signature } = c.req.valid('query')

    const now = Math.floor(Date.now() / 1000)
    if (now > expiry) {
      return c.json({ success: false, error: 'URL has expired' }, 403)
    }

    if (!verifySignature(namespace, filename, expiry, signature)) {
      return c.json({ success: false, error: 'Invalid signature' }, 403)
    }

    const fileInfo = await getFileInfo(namespace, filename)
    if (!fileInfo) {
      return c.json({ success: false, error: 'File not found' }, 404)
    }

    const filePath = getFilePath(namespace, filename)
    const fileData = await readFileData(filePath)

    c.header('Content-Type', fileInfo.mimeType)
    c.header('Content-Length', fileInfo.size.toString())
    c.header('Content-Disposition', `inline; filename="${filename}"`)
    c.header('Cache-Control', 'private, no-store')

    return c.body(fileData as unknown as ReadableStream)
  })
  .openapi(generateUrlRoute, async c => {
    const { namespace, filename, isPrivate, expirySeconds } = c.req.valid('json')

    const fileInfo = await getFileInfo(namespace, filename)
    if (!fileInfo) {
      return c.json({ success: false, error: 'File not found' }, 404)
    }

    const baseUrl = process.env.PUBLIC_URL || ''

    if (isPrivate) {
      const { url, expiry } = getPrivateFileUrl(namespace, filename, expirySeconds, baseUrl)
      return c.json(success({ url, expiry }), 200)
    }

    const url = getPublicFileUrl(namespace, filename, baseUrl)
    return c.json(success({ url }), 200)
  })
  .openapi(checkFileRoute, async c => {
    const { namespace, filename } = c.req.valid('param')

    const fileInfo = await getFileInfo(namespace, filename)
    if (!fileInfo) {
      return c.json({ success: false, error: 'File not found' }, 404)
    }

    c.header('Content-Type', fileInfo.mimeType)
    c.header('Content-Length', fileInfo.size.toString())
    c.header('Last-Modified', fileInfo.lastModified.toUTCString())

    return c.body(null, 200)
  })
  .openapi(checkPrivateFileRoute, async c => {
    const { namespace, filename } = c.req.valid('param')
    const { expiry, signature } = c.req.valid('query')

    const now = Math.floor(Date.now() / 1000)
    if (now > expiry) {
      return c.json({ success: false, error: 'URL has expired' }, 403)
    }

    if (!verifySignature(namespace, filename, expiry, signature)) {
      return c.json({ success: false, error: 'Invalid signature' }, 403)
    }

    const fileInfo = await getFileInfo(namespace, filename)
    if (!fileInfo) {
      return c.json({ success: false, error: 'File not found' }, 404)
    }

    c.header('Content-Type', fileInfo.mimeType)
    c.header('Content-Length', fileInfo.size.toString())

    return c.body(null, 200)
  })
