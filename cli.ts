#!/usr/bin/env bun
import { generateTypes } from "./lib/generate-types"
import { resolve } from "path"

const args = process.argv.slice(2)

function printHelp() {
  console.log(`
pgstrap - Generate TypeScript types from PostgreSQL schemas

Usage:
  pgstrap generate [options]

Options:
  --migrations-dir <dir>   Directory containing SQL migration files (default: ./migrations)
  --output <file>          Output file for generated types (default: ./db-types.ts)
  --help                   Show this help message
`)
}

async function main() {
  const command = args[0]

  if (!command || command === "--help" || command === "-h") {
    printHelp()
    process.exit(0)
  }

  if (command === "generate") {
    const migrationsDir = getArg("--migrations-dir") ?? "./migrations"
    const output = getArg("--output") ?? "./db-types.ts"

    await generateTypes({
      migrationsDir: resolve(process.cwd(), migrationsDir),
      outputFile: resolve(process.cwd(), output),
    })
  } else {
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
  }
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx === -1) return undefined
  return args[idx + 1]
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
