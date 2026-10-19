import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { generate } from "../src/generate"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('foo', { id: 'id' })
}
exports.down = async (pgm) => {
  pgm.dropTable('foo')
}
`

test("generate with pglite runs migrations and dumps structure", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  const connectionEnvKeys = [
    "POSTGRES_URI",
    "PG_URI",
    "DATABASE_URL",
    "DATABASE_URI",
  ] as const
  const previousConnectionEnv = Object.fromEntries(
    connectionEnvKeys.map((key) => [key, process.env[key]]),
  )
  const externalConnectionString =
    "postgres://invalid:invalid@127.0.0.1:1/unavailable"

  try {
    for (const key of connectionEnvKeys) {
      process.env[key] = externalConnectionString
    }

    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
      pglite: true,
    })

    for (const key of connectionEnvKeys) {
      expect(process.env[key]).toBe(externalConnectionString)
    }
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
  } finally {
    for (const key of connectionEnvKeys) {
      const previousValue = previousConnectionEnv[key]
      if (previousValue === undefined) delete process.env[key]
      else process.env[key] = previousValue
    }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
