import { test, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { execSync } from "child_process"
import { generate } from "../src/generate"
import { initPgstrap } from "../src/init"

const multiTableMigration = `
exports.up = async (pgm) => {
  pgm.createTable('users', {
    id: 'id',
    name: { type: 'varchar(100)', notNull: true },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    created_at: { type: 'timestamp', default: pgm.func('current_timestamp') }
  })
  pgm.createTable('posts', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, references: 'users(id)' },
    title: { type: 'varchar(200)', notNull: true },
    content: { type: 'text' }
  })
  pgm.createIndex('posts', 'user_id')
}
exports.down = async (pgm) => {
  pgm.dropTable('posts')
  pgm.dropTable('users')
}
`

const alterMigration = `
exports.up = async (pgm) => {
  pgm.addColumn('users', {
    is_active: { type: 'boolean', default: true }
  })
}
exports.down = async (pgm) => {
  pgm.dropColumn('users', 'is_active')
}
`

test("generate with multi-table migration produces complete schema types and dumps", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-multi-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_initial.js"),
    multiTableMigration,
  )
  fs.writeFileSync(path.join(migrationsDir, "002_alter.js"), alterMigration)

  // Default call (pglite omitted)
  await generate({
    schemas: ["public"],
    defaultDatabase: "postgres",
    dbDir: path.join(tmp, "db"),
    migrationsDir,
  })

  const schemaDts = fs.readFileSync(
    path.join(tmp, "db", "zapatos", "schema.d.ts"),
    "utf-8",
  )
  expect(schemaDts).toContain("users")
  expect(schemaDts).toContain("posts")
  expect(schemaDts).toContain("is_active")

  // Check SQL structure dumps
  expect(
    fs.existsSync(
      path.join(
        tmp,
        "db",
        "structure",
        "public",
        "tables",
        "users",
        "table.sql",
      ),
    ),
  ).toBe(true)
  expect(
    fs.existsSync(
      path.join(
        tmp,
        "db",
        "structure",
        "public",
        "tables",
        "posts",
        "table.sql",
      ),
    ),
  ).toBe(true)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test("generate handles custom schemas correctly with pglite", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-custom-schema-"))
  const migrationsDir = path.join(tmp, "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })

  fs.writeFileSync(
    path.join(migrationsDir, "001_custom_schema.js"),
    `
    exports.up = async (pgm) => {
      pgm.createSchema('app')
      pgm.createTable({ schema: 'app', name: 'accounts' }, { id: 'id', balance: 'numeric' })
    }
    exports.down = async (pgm) => {
      pgm.dropTable({ schema: 'app', name: 'accounts' })
      pgm.dropSchema('app')
    }
    `,
  )

  await generate({
    schemas: ["app"],
    defaultDatabase: "postgres",
    dbDir: path.join(tmp, "db"),
    migrationsDir,
  })

  const schemaDts = fs.readFileSync(
    path.join(tmp, "db", "zapatos", "schema.d.ts"),
    "utf-8",
  )
  expect(schemaDts).toContain("accounts")

  fs.rmSync(tmp, { recursive: true, force: true })
})

test("CLI: pgstrap generate in an initialized project defaults to pglite without postgres", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-e2e-"))

  // Create minimal package.json
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "test-app" }),
  )

  // Run init
  initPgstrap({ cwd: tmp })

  // Write a migration in the initialized project's migration dir
  const migrationsDir = path.join(tmp, "src", "db", "migrations")
  fs.mkdirSync(migrationsDir, { recursive: true })
  fs.writeFileSync(
    path.join(migrationsDir, "001_items.js"),
    `
    exports.up = async (pgm) => {
      pgm.createTable('items', { id: 'id', title: 'text' })
    }
    exports.down = async (pgm) => {
      pgm.dropTable('items')
    }
    `,
  )

  const cliPath = path.resolve(__dirname, "../dist/cli.cjs")

  // Run cli generate without args (should default to pglite and succeed)
  execSync(`node ${cliPath} generate`, {
    cwd: tmp,
    encoding: "utf-8",
    env: { ...process.env, PATH: process.env.PATH },
  })

  const schemaDts = path.join(tmp, "src", "db", "zapatos", "schema.d.ts")
  expect(fs.existsSync(schemaDts)).toBe(true)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test("CLI: pgstrap generate --no-pglite attempts real postgres and fails when not running", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pgstrap-cli-no-pglite-"))

  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "test-app" }),
  )
  initPgstrap({ cwd: tmp })

  const cliPath = path.resolve(__dirname, "../dist/cli.cjs")

  // Running with --no-pglite should attempt connecting to port 5432 and fail with ECONNREFUSED
  let threw = false
  try {
    execSync(`node ${cliPath} generate --no-pglite`, {
      cwd: tmp,
      encoding: "utf-8",
      stdio: "pipe",
    })
  } catch (err: any) {
    threw = true
    const combinedOutput = (err.stdout || "") + (err.stderr || "")
    expect(combinedOutput).toContain("ECONNREFUSED")
  }
  expect(threw).toBe(true)

  fs.rmSync(tmp, { recursive: true, force: true })
})
