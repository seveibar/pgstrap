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

  fs.rmSync(tmp, { recursive: true, force: true })
}, 30_000)

test("generate with pglite restores DATABASE_URL on failure", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )
  // dbDir is a file, so writing the generated types fails after the
  // gateway has started
  const dbDir = path.join(tmp, "db")
  fs.writeFileSync(dbDir, "")

  const prevDbUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = "postgres://sentinel"
  try {
    await expect(
      generate({
        schemas: ["public"],
        defaultDatabase: "postgres",
        dbDir,
        migrationsDir,
        pglite: true,
      }),
    ).rejects.toThrow()
    expect(process.env.DATABASE_URL).toBe("postgres://sentinel")
  } finally {
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prevDbUrl
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}, 30_000)
