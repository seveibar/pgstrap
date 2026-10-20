import { afterEach, test, expect } from "bun:test"
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

// Nothing listens on port 1, so any attempt to use this database fails fast.
// Setting DATABASE_URL to it proves which code path generation took: the
// pglite path never touches it, the external postgres path fails against it.
const UNREACHABLE_DB_URL =
  "postgres://postgres:postgres@127.0.0.1:1/unreachable"

const originalDbUrl = process.env.DATABASE_URL

afterEach(() => {
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = originalDbUrl
})

const setupProject = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-generate-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_create_table.js"),
    migrationFile,
  )
  return { tmp, migrationsDir }
}

test("generate uses pglite by default, without a running postgres", async () => {
  const { tmp, migrationsDir } = setupProject()
  process.env.DATABASE_URL = UNREACHABLE_DB_URL

  // No `pglite` option passed: this is the default `pgstrap generate` path
  // used by the scaffolded `db:generate` script.
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
  // The caller's DATABASE_URL must be restored afterwards.
  expect(process.env.DATABASE_URL).toBe(UNREACHABLE_DB_URL)

  fs.rmSync(tmp, { recursive: true, force: true })
}, 30_000)

test("generate with pglite: false uses the external postgres from DATABASE_URL", async () => {
  const { tmp, migrationsDir } = setupProject()
  const dbDir = path.join(tmp, "db")

  // The opt-out must really take the external path: with an unreachable
  // database it fails instead of silently falling back to pglite. This
  // runs in a subprocess because zapatos' connection pool surfaces
  // connection failures as unhandled rejections, which would kill the
  // test runner process itself (pre-existing behavior of the external
  // path) — the subprocess's exit code is the observable contract.
  const scriptPath = path.join(tmp, "run-generate.ts")
  fs.writeFileSync(
    scriptPath,
    `import { generate } from ${JSON.stringify(
      path.join(import.meta.dir, "..", "src", "generate"),
    )}
await generate({
  schemas: ["public"],
  defaultDatabase: "postgres",
  dbDir: process.env.PGSTRAP_TEST_DB_DIR!,
  migrationsDir: process.env.PGSTRAP_TEST_MIGRATIONS_DIR!,
  pglite: false,
})
`,
  )

  const proc = Bun.spawnSync(["bun", "run", scriptPath], {
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      DATABASE_URL: UNREACHABLE_DB_URL,
      PGSTRAP_TEST_DB_DIR: dbDir,
      PGSTRAP_TEST_MIGRATIONS_DIR: migrationsDir,
    },
  })

  expect(proc.exitCode).not.toBe(0)
  expect(proc.stdout.toString() + proc.stderr.toString()).toContain(
    "ECONNREFUSED",
  )
  expect(fs.existsSync(path.join(dbDir, "zapatos", "schema.d.ts"))).toBe(false)

  fs.rmSync(tmp, { recursive: true, force: true })
}, 30_000)

test("generate restores DATABASE_URL when generation fails", async () => {
  const { tmp, migrationsDir } = setupProject()
  process.env.DATABASE_URL = UNREACHABLE_DB_URL

  // A dbDir inside a regular file cannot be written to, so generation fails
  // after the temporary pglite connection string has been installed in
  // DATABASE_URL. The original value must still be restored.
  const blocker = path.join(tmp, "blocker")
  fs.writeFileSync(blocker, "not a directory")

  await expect(
    generate({
      schemas: ["public"],
      defaultDatabase: "postgres",
      dbDir: path.join(blocker, "db"),
      migrationsDir,
    }),
  ).rejects.toThrow()

  expect(process.env.DATABASE_URL).toBe(UNREACHABLE_DB_URL)

  fs.rmSync(tmp, { recursive: true, force: true })
}, 30_000)
