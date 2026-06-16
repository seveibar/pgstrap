#!/usr/bin/env node
import { generate } from "./generate";
import * as path from "path";

function printUsage() {
  console.log(`
pgstrap - Generate TypeScript types from PostgreSQL schemas (no running postgres required)

Usage:
  pgstrap generate [options]

Options:
  --migrations-dir <dir>   Directory containing SQL migration files (default: ./migrations)
  --output <file>          Output TypeScript file (default: ./src/db-types.ts)
  --schema <schema>        PostgreSQL schema to introspect (default: public)
  --help                   Show this help message

Example:
  pgstrap generate --migrations-dir ./migrations --output ./src/types/db.ts
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  if (command === "generate") {
    const options: {
      migrationsDir: string;
      output: string;
      schema: string;
    } = {
      migrationsDir: "./migrations",
      output: "./src/db-types.ts",
      schema: "public",
    };

    for (let i = 1; i < args.length; i++) {
      switch (args[i]) {
        case "--migrations-dir":
          options.migrationsDir = args[++i];
          break;
        case "--output":
          options.output = args[++i];
          break;
        case "--schema":
          options.schema = args[++i];
          break;
        case "--help":
        case "-h":
          printUsage();
          process.exit(0);
          break;
        default:
          console.error(`Unknown option: ${args[i]}`);
          printUsage();
          process.exit(1);
      }
    }

    // Resolve paths relative to cwd
    options.migrationsDir = path.resolve(process.cwd(), options.migrationsDir);
    options.output = path.resolve(process.cwd(), options.output);

    try {
      await generate(options);
    } catch (err: any) {
      console.error("Error generating types:", err.message);
      process.exit(1);
    }
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

main();
