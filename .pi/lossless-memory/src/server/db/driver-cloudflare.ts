import * as schema from './schema'
import { drizzle } from 'drizzle-orm/d1'
import { logger } from '../utils/logger'

type Db = ReturnType<typeof drizzle<typeof schema>>

const log = logger.db()

export async function getDb(): Promise<Db> {
  const config = getDatabaseConfig()

  log.debug({ driver: 'd1' }, 'Creating database connection')

  if (!config.d1Database) {
    throw new Error('D1 database binding not found. Make sure D1 is configured in wrangler.toml')
  }

  const db = drizzle(config.d1Database, { schema })

  log.info({ driver: 'd1' }, 'Database connected')
  return db
}

export async function getRawClient(): Promise<D1Database | null> {
  const config = getDatabaseConfig()
  return config.d1Database || null
}

export async function closeDb(): Promise<void> {
  log.info({}, 'Database connection closed')
}

export async function runMigrations(): Promise<void> {
  log.info({}, 'Migrations skipped in Cloudflare Workers')
}

interface D1DatabaseConfig {
  driver: 'd1'
  d1Database?: D1Database
}

function getDatabaseConfig(): D1DatabaseConfig {
  // Try to get DB from globalThis first (set by middleware)
  const globalDB = (globalThis as unknown as { DB?: D1Database }).DB

  return {
    driver: 'd1',
    d1Database: globalDB,
  }
}
