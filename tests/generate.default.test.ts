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

test("generate defaults to pglite and needs no running postgres or DATABASE_URL", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  const prevDbUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  try {
    // No `pglite` option passed: the default must use PGlite, so this
    // works on a machine with no postgres server and no DATABASE_URL.
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
    })

    const zapatosFile = path.join(tmp, "db", "zapatos", "schema.d.ts")
    const structureFile = path.join(
      tmp,
      "db",
      "structure",
      "public",
      "tables",
      "foo",
      "table.sql",
    )

    expect(fs.existsSync(zapatosFile)).toBe(true)
    expect(fs.existsSync(structureFile)).toBe(true)
    // The temporary DATABASE_URL used internally must not leak out.
    expect(process.env.DATABASE_URL).toBeUndefined()
  } finally {
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevDbUrl
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("generate with pglite restores a pre-existing DATABASE_URL", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  const sentinel = "postgres://user:pass@example.invalid:5432/keepme"
  const prevDbUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = sentinel
  try {
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
      pglite: true,
    })
    expect(process.env.DATABASE_URL).toBe(sentinel)
  } finally {
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevDbUrl
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
