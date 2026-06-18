# pgstrap

PostgreSQL type generation that **doesn't require a running PostgreSQL instance**.

pgstrap uses [PGlite](https://github.com/electric-sql/pglite) — a WebAssembly build of PostgreSQL — to run your migrations in-memory and generate TypeScript types from your schema, with zero external dependencies.

## Installation

