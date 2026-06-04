import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { generate, hasExternalDatabaseConfig } from "../src/generate"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('foo', { id: 'id' })
}
exports.down = async (pgm) => {
  pgm.dropTable('foo')
}
`

const postgresEnvKeys = [
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
]

const snapshotPostgresEnv = () =>
  Object.fromEntries(
    postgresEnvKeys.map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>

const restorePostgresEnv = (
  previousEnv: Record<string, string | undefined>,
) => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const writeMigration = (migrationsDir: string) => {
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )
}

const expectGeneratedArtifacts = (tmp: string) => {
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
}

test("hasExternalDatabaseConfig detects postgres env settings", () => {
  expect(hasExternalDatabaseConfig({})).toBe(false)
  expect(
    hasExternalDatabaseConfig({ DATABASE_URL: "postgres://example" }),
  ).toBe(true)
  expect(hasExternalDatabaseConfig({ PGHOST: "127.0.0.1" })).toBe(true)
})

test("generate without postgres env uses pglite for migrations and dumps structure", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  const previousEnv = snapshotPostgresEnv()

  try {
    writeMigration(migrationsDir)

    for (const key of postgresEnvKeys) {
      delete process.env[key]
    }

    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
    })

    expectGeneratedArtifacts(tmp)
  } finally {
    restorePostgresEnv(previousEnv)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("generate with pglite true ignores external postgres env settings", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  const previousEnv = snapshotPostgresEnv()

  try {
    writeMigration(migrationsDir)

    process.env.DATABASE_URL = "postgres://external:external@example.invalid/db"
    process.env.PGHOST = "example.invalid"
    process.env.PGPORT = "5432"
    process.env.PGDATABASE = "external"
    process.env.PGUSER = "external"
    process.env.PGPASSWORD = "external"

    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
      pglite: true,
    })

    expectGeneratedArtifacts(tmp)
  } finally {
    restorePostgresEnv(previousEnv)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
