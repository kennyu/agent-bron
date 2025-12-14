import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Create postgres connection
const connectionString = process.env.DATABASE_URL;

console.log('[DB] Initializing database connection...');
console.log('[DB] DATABASE_URL:', connectionString ? `${connectionString.split('@')[0].split(':').slice(0, 2).join(':')}:***@${connectionString.split('@')[1]}` : 'NOT SET');

if (!connectionString) {
  console.error('[DB] ERROR: DATABASE_URL environment variable is required');
  throw new Error('DATABASE_URL environment variable is required');
}

const client = postgres(connectionString, {
  onnotice: (notice) => console.log('[DB] Notice:', notice.message),
  debug: (connection, query, params) => {
    if (process.env.DB_DEBUG === 'true') {
      console.log('[DB] Query:', query.substring(0, 100));
    }
  },
});

console.log('[DB] PostgreSQL client created');
export const db = drizzle(client, { schema });
console.log('[DB] Drizzle ORM initialized');

// Export schema for use elsewhere
export * from './schema';
