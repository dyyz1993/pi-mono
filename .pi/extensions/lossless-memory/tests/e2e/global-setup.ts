import { FullConfig } from '@playwright/test'
import { createServer } from 'net'
import { spawn } from 'child_process'

declare global {
  var __DEV_SERVER__: ReturnType<typeof spawn> | undefined
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function waitForServer(port: number, timeout = 60000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const http = await import('http')
      await new Promise<void>((resolve, reject) => {
        const req = http.request(`http://localhost:${port}`, { method: 'HEAD' }, res => {
          if (res.statusCode && res.statusCode < 500) resolve()
          else reject(new Error('Server not ready'))
        })
        req.on('error', reject)
        req.end()
      })
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  throw new Error(`Server did not start within ${timeout}ms`)
}

export default async function globalSetup(_config: FullConfig) {
  const port = await getAvailablePort()
  const baseUrl = `http://localhost:${port}`

  process.env.PLAYWRIGHT_TEST_BASE_URL = baseUrl
  process.env.TEST_PORT = String(port)

  process.stdout.write(`\n🚀 Starting dev server on port ${port}...\n`)

  const devServer = spawn('npx', ['vite', '--port', String(port)], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PORT: String(port),
    },
  })

  globalThis.__DEV_SERVER__ = devServer

  devServer.on('error', error => {
    process.stderr.write(`Failed to start dev server: ${error}\n`)
    process.exit(1)
  })

  await waitForServer(port)
  process.stdout.write(`✅ Dev server ready at ${baseUrl}\n\n`)
}
