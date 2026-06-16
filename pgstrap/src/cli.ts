#!/usr/bin/env node
import { program } from "commander"
import path from "path"
import fs from "fs"
import { generateTypes } from "./generate"

program
  .name("pgstrap")
  .description("Generate TypeScript types from PostgreSQL schemas using PGlite")
  .version("0.1.0")

program
  .command("generate")
  .description(
    "Generate TypeScript types from SQL schema files (no running Postgres required)"
  )
  .option(
    "-s, --schema <files...>",
    "SQL schema files to load (in order)",
    []
  )
  .option(
    "-o, --output <file>",
    "Output TypeScript file",
    "./src/db/types.ts"
  )
  .option(
    "--schema-name <name>",
    "PostgreSQL schema name to introspect",
    "public"
  )
  .action(async (options) => {
    const schemaFiles: string[] = options.schema.map((f: string) =>
      path.resolve(f)
    )

    for (const file of schemaFiles) {
      if (!fs.existsSync(file)) {
        console.error(`Schema file not found: ${file}`)
        process.exit(1)
      }
    }

    if (schemaFiles.length === 0) {
      console.error(
        "No schema files specified. Use --schema <file> to specify SQL files."
      )
      process.exit(1)
    }

    await generateTypes({
      schemaFiles,
      outputFile: path.resolve(options.output),
      schemaName: options.schemaName,
    })
  })

program.parse()
