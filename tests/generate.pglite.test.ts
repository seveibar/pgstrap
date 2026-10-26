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

test("generate uses pglite by default to run migrations and dump structure", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = "postgres://invalid-host:5432/mydb"

  try {
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
    })

    expect(process.env.DATABASE_URL).toBe("postgres://invalid-host:5432/mydb")
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
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

  fs.rmSync(tmp, { recursive: true, force: true })
})
