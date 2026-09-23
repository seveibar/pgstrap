import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { generate, shouldUsePglite } from "../src/generate"

const postgresEnvVars = [
  "POSTGRES_HOST",
  "POSTGRES_PASS",
  "POSTGRES_PASSWORD",
  "POSTGRES_DATABASE",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_USERNAME",
  "POSTGRES_PORT",
  "POSTGRES_SSL",
  "POSTGRES_URI",
  "PG_URI",
  "DATABASE_URL",
  "DATABASE_URI",
] as const

const supportedConnectionVariables = [
  ["POSTGRES_HOST", "db.example.com"],
  ["POSTGRES_PASS", "secret"],
  ["POSTGRES_PASSWORD", "secret"],
  ["POSTGRES_DATABASE", "app"],
  ["POSTGRES_DB", "app"],
  ["POSTGRES_USER", "app_user"],
  ["POSTGRES_USERNAME", "app_user"],
  ["POSTGRES_PORT", "5433"],
  ["POSTGRES_SSL", "require"],
  ["POSTGRES_URI", "postgresql://app:secret@db.example.com/app"],
  ["PG_URI", "postgresql://app:secret@db.example.com/app"],
  ["DATABASE_URL", "postgresql://app:secret@db.example.com/app"],
  ["DATABASE_URI", "postgresql://app:secret@db.example.com/app"],
] as const

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('foo', { id: 'id' })
}
exports.down = async (pgm) => {
  pgm.dropTable('foo')
}
`

const withIsolatedPostgresEnv = async (
  values: Record<string, string>,
  run: () => void | Promise<void>,
) => {
  const previousValues = postgresEnvVars.map(
    (name) => [name, process.env[name]] as const,
  )

  for (const name of postgresEnvVars) delete process.env[name]
  for (const [name, value] of Object.entries(values)) {
    process.env[name] = value
  }

  try {
    await run()
  } finally {
    for (const [name, value] of previousValues) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test.serial(
  "supported PostgreSQL variables select external connections",
  async () => {
    for (const [name, value] of supportedConnectionVariables) {
      await withIsolatedPostgresEnv({ [name]: value }, () => {
        expect(shouldUsePglite({})).toBe(false)
      })
    }
  },
)

test.serial("empty PostgreSQL variables select PGlite", async () => {
  for (const [name] of supportedConnectionVariables) {
    for (const value of ["", "   "]) {
      await withIsolatedPostgresEnv({ [name]: value }, () => {
        expect(shouldUsePglite({})).toBe(true)
      })
    }
  }
})

test.serial("explicit PGlite overrides take precedence", async () => {
  await withIsolatedPostgresEnv({ POSTGRES_HOST: "db.example.com" }, () => {
    expect(shouldUsePglite({ pglite: true })).toBe(true)
    expect(shouldUsePglite({ pglite: false })).toBe(false)
  })
})

test.serial(
  "generate without a flag or connection env runs offline on PGlite",
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-auto-"))
    const migrationsDir = path.join(tmp, "migrations")
    fs.mkdirSync(migrationsDir, { recursive: true })
    fs.writeFileSync(
      path.join(migrationsDir, "001_create_table.js"),
      migrationFile,
    )

    try {
      await withIsolatedPostgresEnv({}, async () => {
        await generate({
          schemas: ["public"],
          defaultDatabase: "postgres",
          dbDir: path.join(tmp, "db"),
          migrationsDir,
        })

        const zapatosFile = path.join(tmp, "db", "zapatos", "schema.d.ts")
        const structureDir = path.join(
          tmp,
          "db",
          "structure",
          "public",
          "tables",
          "foo",
        )

        expect(fs.existsSync(zapatosFile)).toBe(true)
        expect(fs.existsSync(path.join(structureDir, "table.sql"))).toBe(true)
      })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  },
)
