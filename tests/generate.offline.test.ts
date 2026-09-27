import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { generate } from "../src/generate"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('widgets', { id: 'id', label: { type: 'varchar(50)', notNull: true } })
}
exports.down = async (pgm) => {
  pgm.dropTable('widgets')
}
`

// Nothing is listening on port 1, so any attempt to reach postgres fails
// immediately. This emulates a machine without a postgres server (or a project
// whose DATABASE_URL points at a database that is not running).
const unreachableDb = "postgres://postgres:postgres@127.0.0.1:1/postgres"

const connectionEnvKeys = [
  "POSTGRES_URI",
  "PG_URI",
  "DATABASE_URL",
  "DATABASE_URI",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DATABASE",
]

test("generate works without a running postgres, even with connection env vars set", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-offline-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  const previousEnv = new Map(
    connectionEnvKeys.map((key) => [key, process.env[key]]),
  )

  // pg-connection-from-env prefers POSTGRES_URI/PG_URI over DATABASE_URL, and
  // falls back to the POSTGRES_* host variables. All of them point at a dead
  // server here, so generation only succeeds if the PGlite connection is pinned
  // for the schema dump as well.
  const pollutedEnv: Record<string, string> = {
    POSTGRES_URI: unreachableDb,
    PG_URI: unreachableDb,
    DATABASE_URL: unreachableDb,
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_PORT: "1",
    POSTGRES_PASSWORD: "postgres",
  }

  try {
    for (const [key, value] of Object.entries(pollutedEnv)) {
      process.env[key] = value
    }

    // No `pglite` flag: generating types must not require postgres by default.
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
    })

    const zapatosFile = path.join(tmp, "db", "zapatos", "schema.d.ts")
    const tableSql = path.join(
      tmp,
      "db",
      "structure",
      "public",
      "tables",
      "widgets",
      "table.sql",
    )

    expect(fs.existsSync(zapatosFile)).toBe(true)
    expect(fs.existsSync(tableSql)).toBe(true)
    expect(fs.readFileSync(zapatosFile, "utf8")).toContain("widgets")
    expect(fs.readFileSync(tableSql, "utf8")).toContain("widgets")

    // The caller's environment must not be left pointing at the temporary
    // PGlite gateway that generation spins up internally.
    for (const [key, value] of Object.entries(pollutedEnv)) {
      expect(process.env[key]).toBe(value)
    }
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 120000)
