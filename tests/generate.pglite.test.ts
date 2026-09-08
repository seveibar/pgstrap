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

  const previousUri = process.env.POSTGRES_URI
  const unavailableUri = "postgres://test:test@127.0.0.1:1/unavailable"
  process.env.POSTGRES_URI = unavailableUri
  try {
    await generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
      pglite: true,
    })
    expect(process.env.POSTGRES_URI).toBe(unavailableUri)
  } finally {
    if (previousUri === undefined) delete process.env.POSTGRES_URI
    else process.env.POSTGRES_URI = previousUri
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

test("pglite generation restores connection settings after output failure", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-output-failure-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir)
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )
  const dbDir = path.join(tmp, "db")
  fs.mkdirSync(dbDir)
  fs.writeFileSync(path.join(dbDir, "zapatos"), "occupied")
  const previousUri = process.env.POSTGRES_URI
  const unavailableUri = "postgres://test:test@127.0.0.1:1/unchanged"
  process.env.POSTGRES_URI = unavailableUri
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
    expect(process.env.POSTGRES_URI).toBe(unavailableUri)
  } finally {
    if (previousUri === undefined) delete process.env.POSTGRES_URI
    else process.env.POSTGRES_URI = previousUri
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
