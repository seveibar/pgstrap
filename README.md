# pgstrap

Generate TypeScript types from PostgreSQL schemas — **no running PostgreSQL required!**

pgstrap uses [PGlite](https://github.com/electric-sql/pglite) (an in-process WASM PostgreSQL) to run your migrations in memory and introspect the resulting schema to produce TypeScript types.

## Installation

