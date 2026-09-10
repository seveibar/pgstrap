import { test, expect, spyOn } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { generate } from "../src/generate"
import * as zg from "zapatos/generate"
import * as pgSchemaDump from "pg-schema-dump"

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
})

test("generate defaults to pglite when pglite option is omitted", async () => {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pgstrap-generate-default-"),
  )
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  const originalDbUrl = process.env.DATABASE_URL

  // pglite is omitted; should default to true and not require external postgres
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
  expect(process.env.DATABASE_URL).toBe(originalDbUrl)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test("generate with pglite: false opts out and uses connectionString from env", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-optout-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  const originalDbUrl = process.env.DATABASE_URL
  const customDbUrl =
    "postgres://custom_user:custom_pass@127.0.0.1:5432/custom_db"
  process.env.DATABASE_URL = customDbUrl

  const zgSpy = spyOn(zg, "generate").mockImplementation(async () => {})
  const dumpSpy = spyOn(pgSchemaDump, "dumpTree").mockImplementation(
    async () => {},
  )

  try {
    await generate({
      schemas: ["public"],
      defaultDatabase: "custom_db",
      dbDir: path.join(tmp, "db"),
      migrationsDir,
      pglite: false,
    })

    expect(zgSpy).toHaveBeenCalled()
    const lastCallArg = zgSpy.mock.calls[0][0] as any
    expect(lastCallArg.db.connectionString).toContain(
      "custom_user:custom_pass@127.0.0.1:5432/custom_db",
    )
    expect(process.env.DATABASE_URL).toBe(customDbUrl)
  } finally {
    zgSpy.mockRestore()
    dumpSpy.mockRestore()
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDbUrl
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("DATABASE_URL is restored even if generate encounters an error", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-error-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )

  const originalDbUrl = "postgres://original:original@localhost:5432/original"
  process.env.DATABASE_URL = originalDbUrl

  const zgSpy = spyOn(zg, "generate").mockImplementation(async () => {
    // Verify DATABASE_URL was set to the temporary PGlite socket connection during generation
    expect(process.env.DATABASE_URL).toContain(
      "postgres://postgres:postgres@127.0.0.1:",
    )
    throw new Error("Simulated zg.generate failure")
  })

  try {
    let thrownError: any = null
    try {
      await generate({
        schemas: ["public"],
        defaultDatabase: "postgres",
        dbDir: path.join(tmp, "db"),
        migrationsDir,
        pglite: true,
      })
    } catch (err) {
      thrownError = err
    }

    expect(thrownError).not.toBeNull()
    expect(thrownError.message).toBe("Simulated zg.generate failure")
    // Verify DATABASE_URL is cleanly restored to original value
    expect(process.env.DATABASE_URL).toBe(originalDbUrl)
  } finally {
    zgSpy.mockRestore()
    delete process.env.DATABASE_URL
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
