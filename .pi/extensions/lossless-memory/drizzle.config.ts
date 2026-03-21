import { defineConfig } from 'drizzle-kit';
import { getDatabaseConfig } from './src/server/db/config';

const config = getDatabaseConfig();

export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: config.sqlitePath || './data/app.db',
  },
});
