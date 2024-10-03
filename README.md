# pgstrap

[![npm version](https://badge.fury.io/js/pgstrap.svg)](https://badge.fury.io/js/pgstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

pgstrap is a powerful bootstrapping utility for Postgres/TypeScript projects, designed to streamline your database management workflow and enhance type safety.

## Features

- 🚀 Quick setup with TypeScript support
- 📁 Organized migration structure in `[src]/db/migrations`
- 🔧 "Standard Shorthands" for UUIDs and `created_at` timestamps
- 🧪 Automated migration runs in tests
- 🔄 Automatic type generation for Zapatos and Kysely
- 🔁 Database reset and migration scripts
- 📊 Automatic schema dumps with `[src]/db/zapatos`
- 🏗️ Database structure dumps in `[src]/db/structure`

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

5. Run the migration:
   ```bash
   npm run db:migrate
   ```

6. Generate types and structure:
   ```bash
   npm run db:generate
   ```

## Usage

### Available Scripts

- `npm run db:migrate` - Run pending migrations
- `npm run db:reset` - Drop and recreate the database, then run all migrations
- `npm run db:generate` - Generate types and structure dumps
- `npm run db:create-migration` - Create a new migration file

### Configuration

After running `pgstrap init`, you'll find a `pgstrap.config.js` file in your project root. Customize it as needed:

```javascript
module.exports = {
  defaultDatabase: "mydb",
  schemas: ["public"],
  dbDir: "./src/db", // optional, defaults to "./src/db"
}
```

## Best Practices

1. **Version Control**: Always commit your migration files to version control.
2. **Review Migrations**: Carefully review generated migrations before running them.
3. **Test Migrations**: Run migrations in a test environment before applying to production.
4. **Use TypeScript**: Leverage the generated types for type-safe database operations.

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
