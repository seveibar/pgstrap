-- Define your database schema here.
-- This file is loaded into an in-memory PGlite instance when running
-- `bun run db:generate`, so no external Postgres server is required.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
