import 'dotenv/config';

// DB-backed tests TRUNCATE every table. Point them at a dedicated database when
// available so the dev database survives a test run.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
