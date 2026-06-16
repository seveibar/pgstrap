# pgstrap

Generate TypeScript types from PostgreSQL schema migrations — **no running Postgres required**.

pgstrap uses [PGlite](https://github.com/electric-sql/pglite) (a WebAssembly build of PostgreSQL) to run your migrations in-memory and introspect the resulting schema, producing TypeScript interface definitions automatically.

## Installation

