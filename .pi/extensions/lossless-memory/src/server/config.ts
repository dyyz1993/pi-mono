import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { isCloudflare } from './utils/env';

export type DatabaseDriver = 'sqlite' | 'mysql' | 'd1';

export interface DatabaseConfig {
  driver: DatabaseDriver;
  sqlitePath?: string;
  mysqlHost?: string;
  mysqlPort?: number;
  mysqlUser?: string;
  mysqlPassword?: string;
  mysqlDatabase?: string;
  d1Database?: D1Database;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  enableDocs: boolean;
  database: DatabaseConfig;
}

function loadEnvFileSync(): void {
  if (isCloudflare) return;
  
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  const envFiles: Record<string, string> = {
    test: '.env.test',
    development: '.env.local',
    production: '.env.production',
  };

  const envFile = envFiles[nodeEnv];
  if (envFile) {
    const envPath = resolve(process.cwd(), envFile);
    if (existsSync(envPath)) {
      config({ path: envPath });
    }
  }
}

loadEnvFileSync();

export function getAppConfig(): AppConfig {
  const nodeEnv = typeof process !== 'undefined' 
    ? (process.env.NODE_ENV || 'development')
    : 'production';
  
  const port = typeof process !== 'undefined'
    ? parseInt(process.env.PORT || '3010', 10)
    : 3010;
  
  const enableDocs = typeof process !== 'undefined'
    ? process.env.ENABLE_DOCS !== 'false'
    : false;
  
  const dbDriver = typeof process !== 'undefined'
    ? (process.env.DB_DRIVER as DatabaseDriver) || 'sqlite'
    : 'd1';
  
  return {
    nodeEnv,
    port,
    enableDocs,
    database: {
      driver: isCloudflare ? 'd1' : dbDriver,
      sqlitePath: typeof process !== 'undefined' ? process.env.SQLITE_PATH || `./data/${nodeEnv}.db` : undefined,
      mysqlHost: typeof process !== 'undefined' ? process.env.MYSQL_HOST || 'localhost' : undefined,
      mysqlPort: typeof process !== 'undefined' ? parseInt(process.env.MYSQL_PORT || '3306', 10) : undefined,
      mysqlUser: typeof process !== 'undefined' ? process.env.MYSQL_USER || 'root' : undefined,
      mysqlPassword: typeof process !== 'undefined' ? process.env.MYSQL_PASSWORD || '' : undefined,
      mysqlDatabase: typeof process !== 'undefined' ? process.env.MYSQL_DATABASE || 'app' : undefined,
      d1Database: (globalThis as unknown as { DB?: D1Database }).DB,
    },
  };
}

export function getDatabaseConfig(): DatabaseConfig {
  return getAppConfig().database;
}
