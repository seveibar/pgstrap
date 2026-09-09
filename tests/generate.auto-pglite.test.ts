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

test("generate without a flag or connection env runs offline on PGlite", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-auto-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  // simulate a zero-config project: no explicit pglite flag and no
  // PostgreSQL connection configured through the environment
  const prevDbUrl = process.env.DATABASE_URL
  const prevDbUri = process.env.DATABASE_URI
  const prevPgUri = process.env.PG_URI
  const prevPgHost = process.env.POSTGRES_HOST
  delete process.env.DATABASE_URL
  delete process.env.DATABASE_URI
  delete process.env.PG_URI
  delete process.env.POSTGRES_HOST

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
  } finally {
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl
    if (prevDbUri !== undefined) process.env.DATABASE_URI = prevDbUri
    if (prevPgUri !== undefined) process.env.PG_URI = prevPgUri
    if (prevPgHost !== undefined) process.env.POSTGRES_HOST = prevPgHost
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
