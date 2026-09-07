import { afterEach, beforeEach, test, expect } from "bun:test"
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

let tmp: string
let migrationsDir: string
const envKeys = ["DATABASE_URL", "POSTGRES_URI", "PG_URI"] as const
let previousEnv: Array<string | undefined>
const unavailableDatabase =
  "postgres://postgres:postgres@127.0.0.1:1/unavailable"

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "1700000000000_create_table.js"),
    migrationFile,
  )
  previousEnv = envKeys.map((key) => process.env[key])
  for (const key of envKeys) process.env[key] = unavailableDatabase
})

afterEach(() => {
  envKeys.forEach((key, index) => {
    if (previousEnv[index] === undefined) delete process.env[key]
    else process.env[key] = previousEnv[index]
  })
  fs.rmSync(tmp, { recursive: true, force: true })
})

const options = () => ({
  schemas: ["public"],
  defaultDatabase: "unavailable",
  dbDir: path.join(tmp, "db"),
  migrationsDir,
})

const expectRestoredEnv = () => {
  for (const key of envKeys) expect(process.env[key]).toBe(unavailableDatabase)
}

test.each([undefined, true])(
  "generate with pglite=%s runs without external Postgres",
  async (pglite) => {
    await generate({ ...options(), pglite })
    expectRestoredEnv()

    const zapatosFile = path.join(tmp, "db", "zapatos", "schema.d.ts")
    const structureDir = path.join(
      tmp,
      "db",
      "structure",
      "public",
      "tables",
      "foo",
    )

    expect(fs.readFileSync(zapatosFile, "utf8")).toContain("foo")
    expect(
      fs.readFileSync(path.join(structureDir, "table.sql"), "utf8"),
    ).toContain("foo")
  },
)

test("failed migrations restore the environment", async () => {
  fs.writeFileSync(
    path.join(migrationsDir, "1700000000001_invalid.js"),
    `exports.up = (pgm) => pgm.sql("SELECT missing_migration_function()")`,
  )
  await expect(generate(options())).rejects.toThrow(
    "missing_migration_function",
  )
  expectRestoredEnv()
})

test("output errors restore the environment and allow another generation", async () => {
  const blockedDir = path.join(tmp, "blocked")
  fs.writeFileSync(blockedDir, "not a directory")
  await expect(generate({ ...options(), dbDir: blockedDir })).rejects.toThrow(
    /ENOTDIR|EEXIST/,
  )
  expectRestoredEnv()
  await generate(options())
  expectRestoredEnv()
  expect(fs.existsSync(path.join(tmp, "db/zapatos/schema.d.ts"))).toBe(true)
})

test("temporary connection variables do not remain when originally unset", async () => {
  delete process.env.DATABASE_URL
  delete process.env.POSTGRES_URI
  await generate(options())
  expect(process.env.DATABASE_URL).toBeUndefined()
  expect(process.env.POSTGRES_URI).toBeUndefined()
  expect(process.env.PG_URI).toBe(unavailableDatabase)
})
