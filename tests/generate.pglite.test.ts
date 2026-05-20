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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  const previousDatabaseUrl = process.env.DATABASE_URL

  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/missing"

  try {
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
    expect(process.env.DATABASE_URL).toBe(
      "postgres://postgres:postgres@127.0.0.1:1/missing",
    )
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl

    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("generate with pglite restores DATABASE_URL after failure", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  const dbDir = path.join(tmp, "db")
  const previousDatabaseUrl = process.env.DATABASE_URL

  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )
  fs.writeFileSync(dbDir, "not a directory")

  process.env.DATABASE_URL = "postgres://existing:secret@localhost:5432/app"

  try {
    await expect(
      generate({
        schemas: ["public"],
        defaultDatabase: "postgres",
        dbDir,
        migrationsDir,
      }),
    ).rejects.toThrow()

    expect(process.env.DATABASE_URL).toBe(
      "postgres://existing:secret@localhost:5432/app",
    )
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl

    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
