#!/usr/bin/env node

import { spawn } from 'child_process'
import { createServer } from 'net'

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

async function main(): Promise<void> {
  const port = await getAvailablePort()

  const env = {
    ...process.env,
    PORT: String(port),
  }

  const args = process.argv.slice(2)
  const viteArgs = ['vite', '--port', String(port), ...args]

  const child = spawn('npx', viteArgs, {
    stdio: ['inherit', 'inherit', 'inherit'],
    env,
    shell: true,
  })

  process.stdout.write(`PLAYWRIGHT_TEST_BASE_URL=http://localhost:${port}\n`)

  child.on('error', error => {
    console.error('Failed to start server:', error)
    process.exit(1)
  })

  child.on('exit', code => {
    process.exit(code || 0)
  })

  process.on('SIGINT', () => {
    child.kill('SIGINT')
  })

  process.on('SIGTERM', () => {
    child.kill('SIGTERM')
  })
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
