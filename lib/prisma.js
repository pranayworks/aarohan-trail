// ============================================================================
// AArohan Smart Urban Mobility • Prisma Database Client
// Lilongwe, Malawi • PostgreSQL on Supabase (Pooler + Direct)
// ============================================================================

const { PrismaClient } = require('@prisma/client');

let prisma;

const dbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // Prevent multiple instances in development / hot reload
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      datasources: dbUrl ? { db: { url: dbUrl } } : undefined,
      log: process.env.DEBUG_PRISMA ? ['query', 'error', 'warn'] : ['error']
    });
  }
  prisma = global.__prisma;
}

module.exports = prisma;
