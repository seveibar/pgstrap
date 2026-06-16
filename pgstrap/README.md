# pgstrap

Generate TypeScript types from PostgreSQL schema files — **no running Postgres required**.

pgstrap uses [PGlite](https://github.com/electric-sql/pglite) to run an in-memory PostgreSQL-compatible database, applies your SQL migrations, introspects the schema, and generates TypeScript types — all without needing a Postgres server running.

## Installation

