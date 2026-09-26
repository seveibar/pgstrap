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
  const previousUri = process.env.POSTGRES_URI
  const unavailableDatabase =
    "postgres://postgres:postgres@127.0.0.1:1/unavailable"
  process.env.POSTGRES_URI = unavailableDatabase
  try {
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
    expect(process.env.POSTGRES_URI).toBe(unavailableDatabase)
  } finally {
    if (previousUri === undefined) delete process.env.POSTGRES_URI
    else process.env.POSTGRES_URI = previousUri
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
