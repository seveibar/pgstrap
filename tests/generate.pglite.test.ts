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

test("generate defaults to pglite and dumps structure without postgres", async () => {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pgstrap-generate-default-"),
  )
  const prevDbUrl = process.env.DATABASE_URL
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  // Calling generate without specifying pglite defaults to true (in-memory PGlite)
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
  expect(process.env.DATABASE_URL).toBe(prevDbUrl)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test("generate with explicit pglite: true runs migrations and dumps structure", async () => {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pgstrap-generate-explicit-"),
  )
  const prevDbUrl = process.env.DATABASE_URL
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  await generate({
    schemas: ["public"],
    defaultDatabase: "postgres",
    dbDir: path.join(tmp, "db"),
    migrationsDir,
    pglite: true,
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
  expect(process.env.DATABASE_URL).toBe(prevDbUrl)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test("generate restores process.env.DATABASE_URL even on error", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-error-"))
  const originalUrl = "postgres://original:pass@localhost:5432/orig_db"
  process.env.DATABASE_URL = originalUrl

  const invalidMigrationsDir = path.join(tmp, "non_existent_migrations")

  let threw = false
  try {
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir: invalidMigrationsDir,
    })
  } catch {
    threw = true
  }

  expect(threw).toBe(true)
  expect(process.env.DATABASE_URL).toBe(originalUrl)

  delete process.env.DATABASE_URL
  fs.rmSync(tmp, { recursive: true, force: true })
})
