import type { Plugin } from 'vite'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import http from 'http'

let entryLoaded = false

export function websocketPlugin(): Plugin {
  return {
    name: 'websocket-upgrade',
    configureServer(server) {
      server.httpServer?.once('listening', async () => {
        const address = server.httpServer?.address()
        if (address && typeof address === 'object') {
          const port = address.port
          try {
            await new Promise<void>((resolve, reject) => {
              const req = http.get(`http://localhost:${port}/health`, res => {
                if (res.statusCode === 200) {
                  entryLoaded = true
                  resolve()
                } else {
                  reject(new Error(`Health check failed with status ${res.statusCode}`))
                }
              })
              req.on('error', reject)
              req.end()
            })
          } catch (error) {
            console.error('[WebSocket Plugin] Failed to load entry file:', error)
          }
        }
      })

      server.httpServer?.on(
        'upgrade',
        async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
          if (req.url) {
            let waitRetries = 0
            while (!entryLoaded && waitRetries < 30) {
              await new Promise(resolve => setTimeout(resolve, 100))
              waitRetries++
            }

            if (!entryLoaded) {
              return
            }

            const { getRuntimeAdapter, setRuntimeAdapter } =
              await import('./src/server/core/runtime')
            const { getNodeRuntimeAdapter } = await import('./src/server/core/runtime-node')

            let runtime:
              | InstanceType<typeof import('./src/server/core/runtime-node').NodeRuntimeAdapter>
              | undefined
            try {
              runtime = getRuntimeAdapter() as InstanceType<
                typeof import('./src/server/core/runtime-node').NodeRuntimeAdapter
              >
            } catch {
              runtime = getNodeRuntimeAdapter()
              setRuntimeAdapter(runtime)

              const address = server.httpServer?.address()
              if (address && typeof address === 'object') {
                const port = address.port
                await new Promise<void>((resolve, reject) => {
                  const req = http.get(`http://localhost:${port}/health`, res => {
                    if (res.statusCode === 200) {
                      resolve()
                    } else {
                      reject(new Error(`Health check failed with status ${res.statusCode}`))
                    }
                  })
                  req.on('error', reject)
                  req.end()
                })
              }
            }

            const urlObj = new URL(req.url!, 'http://localhost')
            if (runtime && runtime.hasWSPath(urlObj.pathname)) {
              const { WebSocketServer } = await import('ws')
              const wssInstance = new WebSocketServer({ noServer: true })
              wssInstance.handleUpgrade(req, socket, head, ws => {
                if (runtime) {
                  runtime.handleConnection(ws)
                }
              })
            }
          }
        }
      )
    },
  }
}

export function dbPlugin(): Plugin {
  return {
    name: 'db-bootstrap',
    configureServer(server) {
      server.httpServer?.once('listening', async () => {
        const { getDb, runMigrations } = await import('./src/server/db')
        const { logger } = await import('./src/server/utils/logger')
        const log = logger.bootstrap()

        try {
          log.info({}, 'Initializing database...')
          await getDb()
          await runMigrations()
          const { initializeDatabase } = await import('./src/server/db/init')
          await initializeDatabase()
          log.info({}, 'Database ready')
        } catch (err) {
          log.error({ err }, 'Database initialization failed')
        }
      })
    },
  }
}
