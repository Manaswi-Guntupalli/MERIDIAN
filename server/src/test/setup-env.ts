// Runs in every worker BEFORE any test module (and therefore before the
// Prisma client singleton) is imported — points the app at the test database.
process.env.DATABASE_URL = 'file:./test.db';
process.env.NODE_ENV = 'test';
