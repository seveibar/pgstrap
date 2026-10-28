import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { generate } from "../src/generate"

const migrationFile = `
exports.up = async (pgm) => {
  pgm.createTable('users', { id: 'id', username: { type: 'varchar(100)', notNull: true } })
}
exports.down = async (pgm) => {
  pgm.dropTable('users')
}
`

test("generate defaults to pglite without requiring external postgres daemon", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-default-pglite-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_users_table.js"),
    migrationFile,
  )

  // Ensure DATABASE_URL is not pointing to any running postgres
  delete process.env.DATABASE_URL

  // Call generate() without specifying pglite (relying on default pglite = true)
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
    "users",
  )

  expect(fs.existsSync(zapatosFile)).toBe(true)
  expect(fs.existsSync(path.join(structureDir, "table.sql"))).toBe(true)

  fs.rmSync(tmp, { recursive: true, force: true })
})
