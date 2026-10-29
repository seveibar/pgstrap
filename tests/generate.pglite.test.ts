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

test("generate defaults to pglite and dumps migrated types and structure", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
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

  fs.rmSync(tmp, { recursive: true, force: true })
})

test("failed migrations restore DATABASE_URL and permit another generation", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-failure-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir)
  const file = path.join(migrationsDir, "1700000000000_create_foo.js")
  fs.writeFileSync(
    file,
    'exports.up = () => { throw new Error("migration failure") }',
  )
  const previous = process.env.DATABASE_URL
  process.env.DATABASE_URL =
    "postgres://postgres:postgres@127.0.0.1:1/unavailable"
  const options = {
    schemas: ["public"],
    defaultDatabase: "postgres",
    dbDir: path.join(tmp, "db"),
    migrationsDir,
  }
  try {
    await expect(generate(options)).rejects.toThrow("migration failure")
    expect(process.env.DATABASE_URL).toBe(
      "postgres://postgres:postgres@127.0.0.1:1/unavailable",
    )
    fs.unlinkSync(file)
    fs.writeFileSync(
      path.join(migrationsDir, "1700000000001_create_foo.js"),
      migrationFile,
    )
    await generate(options)
    expect(fs.existsSync(path.join(tmp, "db/zapatos/schema.d.ts"))).toBe(true)
    expect(process.env.DATABASE_URL).toBe(
      "postgres://postgres:postgres@127.0.0.1:1/unavailable",
    )
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
