# pgstrap

Bootstrapping utilities for Postgres/Typescript projects.

- Use Typescript
- Put migrations in `[src]/db/migrations`
- "Standard Shorthands" for uuids and `created_at` timestamps
- Code to automatically run migrations in tests
- Automatic zapatos/kysely type generation
- Reset database and migrate scripts
- Automatic `[src]/db/zapatos` which dumps the database types
- Automatic `[src]/db/structure` which dumps the database structure

This module encapsulates all that functionality into one, easy-to-use
module.

## Usage

### Scripts

- `pgstrap init` - Set up a project to use `pgstrap`
- `pgstrap create-migration` - create new migration
- `pgstrap reset` - drop database and recreate, then migrate
- `pgstrap migrate` - migrate database
- `pgstrap generate` - migrate database and generate new types and structure

### Config

By running `pgstrap init` you'll automatically get a config generated, here's
what you can customize:

```ts
module.exports = {
  defaultDatabase: "mydb",
  schemas: ["main"],

  // Directory to store migrations, structure and database utility files
  dbDir: "./src/db", // optional
}
```

### Attributions

- This project was originally developed as [seam-pgm](https://github.com/seamapi/seam-pgm) by Seam Labs Inc. in 2024
