# pgstrap

[![npm version](https://badge.fury.io/js/pgstrap.svg)](https://badge.fury.io/js/pgstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

pgstrap allows you to easily run typescript migrations or generate a directory that represents your database schemas with `table.sql` files. Run `pgstrap generate` to generate a directory with the structure of your postgres database schemas!

## Features

- Migrations with TypeScript support
- Organized migration structure in `[src]/db/migrations`
- Database reset and migration scripts
- Automatic typed schema files in `[src]/db/zapatos` (compatible with Zapatos and Kysely)
- Database `table.sql` structure dumps in `[src]/db/structure`
- Easily run migrations inside of tests

## Installation

```bash
npm install pgstrap --save-dev
```

## Quick Start

1. Initialize pgstrap in your project:

   ```bash
   npx pgstrap init
   ```

2. This will set up the necessary configuration and scripts in your `package.json`.

3. Create your first migration:

   ```bash
   npm run db:create-migration my-first-migration
   ```

4. Edit the migration file in `src/db/migrations/`.

5. To apply the migration to a running Postgres database:

   ```bash
   npm run db:migrate
   ```

6. Generate types and structure from migrations (no Postgres server required):
   ```bash
   npm run db:generate
   ```

## Usage

### Available Scripts

- `npm run db:migrate` - Run pending migrations
- `npm run db:reset` - Drop and recreate the database, then run all migrations
- `npm run db:generate` - Run migrations in an in-memory PGlite database and generate types and structure dumps, without a running Postgres service. Use `pgstrap generate --no-pglite` to generate from the database configured in your environment instead.
- `npm run db:create-migration` - Create a new migration file

The library `generate()` function also defaults to PGlite. Pass `pglite: false`
to introspect an existing Postgres database. Embedded generation starts from your
migration files; it does not read or change the database in `DATABASE_URL`.

### Configuration

After running `pgstrap init`, you'll find a `pgstrap.config.js` file in your project root. Customize it as needed:

```javascript
module.exports = {
  defaultDatabase: "mydb",
  schemas: ["public"],
  dbDir: "./src/db", // optional, defaults to "./src/db"
}
```

## Writing Migrations

Migrations in pgstrap are written using [node-pg-migrate](https://github.com/salsita/node-pg-migrate), which provides a powerful and flexible way to define database changes.

To create a new migration:

```bash
npm run db:create-migration my-migration-name
```

This will create a new file in `src/db/migrations/` with a timestamp prefix.

### Migration Structure

A typical migration file looks like this:

```typescript
import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate"

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Your migration code here
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Code to revert your migration (optional)
}
```

### Example Migration

Here's an example of a migration that creates a new table:

```typescript
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("users", {
    id: "id",
    username: { type: "text", notNull: true },
    email: { type: "text", notNull: true, unique: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  })

  pgm.createIndex("users", "username")
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("users")
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- This project was originally developed as [seam-pgm](https://github.com/seamapi/seam-pgm) by Seam Labs Inc. in 2024.
- Special thanks to the Zapatos and Kysely projects for their excellent TypeScript database tools.

## Support

If you encounter any issues or have questions, please file an issue on the [GitHub repository](https://github.com/seveibar/pgstrap/issues).

Happy coding with pgstrap! 🚀
