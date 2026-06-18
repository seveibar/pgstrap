#!/usr/bin/env node
import * as path from "path";
import * as fs from "fs";
import { generate } from "./generate";

interface Config {
  migrationsDir?: string;
  schemaFile?: string;
  outputFile?: string;
  databaseUrl?: string;
}

function loadConfig(): Config {
  const configPaths = [
    "pgstrap.config.json",
    "pgstrap.config.js",
    "pgstrap.config.ts",
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        if (configPath.endsWith(".json")) {
          const content = fs.readFileSync(configPath, "utf-8");
          return JSON.parse(content);
        }
        // For .js/.ts configs, try require
        return require(path.resolve(configPath));
      } catch (err) {
        // ignore
      }
    }
  }

  return {};
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(`
pgstrap - PostgreSQL type generation (no running PostgreSQL required!)

Usage:
  pgstrap generate [options]
  pgstrap gen [options]

Options:
  --migrations-dir <dir>   Directory containing SQL migration files (default: ./migrations)
  --schema-file <file>     Single SQL schema file to use
  --output <file>          Output file for generated types (default: ./src/db/schema.ts)
  --database-url <url>     PostgreSQL connection URL (optional, uses PGlite if not provided)
  --help                   Show this help message

Configuration:
  You can also use a pgstrap.config.json file:
  {
    "migrationsDir": "./migrations",
    "outputFile": "./src/db/schema.ts"
  }

Examples:
  pgstrap generate
  pgstrap generate --migrations-dir ./db/migrations --output ./src/types/db.ts
  pgstrap generate --schema-file ./schema.sql
`);
    process.exit(0);
  }

  if (command === "generate" || command === "gen") {
    const config = loadConfig();

    // Parse CLI arguments
    let migrationsDir = config.migrationsDir;
    let schemaFile = config.schemaFile;
    let outputFile = config.outputFile || "./src/db/schema.ts";
    let databaseUrl = config.databaseUrl || process.env.DATABASE_URL;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--migrations-dir" && args[i + 1]) {
        migrationsDir = args[++i];
      } else if (args[i] === "--schema-file" && args[i + 1]) {
        schemaFile = args[++i];
      } else if (args[i] === "--output" && args[i + 1]) {
        outputFile = args[++i];
      } else if (args[i] === "--database-url" && args[i + 1]) {
        databaseUrl = args[++i];
      }
    }

    // Default migrations dir
    if (!migrationsDir && !schemaFile) {
      const defaultDirs = ["./migrations", "./db/migrations", "./database/migrations", "./drizzle"];
      for (const dir of defaultDirs) {
        if (fs.existsSync(dir)) {
          migrationsDir = dir;
          break;
        }
      }
    }

    if (migrationsDir) {
      console.log(`Using migrations directory: ${migrationsDir}`);
    }
    if (schemaFile) {
      console.log(`Using schema file: ${schemaFile}`);
    }

    try {
      await generate({
        migrationsDir,
        schemaFile,
        outputFile,
        databaseUrl,
      });
    } catch (err: any) {
      console.error("Error generating types:", err.message);
      process.exit(1);
    }
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'pgstrap --help' for usage information.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
